/**
 * task 云函数：任务的增查与状态流转
 *
 * 状态机（唯一权威定义）：
 *   pending --grab--> accepted --submit--> confirming --confirm--> completed
 *   pending --cancel--> cancelled
 *
 * 并发控制：所有状态流转都用 `where({_id, status: 期望值})` 做条件更新，
 * 依赖云数据库的单文档原子性，避免两人同时接单。
 */
const cloud = require('wx-server-sdk')
const { maskLocation, parseRegion } = require('./region')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_TASK = 'tasks'
const C_USER = 'users'

/** 匿名可见条数上限（规则 L1） */
const ANON_LIMIT = 10
/** 匿名可见字段白名单（规则 L4） */
const ANON_TASK_FIELDS = ['_id', 'title', 'reward', 'status', 'commentCount', 'createdAt']

const STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const ok = (data) => ({ code: 0, data, msg: 'ok' })
const fail = (code, msg) => ({ code, msg })

function bizError(code, msg) {
  const e = new Error(msg)
  e.code = code
  return e
}

function assert(cond, code, msg) {
  if (!cond) throw bizError(code, msg)
}

async function addWithColl(name, data) {
  try {
    return await db.collection(name).add({ data })
  } catch (e) {
    const msg = (e && e.message) || ''
    if (/not exist|not found|collection/i.test(msg)) {
      await db.createCollection(name).catch(() => {})
      return await db.collection(name).add({ data })
    }
    throw e
  }
}

async function safeGet(query, fallback) {
  try {
    const r = await query.get()
    return r.data
  } catch (e) {
    return fallback
  }
}

async function getTaskById(id) {
  try {
    const r = await db.collection(C_TASK).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

/** 查用户档案（匿名判定用） */
async function getUserByOpenid(openid) {
  const rows = await safeGet(db.collection(C_USER).where({ openid }).limit(1), [])
  return rows[0] || null
}

/**
 * 登录用户流水线校验（V1–V3）
 * 档案不存在或状态非 active，一律按未登录/受限处理
 */
async function requireActiveUser(ctx) {
  if (!ctx.openid) throw bizError('UNAUTHORIZED', '请先登录后再操作')
  const user = await getUserByOpenid(ctx.openid)
  if (!user || user.consent !== true) throw bizError('UNAUTHORIZED', '请先登录后再操作')
  if (user.status && user.status !== 'active') {
    throw bizError('ACCOUNT_BANNED', '账号状态异常，暂时无法操作')
  }
  return user
}

/** 写操作校验（V1–V4）：登录 + 状态正常 + 资料完整 */
async function requireWriter(ctx) {
  const user = await requireActiveUser(ctx)
  if (!String(user.nickname || '').trim()) {
    throw bizError('PROFILE_INCOMPLETE', '请先设置昵称后再操作')
  }
  return user
}

/**
 * 匿名可见字段裁剪（L4）
 * 地址只保留到城市 / 区县，详细地址、门牌号、地点名、经纬度一律不带出
 */
function pickAnonTask(task) {
  const out = {}
  ANON_TASK_FIELDS.forEach((k) => {
    if (task[k] !== undefined) out[k] = task[k]
  })
  out.location = maskLocation(task.location)
  out.masked = true
  return out
}

/** 球面距离（米），用于没有建地理索引时的兜底排序 */
function haversine(a, b) {
  const R = 6371000
  const rad = Math.PI / 180
  const lat1 = Number(a.latitude)
  const lng1 = Number(a.longitude)
  const lat2 = Number(b.latitude)
  const lng2 = Number(b.longitude)
  if ([lat1, lng1, lat2, lng2].some((v) => Number.isNaN(v))) return null
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

function stripPrivate(task) {
  if (!task) return task
  const { contact, ...rest } = task
  return rest
}

/* ------------------------------ 业务动作 ------------------------------ */

async function createTask(data, ctx) {
  await requireWriter(ctx)
  const title = (data.title || '').trim()
  assert(title.length >= 4, 'INVALID_PARAM', '标题至少 4 个字')
  assert(title.length <= 40, 'INVALID_PARAM', '标题最多 40 个字')

  const reward = Number(data.reward || 0)
  assert(!Number.isNaN(reward) && reward >= 0, 'INVALID_PARAM', '赏金需为不小于 0 的数字')

  let location = null
  let geo = null
  if (data.location && data.location.latitude != null && data.location.longitude != null) {
    const lng = Number(data.location.longitude)
    const lat = Number(data.location.latitude)
    const address = (data.location.address || '').slice(0, 120)
    location = {
      name: (data.location.name || '').slice(0, 60),
      address,
      latitude: lat,
      longitude: lng,
      // 入库时解析好区划，匿名展示直接用，避免每次请求都跑正则
      region: parseRegion(address)
    }
    // 预留地理索引字段，后续切换为 geoNear 检索时直接用
    geo = new db.Geo.Point(lng, lat)
  }

  const now = db.serverDate()
  const doc = {
    title,
    desc: (data.desc || '').trim().slice(0, 500),
    reward,
    contact: (data.contact || '').trim().slice(0, 40),
    location,
    geo,
    status: STATUS.PENDING,
    ownerOpenid: ctx.openid,
    takerOpenid: '',
    commentCount: 0,
    createdAt: now,
    updatedAt: now
  }

  const r = await addWithColl(C_TASK, doc)

  // 发布数 +1（失败不影响主流程）
  db.collection(C_USER)
    .where({ openid: ctx.openid })
    .update({ data: { publishedCount: _.inc(1) } })
    .catch(() => {})

  return { id: r._id, status: STATUS.PENDING }
}

/**
 * 任务列表 —— 全站唯一允许匿名调用的接口（规则 4.0 匿名分支 A1–A7）
 *
 * A1 档案存在且 active → 正常查询
 * A2 否则进入匿名分支
 * A3 强制 status = pending（忽略入参）
 * A4 强制 keyword 为空（忽略入参）
 * A5 强制 skip = 0、limit = 10（忽略入参）
 * A6 返回字段按白名单裁剪
 * A7 hasMore 恒为 false
 */
async function listTasks(data, ctx) {
  const user = ctx.openid ? await getUserByOpenid(ctx.openid) : null
  const authorized = !!(user && user.consent === true && (!user.status || user.status === 'active'))

  const limit = authorized ? Math.min(Number(data.pageSize) || 10, 20) : ANON_LIMIT
  const page = authorized ? Math.max(Number(data.page) || 0, 0) : 0

  // A3：匿名只给待接单
  const status = authorized ? data.status || STATUS.PENDING : STATUS.PENDING

  const where = { status }
  // A4：匿名忽略关键词，防止枚举
  if (authorized && data.keyword) {
    where.title = db.RegExp({ regexp: String(data.keyword).slice(0, 20), options: 'i' })
  }

  let rows = await safeGet(
    db.collection(C_TASK).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit),
    []
  )

  // 匿名不参与距离排序：距离能反推坐标，属于 L4 排除的信息
  const center = authorized ? data.center : null
  if (center && center.latitude != null) {
    rows = rows
      .map((t) => {
        const d = t.location ? haversine(center, t.location) : null
        return d === null ? { ...t } : { ...t, distance: d }
      })
      .sort((a, b) => {
        if (a.distance == null) return 1
        if (b.distance == null) return -1
        return a.distance - b.distance
      })
  }

  if (!authorized) {
    // A6 + A7
    return {
      list: rows.map(pickAnonTask),
      hasMore: false,
      anonymous: true
    }
  }

  return { list: rows.map(stripPrivate), hasMore: rows.length === limit, anonymous: false }
}

async function detailTask(data, ctx) {
  await requireActiveUser(ctx)
  assert(data.id, 'INVALID_PARAM', '缺少任务 ID')
  const task = await getTaskById(data.id)
  assert(task, 'NOT_FOUND', '任务不存在或已删除')

  const isOwner = task.ownerOpenid === ctx.openid
  const isTaker = !!task.takerOpenid && task.takerOpenid === ctx.openid

  const permissions = {
    canGrab: task.status === STATUS.PENDING && !isOwner,
    canSubmit: task.status === STATUS.ACCEPTED && isTaker,
    canConfirm: task.status === STATUS.CONFIRMING && isOwner,
    canCancel: task.status === STATUS.PENDING && isOwner,
    canViewContact: isOwner || isTaker,
    isOwner,
    isTaker
  }

  // 联系方式只对发布者和接单者可见
  const safeTask = permissions.canViewContact ? task : stripPrivate(task)
  return { task: safeTask, permissions }
}

/**
 * 状态流转的统一实现
 * 依赖 `where({_id, status: from})` 的条件更新做乐观锁
 */
async function transition({ id, ctx, from, to, field, requireOwner, requireTaker, preCheck }) {
  await requireWriter(ctx)
  assert(id, 'INVALID_PARAM', '缺少任务 ID')
  const task = await getTaskById(id)
  assert(task, 'NOT_FOUND', '任务不存在或已删除')

  if (preCheck) preCheck(task, ctx)
  if (requireOwner) assert(task.ownerOpenid === ctx.openid, 'FORBIDDEN', '只有发布者可以操作')
  if (requireTaker) assert(task.takerOpenid === ctx.openid, 'FORBIDDEN', '只有接单者可以操作')
  assert(task.status === from, 'STATUS_CONFLICT', '任务当前状态不允许该操作')

  const res = await db
    .collection(C_TASK)
    .where({ _id: id, status: from })
    .update({
      data: {
        status: to,
        ...(field || {}),
        updatedAt: db.serverDate()
      }
    })

  assert(res.stats && res.stats.updated === 1, 'STATUS_CONFLICT', '手慢了，任务状态已被改变')
  return { id, status: to }
}

async function grabTask(data, ctx) {
  const result = await transition({
    id: data.id,
    ctx,
    from: STATUS.PENDING,
    to: STATUS.ACCEPTED,
    field: { takerOpenid: ctx.openid, takenAt: db.serverDate() },
    requireOwner: false,
    requireTaker: false,
    preCheck: (task) =>
      assert(task.ownerOpenid !== ctx.openid, 'SELF_GRAB', '不能接自己发布的任务')
  })

  db.collection(C_USER)
    .where({ openid: ctx.openid })
    .update({ data: { takenCount: _.inc(1) } })
    .catch(() => {})

  return result
}

async function submitTask(data, ctx) {
  // 接单者提交完成
  return transition({
    id: data.id,
    ctx,
    from: STATUS.ACCEPTED,
    to: STATUS.CONFIRMING,
    field: { submittedAt: db.serverDate() },
    requireTaker: true
  })
}

async function confirmTask(data, ctx) {
  // 发布者确认完成
  return transition({
    id: data.id,
    ctx,
    from: STATUS.CONFIRMING,
    to: STATUS.COMPLETED,
    field: { completedAt: db.serverDate() },
    requireOwner: true
  })
}

async function cancelTask(data, ctx) {
  return transition({
    id: data.id,
    ctx,
    from: STATUS.PENDING,
    to: STATUS.CANCELLED,
    field: { cancelledAt: db.serverDate() },
    requireOwner: true
  })
}

async function mineTasks(data, ctx) {
  await requireActiveUser(ctx)
  const role = data.role === 'taker' ? 'taker' : 'owner'
  const limit = Math.min(Number(data.pageSize) || 10, 20)
  const page = Math.max(Number(data.page) || 0, 0)
  const where = role === 'taker' ? { takerOpenid: ctx.openid } : { ownerOpenid: ctx.openid }

  const rows = await safeGet(
    db.collection(C_TASK).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit),
    []
  )
  return { list: rows, hasMore: rows.length === limit }
}

const ACTIONS = {
  create: createTask,
  list: listTasks,
  detail: detailTask,
  grab: grabTask,
  submit: submitTask,
  confirm: confirmTask,
  cancel: cancelTask,
  mine: mineTasks
}

exports.main = async (event = {}) => {
  const { action, data = {} } = event
  const { OPENID } = cloud.getWXContext()
  const handler = ACTIONS[action]

  if (!handler) return fail('UNKNOWN_ACTION', `未知操作: ${action}`)
  if (!OPENID) return fail('FORBIDDEN', '无法识别用户身份')

  try {
    return ok(await handler(data, { openid: OPENID }))
  } catch (e) {
    console.error('[task]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
