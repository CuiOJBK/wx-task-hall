/**
 * post 云函数：任务大厅的公共交流话题（帖子）
 * 回复复用 comment 云函数，targetType = 'hall'
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_POST = 'posts'
const C_USER = 'users'
const C_LIKE = 'likes'

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

/** 人眼字数：emoji 按 1 个字计 */
function charLength(text) {
  return Array.from(String(text || '')).length
}

/** 登录校验（V1–V3）：话题读与写都要求已登录且状态正常 */
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

async function getDoc(id) {
  try {
    const r = await db.collection(C_POST).doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function getNickname(openid) {
  const rows = await safeGet(db.collection(C_USER).where({ openid }).limit(1), [])
  return (rows[0] && rows[0].nickname) || ''
}

/* ------------------------------ 业务动作 ------------------------------ */

async function createPost(data, ctx) {
  await requireWriter(ctx)
  const content = (data.content || '').trim()
  assert(charLength(content) >= 2, 'INVALID_PARAM', '内容至少 2 个字')
  assert(charLength(content) <= 500, 'INVALID_PARAM', '内容最多 500 字（表情记 1 个字）')

  const nickname = await getNickname(ctx.openid)
  const doc = {
    content,
    images: Array.isArray(data.images) ? data.images.slice(0, 9) : [],
    openid: ctx.openid,
    nickname,
    replyCount: 0,
    likeCount: 0,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }

  const r = await addWithColl(C_POST, doc)
  return { id: r._id }
}

async function listPosts(data, ctx) {
  await requireActiveUser(ctx)
  const limit = Math.min(Number(data.pageSize) || 10, 20)
  const page = Math.max(Number(data.page) || 0, 0)

  const rows = await safeGet(
    db.collection(C_POST).orderBy('createdAt', 'desc').skip(page * limit).limit(limit),
    []
  )
  if (!rows.length) return { list: [], hasMore: false }

  // 一次性查出当前用户对这批话题的点赞状态，避免 N+1
  const ids = rows.map((r) => r._id)
  const likes = await safeGet(
    db.collection(C_LIKE).where({ targetType: 'post', openid: ctx.openid, targetId: _.in(ids) }).limit(100),
    []
  )
  const likedSet = {}
  likes.forEach((l) => {
    likedSet[l.targetId] = true
  })

  return {
    list: rows.map((r) => ({ ...r, liked: !!likedSet[r._id] })),
    hasMore: rows.length === limit
  }
}

async function detailPost(data, ctx) {
  await requireActiveUser(ctx)
  assert(data.id, 'INVALID_PARAM', '缺少话题 ID')
  const post = await getDoc(data.id)
  assert(post, 'NOT_FOUND', '话题不存在或已删除')

  const mine = await safeGet(
    db.collection(C_LIKE).where({ targetType: 'post', targetId: data.id, openid: ctx.openid }).limit(1),
    []
  )
  return { post: { ...post, liked: mine.length > 0 } }
}

async function removePost(data, ctx) {
  await requireWriter(ctx)
  assert(data.id, 'INVALID_PARAM', '缺少话题 ID')
  const post = await getDoc(data.id)
  assert(post, 'NOT_FOUND', '话题不存在')
  assert(post.openid === ctx.openid, 'FORBIDDEN', '只能删除自己的话题')

  await db.collection(C_POST).doc(data.id).remove()

  // 连带清理该话题下的回复
  try {
    await db
      .collection('comments')
      .where({ targetType: 'hall', targetId: data.id })
      .remove()
  } catch (e) {
    console.warn('[post] 清理回复失败', e.message)
  }

  return { id: data.id }
}

/**
 * 话题点赞 / 取消点赞（切换）
 * 依赖 likes 集合做去重：同一用户对同一话题只有一条记录
 */
async function likePost(data, ctx) {
  await requireWriter(ctx)
  assert(data.id, 'INVALID_PARAM', '缺少话题 ID')

  const post = await getDoc(data.id)
  assert(post, 'NOT_FOUND', '话题不存在或已删除')

  const exists = await safeGet(
    db.collection(C_LIKE).where({ targetType: 'post', targetId: data.id, openid: ctx.openid }).limit(1),
    []
  )

  let liked
  if (exists.length) {
    await db.collection(C_LIKE).doc(exists[0]._id).remove()
    liked = false
  } else {
    await addWithColl(C_LIKE, {
      targetType: 'post',
      targetId: data.id,
      openid: ctx.openid,
      createdAt: db.serverDate()
    })
    liked = true
  }

  // 计数用 inc 原子增减，避免并发覆盖
  await db
    .collection(C_POST)
    .doc(data.id)
    .update({ data: { likeCount: _.inc(liked ? 1 : -1) } })
    .catch((e) => console.warn('[post] 点赞计数更新失败', e.message))

  const latest = await getDoc(data.id)
  return {
    liked,
    likeCount: Math.max(0, (latest && latest.likeCount) || 0)
  }
}

const ACTIONS = {
  create: createPost,
  list: listPosts,
  detail: detailPost,
  remove: removePost,
  like: likePost
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
    console.error('[post]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
