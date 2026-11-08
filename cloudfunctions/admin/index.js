/**
 * admin 云函数：管理员后台统一入口
 *
 * 权限模型（两级）：
 *  - root：openid 命中环境变量 ADMIN_OPENIDS，不可被降级、不可被删除
 *  - admin：users.role = 'admin'，由 root 授予
 * 所有 action 先过 assertAdmin，再写 admin_logs 留痕。
 *
 * 防呆规则：
 *  - 不能把自己禁用/删除
 *  - root 不能被降级
 *  - 批量操作上限 50 条
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_USER = 'users'
const C_TASK = 'tasks'
const C_POST = 'posts'
const C_COMMENT = 'comments'
const C_REPORT = 'reports'
const C_LOG = 'admin_logs'
const C_SETTING = 'settings'

const STATUS = { PENDING: 'pending', ACCEPTED: 'accepted', CONFIRMING: 'confirming', COMPLETED: 'completed', CANCELLED: 'cancelled' }
const CONTENT_COLL = { task: C_TASK, post: C_POST, comment: C_COMMENT }
const BATCH_MAX = 50

const DEFAULT_SETTINGS = {
  maxReward: 500,
  reportThreshold: 3,
  announcement: '',
  allowPublish: true
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

async function safeGet(query, fallback) {
  try {
    const r = await query.get()
    return r.data
  } catch (e) {
    return fallback
  }
}

async function safeCount(query) {
  try {
    const r = await query.count()
    return r.total || 0
  } catch (e) {
    return 0
  }
}

async function getDocById(coll, id) {
  try {
    const r = await db.collection(coll).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
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

function adminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isRoot(openid) {
  return !!openid && adminOpenids().indexOf(openid) > -1
}

async function findUserByOpenid(openid) {
  const rows = await safeGet(db.collection(C_USER).where({ openid }).limit(1), [])
  return rows[0] || null
}

async function findUserById(id) {
  try {
    const r = await db.collection(C_USER).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function assertAdmin(ctx) {
  if (!ctx.openid) throw bizError('FORBIDDEN', '请先登录')
  if (isRoot(ctx.openid)) {
    return { openid: ctx.openid, user: await findUserByOpenid(ctx.openid), level: 'root' }
  }
  const user = await findUserByOpenid(ctx.openid)
  const active = user && (!user.status || user.status === 'active')
  if (user && user.role === 'admin' && active) {
    return { openid: ctx.openid, user, level: 'admin' }
  }
  throw bizError('FORBIDDEN', '无权访问管理后台')
}

/** 写操作留痕，失败不阻断主流程 */
async function writeLog(operator, action, detail) {
  try {
    await addWithColl(C_LOG, {
      operatorOpenid: operator.openid,
      operatorLevel: operator.level,
      action,
      targetType: (detail && detail.targetType) || '',
      targetId: (detail && detail.targetId) || '',
      detail: JSON.stringify(detail || {}).slice(0, 500),
      createdAt: db.serverDate()
    })
  } catch (e) {
    console.warn('[admin] 写日志失败', e.message)
  }
}

function normPage(data) {
  const limit = Math.min(Number(data.pageSize) || 20, 50)
  const page = Math.max(Number(data.page) || 0, 0)
  return { limit, page }
}

function escapeReg(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)
}

const ACTIONS = {
  /** 权限自检：进入后台前调用，返回当前管理员等级 */
  async whoami(data, ctx) {
    const me = await assertAdmin(ctx)
    return {
      openid: me.openid,
      level: me.level,
      nickname: (me.user && me.user.nickname) || '',
      rootCount: adminOpenids().length
    }
  },

  /** 数据概览：总量指标 + 近 7 天趋势 */
  async overview(data, ctx) {
    await assertAdmin(ctx)

    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const [
      userTotal, userToday,
      taskTotal, taskPending, taskAccepted, taskCompleted,
      postTotal, commentTotal, reportPending
    ] = await Promise.all([
      safeCount(db.collection(C_USER)),
      safeCount(db.collection(C_USER).where({ createdAt: _.gte(dayStart) })),
      safeCount(db.collection(C_TASK)),
      safeCount(db.collection(C_TASK).where({ status: STATUS.PENDING })),
      safeCount(db.collection(C_TASK).where({ status: STATUS.ACCEPTED })),
      safeCount(db.collection(C_TASK).where({ status: STATUS.COMPLETED })),
      safeCount(db.collection(C_POST)),
      safeCount(db.collection(C_COMMENT)),
      safeCount(db.collection(C_REPORT).where({ status: 'pending' }))
    ])

    // 近 7 天按天统计（7 次 count，量小可接受）
    const trend = []
    for (let i = 6; i >= 0; i--) {
      const start = new Date(dayStart.getTime() - i * 86400000)
      const end = new Date(start.getTime() + 86400000)
      const [t, u] = await Promise.all([
        safeCount(db.collection(C_TASK).where({ createdAt: _.gte(start).and(_.lt(end)) })),
        safeCount(db.collection(C_USER).where({ createdAt: _.gte(start).and(_.lt(end)) }))
      ])
      trend.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, tasks: t, users: u })
    }

    const maxVal = Math.max(1, ...trend.map((d) => Math.max(d.tasks, d.users)))
    const bars = trend.map((d) => ({
      label: d.label,
      tasks: d.tasks,
      users: d.users,
      taskH: Math.round((d.tasks / maxVal) * 100),
      userH: Math.round((d.users / maxVal) * 100)
    }))

    return {
      cards: [
        { key: 'users', label: '用户总数', value: userTotal, sub: `今日 +${userToday}` },
        { key: 'tasks', label: '任务总数', value: taskTotal, sub: `待接 ${taskPending}` },
        { key: 'running', label: '进行中', value: taskAccepted, sub: `已完成 ${taskCompleted}` },
        { key: 'reports', label: '待处理举报', value: reportPending, sub: `话题 ${postTotal} · 评论 ${commentTotal}` }
      ],
      bars
    }
  },

  /** 用户列表：关键词 / 状态 / 角色筛选 + 分页 */
  async userList(data, ctx) {
    await assertAdmin(ctx)
    const { limit, page } = normPage(data)

    const where = {}
    if (data.status) where.status = String(data.status)
    if (data.role) where.role = String(data.role)
    const kw = escapeReg(data.keyword)
    if (kw) {
      where.nickname = db.RegExp({ regexp: kw, options: 'i' })
    }

    const rows = await safeGet(
      db.collection(C_USER).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit + 1),
      []
    )
    const rootSet = adminOpenids()
    return {
      list: rows.slice(0, limit).map((u) => ({
        _id: u._id,
        openid: u.openid,
        nickname: u.nickname || '',
        avatarUrl: u.avatarUrl || '',
        status: u.status || 'active',
        role: u.role || 'user',
        creditScore: u.creditScore || 0,
        isRoot: rootSet.indexOf(u.openid) > -1,
        createdAt: u.createdAt
      })),
      hasMore: rows.length > limit
    }
  },

  /** 新增用户（预置档案，用于内部账号或数据迁移） */
  async userCreate(data, ctx) {
    const me = await assertAdmin(ctx)
    const nickname = String(data.nickname || '').trim()
    const openid = String(data.openid || '').trim()
    assert(nickname.length >= 2 && nickname.length <= 20, 'INVALID_PARAM', '昵称需 2-20 个字')
    assert(openid, 'INVALID_PARAM', '请填写 openid')

    const exist = await findUserByOpenid(openid)
    assert(!exist, 'ALREADY_EXISTS', '该 openid 已存在')

    const doc = {
      openid,
      nickname,
      avatarUrl: '',
      status: data.status === 'disabled' ? 'disabled' : 'active',
      role: data.role === 'admin' ? 'admin' : 'user',
      nicknameKey: 'n:' + nickname.toLowerCase(),
      nicknameChangeCount: 0,
      consent: true,
      creditScore: 100,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    const r = await addWithColl(C_USER, doc)
    await writeLog(me, 'user.create', { targetType: 'user', targetId: r._id, nickname })
    return { id: r._id }
  },

  /** 编辑用户资料 */
  async userUpdate(data, ctx) {
    const me = await assertAdmin(ctx)
    assert(data.id, 'INVALID_PARAM', '缺少用户 ID')
    const user = await findUserById(data.id)
    assert(user, 'NOT_FOUND', '用户不存在')

    const update = { updatedAt: db.serverDate() }
    if (data.nickname !== undefined) {
      const nickname = String(data.nickname).trim()
      assert(nickname.length >= 2 && nickname.length <= 20, 'INVALID_PARAM', '昵称需 2-20 个字')
      update.nickname = nickname
      update.nicknameKey = 'n:' + nickname.toLowerCase()
    }
    if (data.creditScore !== undefined) {
      const score = Number(data.creditScore)
      assert(!Number.isNaN(score) && score >= 0 && score <= 1000, 'INVALID_PARAM', '信用分需为 0-1000')
      update.creditScore = score
    }
    if (data.role !== undefined) {
      assert(me.level === 'root', 'FORBIDDEN', '只有超级管理员能调整角色')
      assert(!isRoot(user.openid), 'FORBIDDEN', '不能修改超级管理员的角色')
      update.role = data.role === 'admin' ? 'admin' : 'user'
    }

    await db.collection(C_USER).doc(data.id).update({ data: update })
    await writeLog(me, 'user.update', { targetType: 'user', targetId: data.id, keys: Object.keys(update) })
    return { id: data.id }
  },

  /** 启用 / 禁用（支持单个或批量） */
  async userSetStatus(data, ctx) {
    const me = await assertAdmin(ctx)
    const ids = Array.isArray(data.ids) ? data.ids : data.id ? [data.id] : []
    const status = data.status === 'disabled' ? 'disabled' : 'active'
    assert(ids.length > 0, 'INVALID_PARAM', '缺少用户 ID')
    assert(ids.length <= BATCH_MAX, 'INVALID_PARAM', `单次最多操作 ${BATCH_MAX} 条`)

    const affected = []
    for (const id of ids) {
      const user = await findUserById(id)
      if (!user) continue
      if (user.openid === me.openid) throw bizError('INVALID_PARAM', '不能操作自己的账号')
      if (isRoot(user.openid)) throw bizError('FORBIDDEN', '不能操作超级管理员')
      await db.collection(C_USER).doc(id).update({
        data: { status, updatedAt: db.serverDate() }
      })
      affected.push(id)
    }
    await writeLog(me, 'user.setStatus', { targetType: 'user', status, count: affected.length })
    return { count: affected.length }
  },

  /** 删除用户（物理删除，仅 root） */
  async userDelete(data, ctx) {
    const me = await assertAdmin(ctx)
    assert(me.level === 'root', 'FORBIDDEN', '只有超级管理员能删除用户')
    const ids = Array.isArray(data.ids) ? data.ids : data.id ? [data.id] : []
    assert(ids.length > 0, 'INVALID_PARAM', '缺少用户 ID')
    assert(ids.length <= BATCH_MAX, 'INVALID_PARAM', `单次最多操作 ${BATCH_MAX} 条`)

    let count = 0
    for (const id of ids) {
      const user = await findUserById(id)
      if (!user) continue
      if (user.openid === me.openid) throw bizError('INVALID_PARAM', '不能删除自己的账号')
      if (isRoot(user.openid)) throw bizError('FORBIDDEN', '不能删除超级管理员')
      await db.collection(C_USER).doc(id).remove()
      count++
    }
    await writeLog(me, 'user.delete', { targetType: 'user', count })
    return { count }
  },

  /** 内容列表：任务 / 话题 / 评论 */
  async contentList(data, ctx) {
    await assertAdmin(ctx)
    const type = String(data.type || '')
    assert(CONTENT_COLL[type], 'INVALID_PARAM', '内容类型不合法')
    const { limit, page } = normPage(data)

    const where = {}
    const kw = escapeReg(data.keyword)
    if (kw) {
      if (type === 'task') where.title = db.RegExp({ regexp: kw, options: 'i' })
      else where.content = db.RegExp({ regexp: kw, options: 'i' })
    }

    const rows = await safeGet(
      db
        .collection(CONTENT_COLL[type])
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip(page * limit)
        .limit(limit + 1),
      []
    )

    return {
      list: rows.slice(0, limit).map((r) => ({
        _id: r._id,
        title: r.title || '',
        content: r.content || '',
        nickname: r.nickname || '',
        status: r.status || '',
        openid: r.openid || r.ownerOpenid || '',
        createdAt: r.createdAt
      })),
      hasMore: rows.length > limit
    }
  },

  /** 删除内容（单个或批量，级联清理评论） */
  async contentRemove(data, ctx) {
    const me = await assertAdmin(ctx)
    const type = String(data.type || '')
    assert(CONTENT_COLL[type], 'INVALID_PARAM', '内容类型不合法')
    const ids = Array.isArray(data.ids) ? data.ids : data.id ? [data.id] : []
    assert(ids.length > 0, 'INVALID_PARAM', '缺少内容 ID')
    assert(ids.length <= BATCH_MAX, 'INVALID_PARAM', `单次最多操作 ${BATCH_MAX} 条`)

    const coll = CONTENT_COLL[type]
    let count = 0
    for (const id of ids) {
      try {
        await db.collection(coll).doc(id).remove()
        count++
        if (type === 'task' || type === 'post') {
          const targetType = type === 'task' ? 'task' : 'hall'
          await db.collection(C_COMMENT).where({ targetType, targetId: id }).remove().catch(() => {})
        }
      } catch (e) {
        console.warn('[admin] 删除内容失败', type, id, e.message)
      }
    }
    await writeLog(me, 'content.remove', { targetType: type, count })
    return { count }
  },

  /** 角色列表：所有管理员 */
  async roleList(data, ctx) {
    await assertAdmin(ctx)
    const { limit, page } = normPage(data)

    const rows = await safeGet(
      db.collection(C_USER).where({ role: 'admin' }).orderBy('createdAt', 'desc').skip(page * limit).limit(limit + 1),
      []
    )
    const rootSet = adminOpenids()
    return {
      // 根管理员来自环境变量，不在 users 里也能有权限
      roots: rootSet.map((openid) => ({ openid, level: 'root' })),
      admins: rows.slice(0, limit).map((u) => ({
        _id: u._id,
        nickname: u.nickname || '',
        openid: u.openid,
        status: u.status || 'active',
        isRoot: rootSet.indexOf(u.openid) > -1
      })),
      hasMore: rows.length > limit
    }
  },

  /** 授予 / 撤销管理员（仅 root） */
  async roleUpdate(data, ctx) {
    const me = await assertAdmin(ctx)
    assert(me.level === 'root', 'FORBIDDEN', '只有超级管理员能调整角色')
    assert(data.id, 'INVALID_PARAM', '缺少用户 ID')

    const user = await findUserById(data.id)
    assert(user, 'NOT_FOUND', '用户不存在')
    assert(!isRoot(user.openid), 'FORBIDDEN', '超级管理员权限来自环境变量，不能在后台调整')

    const role = data.role === 'admin' ? 'admin' : 'user'
    await db.collection(C_USER).doc(data.id).update({ data: { role, updatedAt: db.serverDate() } })
    await writeLog(me, 'role.update', { targetType: 'user', targetId: data.id, role })
    return { id: data.id, role }
  },

  /** 操作日志查询 */
  async logList(data, ctx) {
    await assertAdmin(ctx)
    const { limit, page } = normPage(data)

    const where = {}
    if (data.action) where.action = String(data.action)
    const kw = escapeReg(data.keyword)
    if (kw) where.operatorOpenid = db.RegExp({ regexp: kw, options: 'i' })

    const rows = await safeGet(
      db.collection(C_LOG).where(where).orderBy('createdAt', 'desc').skip(page * limit).limit(limit + 1),
      []
    )
    return {
      list: rows.slice(0, limit),
      hasMore: rows.length > limit
    }
  },

  /**
   * 举报列表（后台）
   * 支持 status / targetType 筛选，按时间倒序分页
   */
  async reportList(data, ctx) {
    await assertAdmin(ctx)
    const { limit, page } = normPage(data)

    const where = {}
    if (data.status) where.status = String(data.status)
    if (data.targetType) where.targetType = String(data.targetType)

    const rows = await safeGet(
      db
        .collection(C_REPORT)
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip(page * limit)
        .limit(limit + 1),
      []
    )

    return {
      list: rows.slice(0, limit).map((r) => ({
        _id: r._id,
        targetType: r.targetType,
        targetId: r.targetId,
        targetSnapshot: r.targetSnapshot || '',
        reason: r.reason || '',
        detail: r.detail || '',
        reporterNickname: r.reporterNickname || '',
        reporterOpenid: r.reporterOpenid || '',
        status: r.status || 'pending',
        handleAction: r.handleAction || '',
        handleNote: r.handleNote || '',
        handledAt: r.handledAt || null,
        createdAt: r.createdAt
      })),
      hasMore: rows.length > limit
    }
  },

  /**
   * 处置举报
   * action: resolve 已处理（仅标记）| ignore 忽略 | remove 删除内容并标记
   * 同一目标下的其它待处理举报会一并处理，避免重复劳动
   */
  async reportHandle(data, ctx) {
    const me = await assertAdmin(ctx)
    assert(data.id, 'INVALID_PARAM', '缺少举报 ID')

    const action = String(data.action || '')
    assert(['resolve', 'ignore', 'remove'].indexOf(action) > -1, 'INVALID_PARAM', '处理动作不合法')

    const report = await getDocById(C_REPORT, data.id)
    assert(report, 'NOT_FOUND', '举报记录不存在')
    assert(report.status === 'pending' || !report.status, 'STATUS_CONFLICT', '该举报已经处理过了')

    const note = String(data.note || '').slice(0, 200)

    if (action === 'remove') {
      const coll = CONTENT_COLL[report.targetType]
      assert(coll, 'INVALID_PARAM', '该目标类型不支持删除')
      await db.collection(coll).doc(report.targetId).remove().catch(() => {})
      if (report.targetType !== 'comment') {
        const targetType = report.targetType === 'task' ? 'task' : 'hall'
        await db
          .collection(C_COMMENT)
          .where({ targetType, targetId: report.targetId })
          .remove()
          .catch(() => {})
      }
    }

    const status = action === 'ignore' ? 'ignored' : action === 'remove' ? 'removed' : 'resolved'
    const patch = {
      status,
      handleAction: action,
      handleNote: note,
      handledBy: me.openid,
      handledAt: db.serverDate()
    }

    // 同目标的其他待处理举报一并结案
    await db
      .collection(C_REPORT)
      .where({ targetType: report.targetType, targetId: report.targetId, status: 'pending' })
      .update({ data: patch })
      .catch((e) => console.warn('[admin] 批量结案失败', e.message))

    await writeLog(me, 'report.' + action, {
      targetType: report.targetType,
      targetId: report.targetId,
      reportId: data.id,
      note
    })

    return { status }
  },

  /** 读取系统设置 */
  async settingsGet(data, ctx) {
    await assertAdmin(ctx)
    const rows = await safeGet(db.collection(C_SETTING).where({ key: 'global' }).limit(1), [])
    return { settings: Object.assign({}, DEFAULT_SETTINGS, rows[0] ? rows[0].value : {}) }
  },

  /** 保存系统设置 */
  async settingsSave(data, ctx) {
    const me = await assertAdmin(ctx)
    const input = data.settings || {}

    const maxReward = Number(input.maxReward)
    assert(!Number.isNaN(maxReward) && maxReward >= 0 && maxReward <= 100000, 'INVALID_PARAM', '赏金上限需为 0-100000')

    const reportThreshold = Number(input.reportThreshold)
    assert(
      !Number.isNaN(reportThreshold) && reportThreshold >= 1 && reportThreshold <= 100,
      'INVALID_PARAM',
      '举报阈值需为 1-100'
    )

    const value = {
      maxReward,
      reportThreshold,
      announcement: String(input.announcement || '').slice(0, 200),
      allowPublish: input.allowPublish !== false
    }

    const rows = await safeGet(db.collection(C_SETTING).where({ key: 'global' }).limit(1), [])
    if (rows.length) {
      await db.collection(C_SETTING).doc(rows[0]._id).update({ data: { value, updatedAt: db.serverDate() } })
    } else {
      await addWithColl(C_SETTING, { key: 'global', value, updatedAt: db.serverDate() })
    }
    await writeLog(me, 'settings.save', { targetType: 'settings', detail: value })
    return { settings: value }
  }
}

exports.main = async (event = {}) => {
  const { action = 'whoami', data = {} } = event
  const { OPENID } = cloud.getWXContext()
  const handler = ACTIONS[action]

  if (!handler) return fail('UNKNOWN_ACTION', `未知操作: ${action}`)

  try {
    return ok(await handler(data, { openid: OPENID }))
  } catch (e) {
    console.error('[admin]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
