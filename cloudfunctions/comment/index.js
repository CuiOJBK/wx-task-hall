/**
 * comment 云函数：两级评论（主楼 + 回复），任务评论与大厅话题回复共用
 *
 * 数据模型（comments 集合）：
 *   targetType  'task' | 'hall'
 *   targetId    任务 _id 或 话题 _id
 *   parentId    '' 表示主楼；非空表示二级回复，且父级必须是主楼
 *   openid/nickname  作者快照
 *   createdAt
 *
 * 两级结构是刻意限制的：微信小程序的评论体验里，超过两级几乎没人看得懂。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_COMMENT = 'comments'
const C_TASK = 'tasks'
const C_POST = 'posts'
const C_USER = 'users'

const TARGETS = ['task', 'hall']

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

/**
 * 人眼字数：emoji 是 4 字节字符，String.length 会算成 2，
 * 所以统一用 Array.from 按码点切分来计数，保证「30 个表情」不会顶成 60 个字。
 */
function charLength(text) {
  return Array.from(String(text || '')).length
}

/** 去掉控制字符（保留换行/制表符），对 emoji 无影响 */
function sanitize(text) {
  return String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** 登录校验（V1–V3）：评论读与写都要求已登录且状态正常 */
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

/** 写操作校验（V1–V4）：登录 + 状态正常 + 资料完整 */
async function requireWriter(ctx) {
  const user = await requireActiveUser(ctx)
  if (!String(user.nickname || '').trim()) {
    throw bizError('PROFILE_INCOMPLETE', '请先设置昵称后再操作')
  }
  return user
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

async function getDoc(collection, id) {
  try {
    const r = await db.collection(collection).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function getNickname(openid) {
  const rows = await safeGet(db.collection(C_USER).where({ openid }).limit(1), [])
  return (rows[0] && rows[0].nickname) || ''
}

/** 同步目标的评论计数，失败不回滚主流程 */
async function incCounter(targetType, targetId, delta) {
  const coll = targetType === 'task' ? C_TASK : C_POST
  const field = targetType === 'task' ? 'commentCount' : 'replyCount'
  try {
    await db
      .collection(coll)
      .doc(targetId)
      .update({ data: { [field]: _.inc(delta) } })
  } catch (e) {
    console.warn('[comment] 计数更新失败', targetType, targetId, e.message)
  }
}

/* ------------------------------ 业务动作 ------------------------------ */

async function addComment(data, ctx) {
  await requireWriter(ctx)
  const targetType = data.targetType
  const targetId = data.targetId
  const content = sanitize((data.content || '').trim())
  const parentId = data.parentId || ''

  assert(TARGETS.includes(targetType), 'INVALID_PARAM', '评论目标类型不合法')
  assert(targetId, 'INVALID_PARAM', '缺少评论目标 ID')
  assert(charLength(content) >= 1, 'INVALID_PARAM', '评论内容不能为空')
  assert(charLength(content) <= 300, 'INVALID_PARAM', '评论最多 300 个字（表情记 1 个字）')

  // 目标必须真实存在，避免脏数据
  const target = await getDoc(targetType === 'task' ? C_TASK : C_POST, targetId)
  assert(target, 'NOT_FOUND', '评论的目标不存在')

  if (parentId) {
    const parent = await getDoc(C_COMMENT, parentId)
    assert(parent, 'NOT_FOUND', '要回复的评论不存在')
    assert(!parent.parentId, 'INVALID_PARAM', '只支持两级评论')
    assert(parent.targetId === targetId, 'INVALID_PARAM', '评论与目标不匹配')
  }

  const nickname = await getNickname(ctx.openid)
  const doc = {
    targetType,
    targetId,
    parentId,
    content,
    replyToNickname: (data.replyToNickname || '').slice(0, 20),
    openid: ctx.openid,
    nickname,
    createdAt: db.serverDate()
  }

  const r = await addWithColl(C_COMMENT, doc)
  await incCounter(targetType, targetId, 1)
  return { id: r._id }
}

async function listComments(data, ctx) {
  await requireActiveUser(ctx)
  const { targetType, targetId } = data
  const limit = Math.min(Number(data.pageSize) || 20, 50)
  const page = Math.max(Number(data.page) || 0, 0)

  assert(TARGETS.includes(targetType), 'INVALID_PARAM', '评论目标类型不合法')
  assert(targetId, 'INVALID_PARAM', '缺少评论目标 ID')

  // 1) 主楼分页（新的在前）
  const mains = await safeGet(
    db
      .collection(C_COMMENT)
      .where({ targetType, targetId, parentId: '' })
      .orderBy('createdAt', 'desc')
      .skip(page * limit)
      .limit(limit),
    []
  )

  if (!mains.length) return { list: [], hasMore: false }

  // 2) 一次性取出这些主楼下的全部回复（限 100 条，超出走「查看更多回复」）
  const ids = mains.map((m) => m._id)
  const children = await safeGet(
    db
      .collection(C_COMMENT)
      .where({ targetType, targetId, parentId: _.in(ids) })
      .orderBy('createdAt', 'asc')
      .limit(100),
    []
  )

  const map = {}
  children.forEach((c) => {
    if (!map[c.parentId]) map[c.parentId] = []
    map[c.parentId].push(c)
  })

  return {
    list: mains.map((m) => ({ ...m, children: map[m._id] || [] })),
    hasMore: mains.length === limit
  }
}

async function removeComment(data, ctx) {
  await requireWriter(ctx)
  assert(data.id, 'INVALID_PARAM', '缺少评论 ID')
  const comment = await getDoc(C_COMMENT, data.id)
  assert(comment, 'NOT_FOUND', '评论不存在')
  assert(comment.openid === ctx.openid, 'FORBIDDEN', '只能删除自己的评论')

  const res = await db.collection(C_COMMENT).doc(data.id).remove()
  await incCounter(comment.targetType, comment.targetId, -1)

  // 主楼删除时，其下回复一并清理（两级结构，深度固定）
  if (!comment.parentId) {
    await db
      .collection(C_COMMENT)
      .where({ parentId: data.id })
      .remove()
      .catch(() => {})
  }

  return { id: data.id, removed: res.stats.removed }
}

const ACTIONS = {
  add: addComment,
  list: listComments,
  remove: removeComment
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
    console.error('[comment]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
