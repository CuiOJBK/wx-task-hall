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
const C_SETTING = 'settings'
const C_IMAGE_CHECK = 'image_checks'

/** 每处最多 3 张图（与前端 picker 上限一致） */
const MAX_IMAGES = 3

/** 平台默认设置，与后台 settings 默认值保持一致 */
const DEFAULT_SETTINGS = { maxReward: 500, allowPublish: true, announcement: '', acceptTimeoutHours: 24 }

/** 读取平台设置（settings 集合单文档 key='global'） */
async function getPlatformSettings() {
  const rows = await safeGet(db.collection(C_SETTING).where({ key: 'global' }).limit(1), [])
  const v = (rows[0] && rows[0].value) || {}
  const timeoutHours = Number(v.acceptTimeoutHours)
  return {
    maxReward: typeof v.maxReward === 'number' ? v.maxReward : DEFAULT_SETTINGS.maxReward,
    allowPublish: v.allowPublish !== false,
    announcement: String(v.announcement || ''),
    acceptTimeoutHours:
      Number.isNaN(timeoutHours) || timeoutHours < 1 || timeoutHours > 168
        ? DEFAULT_SETTINGS.acceptTimeoutHours
        : timeoutHours
  }
}

/** 匿名可见条数上限（规则 L1） */
const ANON_LIMIT = 10
/** 匿名可见字段白名单（规则 L4） */
const ANON_TASK_FIELDS = ['_id', 'title', 'reward', 'status', 'commentCount', 'createdAt']

const { STATUS, evaluateTransition, haversine } = require('./state')

const ok = (data) => ({ code: 0, data, msg: 'ok' })
const fail = (code, msg) => ({ code, msg })

function bizError(code, msg) {
  const e = new Error(msg)
  e.code = code
  return e
}
/**
 * 内容安全检测（P0-1）
 * 命中敏感内容 → CONTENT_RISK；接口不可用/超时 → 放行并记日志，不阻断正常发布
 * scene: 1 资料 / 2 评论 / 3 论坛 / 4 社交日志
 */
async function assertContentSafe(text, openid, scene) {
  const content = String(text || '').trim()
  if (!content) return
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: scene || 3,
      version: 2,
      content: content.slice(0, 2500)
    })
    const errCode = res && res.errCode
    if (errCode === 87014) {
      throw bizError('CONTENT_RISK', '内容包含敏感信息，请修改后重试')
    }
    if (errCode !== 0) {
      console.warn('[security] msgSecCheck 异常码', errCode, res && res.errMsg)
    }
  } catch (e) {
    if (e && e.code === 'CONTENT_RISK') throw e
    console.warn(
      '[security] msgSecCheck 调用失败，本次放行：',
      (e && e.errCode) || '',
      (e && e.errMsg) || (e && e.message) || e
    )
  }
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

  const desc = (data.desc || '').trim().slice(0, 500)

  const platform = await getPlatformSettings()
  assert(platform.allowPublish, 'PUBLISH_DISABLED', '平台当前暂停发布任务，请稍后再试')
  assert(
    reward <= platform.maxReward,
    'INVALID_PARAM',
    `赏金不能超过 ${platform.maxReward} 元`
  )

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

  const images = normalizeImages(data.images)

  const now = db.serverDate()
  const doc = {
    title,
    desc,
    images,
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

  await assertContentSafe(`${title}\n${desc}`, ctx.openid, 3)

  const r = await addWithColl(C_TASK, doc)

  // 图片安全检测是异步接口：先落库再提交检测，traceId 由 mediacheck 回调匹配
  if (images.length) {
    const traceIds = await checkImages(images, ctx.openid, 3, { type: 'task', id: r._id })
    if (traceIds.length) {
      await db
        .collection(C_TASK)
        .doc(r._id)
        .update({ data: { imageCheckTraceIds: traceIds } })
        .catch((e) => console.warn('[task] 回写 traceId 失败', e.message))
    }
  }

  // 发布数 +1（失败不影响主流程）
  db.collection(C_USER)
    .where({ openid: ctx.openid })
    .update({ data: { publishedCount: _.inc(1) } })
    .catch(() => {})

  return { id: r._id, status: STATUS.PENDING, images }
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
/** 规整图片数组：只接受 cloud:// fileID，去重并截断到 3 张 */
function normalizeImages(list) {
  if (!Array.isArray(list)) return []
  const seen = {}
  const out = []
  for (const v of list) {
    if (typeof v !== 'string' || v.indexOf('cloud://') !== 0) continue
    if (seen[v]) continue
    seen[v] = true
    out.push(v)
    if (out.length >= MAX_IMAGES) break
  }
  return out
}

/**
 * 图片内容安全检测（mediaCheckAsync 是异步接口）
 *
 * 流程：fileID → 临时 URL → mediaCheckAsync → traceId
 * traceId 与 fileID 的映射写入 image_checks，供 mediacheck 云函数回调匹配。
 * 接口不可用（未开通/超配额）时放行并记日志，不阻断发布。
 */
async function checkImages(images, openid, scene, target) {
  if (!images.length) return []
  const traceIds = []
  try {
    const res = await cloud.getTempFileURL({ fileList: images })
    const fileList = (res && res.fileList) || []
    for (const f of fileList) {
      if (!f || !f.tempFileURL) continue
      try {
        const check = await cloud.openapi.security.mediaCheckAsync({
          mediaUrl: f.tempFileURL,
          mediaType: 2,
          version: 2,
          openid,
          scene: scene || 3
        })
        const traceId = check && check.traceId
        if (!traceId) continue
        traceIds.push(traceId)
        await addWithColl(C_IMAGE_CHECK, {
          traceId,
          fileID: f.fileID,
          openid,
          status: 'pending',
          targetType: (target && target.type) || '',
          targetId: (target && target.id) || '',
          createdAt: db.serverDate()
        })
      } catch (e) {
        console.warn('[task] mediaCheckAsync 失败，本张放行：', (e && e.errMsg) || (e && e.message) || e)
      }
    }
  } catch (e) {
    console.warn('[task] 获取图片临时链接失败，本次放行：', (e && e.message) || e)
  }
  return traceIds
}

/**
 * 按距离分页（geoNear）
 *
 * 依赖 tasks.geo 的 2dsphere 索引。索引缺失时 aggregate 会抛错，
 * 由 listTasks 捕获后降级为内存排序 —— 不能因为少建一个索引就让大厅挂掉。
 *
 * 注意：$geoNear 只返回「有 geo 字段」的文档，未选地点的任务在距离模式下不出现，
 * 这是符合预期的产品行为（按距离看，本来就不该包含无位置的任务）。
 */
async function listByGeoNear({ where, center, limit, page }) {
  const res = await db
    .collection(C_TASK)
    .aggregate()
    .geoNear({
      near: db.Geo.Point(Number(center.longitude), Number(center.latitude)),
      distanceField: 'distance',
      query: where,
      key: 'geo'
    })
    .skip(page * limit)
    .limit(limit + 1)
    .end()

  return (res && res.list) || []
}

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

  // 匿名不参与距离排序：距离能反推坐标，属于 L4 排除的信息
  const center = authorized ? data.center : null
  const canSortByGeo = !!(center && center.latitude != null && center.longitude != null)

  let rows = []
  let geoMode = 'none'

  if (canSortByGeo) {
    try {
      rows = await listByGeoNear({ where, center, limit, page })
      geoMode = 'near'
    } catch (e) {
      // 最常见原因：tasks.geo 没有 2dsphere 索引
      console.warn('[task] geoNear 不可用，降级为内存排序：', (e && e.message) || e)
    }
  }

  if (geoMode !== 'near') {
    // 多取一条用于判断是否还有下一页
    rows = await safeGet(
      db.collection(C_TASK).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit + 1),
      []
    )

    // 降级路径：仍在内存里按距离排，但只对当前页有效，跨页顺序不保证
    if (canSortByGeo) {
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
  }

  const hasMore = rows.length > limit
  rows = rows.slice(0, limit)

  if (!authorized) {
    // A6 + A7
    return {
      list: rows.map(pickAnonTask),
      hasMore: false,
      anonymous: true,
      geoMode: 'none'
    }
  }

  return { list: rows.map(stripPrivate), hasMore, anonymous: false, geoMode }
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
  // 接单超时提示：超过设定时长仍未提交，提示即将自动退回大厅
  let timeoutHint = ''
  if (task.status === STATUS.ACCEPTED && task.takenAt) {
    const platform = await getPlatformSettings()
    const hours = platform.acceptTimeoutHours
    const takenAtMs = new Date(task.takenAt).getTime()
    if (!Number.isNaN(takenAtMs)) {
      const overdueMs = Date.now() - takenAtMs - hours * 3600 * 1000
      if (overdueMs > 0) {
        timeoutHint =
          task.timeoutRemindedAt
            ? `接单已超过 ${hours} 小时，再不提交将自动退回大厅`
            : '接单已超时，系统稍后会提醒接单者'
      }
    }
  }

  const safeTask = permissions.canViewContact ? task : stripPrivate(task)
  return { task: safeTask, permissions, timeoutHint }
}

/**
 * 状态流转的统一实现
 * 依赖 `where({_id, status: from})` 的条件更新做乐观锁
 */
/**
 * 执行状态流转：规则判定交给 state.js 的纯函数，这里只做数据库写入
 * 条件更新 where({_id, status: from}) 保证并发下只有一个请求能成功
 */
async function transition({ action, id, ctx, field }) {
  await requireWriter(ctx)
  assert(id, 'INVALID_PARAM', '缺少任务 ID')

  const task = await getTaskById(id)
  const verdict = evaluateTransition(action, task, ctx.openid)
  assert(verdict.allowed, verdict.code, verdict.msg)

  const res = await db
    .collection(C_TASK)
    .where({ _id: id, status: verdict.from })
    .update({
      data: {
        status: verdict.to,
        ...(field || {}),
        updatedAt: db.serverDate()
      }
    })

  assert(res.stats && res.stats.updated === 1, 'STATUS_CONFLICT', '手慢了，任务状态已被改变')
  return { id, status: verdict.to }
}

async function grabTask(data, ctx) {
  const result = await transition({
    action: 'grab',
    id: data.id,
    ctx,
    field: { takerOpenid: ctx.openid, takenAt: db.serverDate() }
  })

  db.collection(C_USER)
    .where({ openid: ctx.openid })
    .update({ data: { takenCount: _.inc(1) } })
    .catch(() => {})

  return result
}

async function submitTask(data, ctx) {
  // 接单者提交完成，可附最多 3 张凭证图
  const proofImages = normalizeImages(data.proofImages)

  // transition 内部还会再校验一次身份；这里先校验是为了不让未登录请求打到图片检测接口
  await requireWriter(ctx)
  const proofTraceIds = await checkImages(proofImages, ctx.openid, 3, {
    type: 'task',
    id: String(data.id || '')
  })

  return transition({
    action: 'submit',
    id: data.id,
    ctx,
    field: {
      submittedAt: db.serverDate(),
      proofImages,
      proofTraceIds
    }
  })
}

async function confirmTask(data, ctx) {
  // 发布者确认完成
  return transition({
    action: 'confirm',
    id: data.id,
    ctx,
    field: { completedAt: db.serverDate() }
  })
}

async function cancelTask(data, ctx) {
  return transition({
    action: 'cancel',
    id: data.id,
    ctx,
    field: { cancelledAt: db.serverDate() }
  })
}

/** 我的任务支持的状态筛选：一个筛选项可对应多个真实状态 */
const MINE_FILTERS = {
  all: [],
  pending: [STATUS.PENDING],
  running: [STATUS.ACCEPTED, STATUS.CONFIRMING],
  completed: [STATUS.COMPLETED],
  cancelled: [STATUS.CANCELLED]
}

async function mineTasks(data, ctx) {
  await requireActiveUser(ctx)
  const role = data.role === 'taker' ? 'taker' : 'owner'
  const limit = Math.min(Number(data.pageSize) || 10, 20)
  const page = Math.max(Number(data.page) || 0, 0)
  const where = role === 'taker' ? { takerOpenid: ctx.openid } : { ownerOpenid: ctx.openid }

  const filter = String(data.filter || 'all')
  const statusList = MINE_FILTERS[filter] || []
  if (statusList.length === 1) {
    where.status = statusList[0]
  } else if (statusList.length > 1) {
    where.status = _.in(statusList)
  }

  const rows = await safeGet(
    db.collection(C_TASK).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit + 1),
    []
  )
  return { list: rows.slice(0, limit), hasMore: rows.length > limit, filter }
}

/** 公开设置：仅暴露前端需要的字段，不需要管理员权限 */
async function publicSettings(data, ctx) {
  return getPlatformSettings()
}

const ACTIONS = {
  create: createTask,
  settings: publicSettings,
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
