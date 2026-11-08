/**
 * report 云函数：举报任务 / 话题 / 评论
 *
 * 设计取舍：
 *  - 举报只要求「已登录 + 状态正常」（V1–V3），**不要求昵称完整**（V4）。
 *    举报是安全兜底，门槛越低越好；资料不全的人也该能举报。
 *  - 同一用户对同一目标只能举报一次，避免刷单式举报。
 *  - 不能举报自己的内容。
 *  - 举报描述不过内容安全检测：举报文本本身常含辱骂引用，过检会误杀举报。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const C_REPORT = 'reports'
const C_USER = 'users'
const C_TASK = 'tasks'
const C_POST = 'posts'
const C_COMMENT = 'comments'

const TARGETS = {
  task: C_TASK,
  post: C_POST,
  comment: C_COMMENT
}

const REASONS = ['虚假信息', '违法违规', '骚扰辱骂', '涉嫌诈骗', '广告刷屏', '其他']

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

/** V1–V3：登录 + 状态正常（不校验昵称完整性） */
async function requireActiveUser(ctx) {
  if (!ctx.openid) throw bizError('UNAUTHORIZED', '请先登录后再操作')
  const rows = await safeGet(db.collection(C_USER).where({ openid: ctx.openid }).limit(1), [])
  const user = rows[0]
  if (!user || user.consent !== true) throw bizError('UNAUTHORIZED', '请先登录后再操作')
  if (user.status && user.status !== 'active') {
    throw bizError('ACCOUNT_BANNED', '账号状态异常，暂时无法操作')
  }
  return user
}

function adminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function getTarget(targetType, targetId) {
  try {
    const r = await db.collection(TARGETS[targetType]).doc(targetId).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

const ACTIONS = {
  /** 提交举报 */
  async create(data, ctx) {
    const user = await requireActiveUser(ctx)

    const targetType = String(data.targetType || '')
    const targetId = String(data.targetId || '')
    const reason = String(data.reason || '').trim()
    const detail = String(data.detail || '').trim().slice(0, 200)

    assert(TARGETS[targetType], 'INVALID_PARAM', '举报目标类型不合法')
    assert(targetId, 'INVALID_PARAM', '缺少举报目标 ID')
    assert(REASONS.indexOf(reason) > -1, 'INVALID_PARAM', '请选择举报理由')

    const target = await getTarget(targetType, targetId)
    assert(target, 'NOT_FOUND', '该内容不存在或已被删除')

    if (target.openid && target.openid === ctx.openid) {
      throw bizError('INVALID_PARAM', '不能举报自己发布的内容')
    }

    const dup = await safeGet(
      db
        .collection(C_REPORT)
        .where({ reporterOpenid: ctx.openid, targetType, targetId })
        .limit(1),
      []
    )
    if (dup.length) {
      throw bizError('ALREADY_REPORTED', '你已经举报过了，我们正在处理')
    }

    const doc = {
      targetType,
      targetId,
      targetOwnerOpenid: target.openid || '',
      // 留一份快照，内容被删后仍可追溯
      targetSnapshot: String(target.title || target.content || '').slice(0, 120),
      reason,
      detail,
      reporterOpenid: ctx.openid,
      reporterNickname: String(user.nickname || '').slice(0, 20),
      status: 'pending',
      createdAt: db.serverDate()
    }

    const r = await addWithColl(C_REPORT, doc)
    return { id: r._id }
  },

  /** 管理端：查询举报列表（仅 ADMIN_OPENIDS） */
  async list(data, ctx) {
    const allow = adminOpenids()
    if (ctx.openid && (!allow.length || allow.indexOf(ctx.openid) === -1)) {
      throw bizError('FORBIDDEN', '无权查看举报列表')
    }

    const limit = Math.min(Number(data.pageSize) || 20, 50)
    const page = Math.max(Number(data.page) || 0, 0)
    const where = {}
    if (data.status) where.status = String(data.status)

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
      list: rows.slice(0, limit),
      hasMore: rows.length > limit
    }
  },

  /** 举报理由枚举，前端可直接用，避免两边各写一份 */
  async reasons() {
    return { reasons: REASONS }
  }
}

exports.main = async (event = {}) => {
  const { action = 'create', data = {} } = event
  const { OPENID } = cloud.getWXContext()
  const handler = ACTIONS[action]

  if (!handler) return fail('UNKNOWN_ACTION', `未知操作: ${action}`)

  try {
    return ok(await handler(data, { openid: OPENID }))
  } catch (e) {
    console.error('[report]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
