/**
 * login 云函数：身份初始化 / 用户档案 / 昵称约束
 * 所有返回统一 { code: 0, data, msg }
 *
 * 昵称规则见 nickname.js 与 docs/nickname.md：
 *  - 首次设置昵称不占「修改」次数
 *  - 之后只能修改一次
 *  - 昵称全局唯一，判定不区分大小写
 */
const cloud = require('wx-server-sdk')
const {
  normalizeNickname,
  isValidNickname,
  nicknameKeyOf,
  placeholderKeyOf,
  nicknameChangeState,
  expectedKeyOf
} = require('./nickname')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const C_USERS = 'users'

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


/** 唯一索引冲突（E11000 duplicate key）判定 */
function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate key|E11000/i.test(msg)
}

/** 集合不存在时自动建，保证首次部署即可用 */
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

async function findUser(openid) {
  const rows = await safeGet(db.collection(C_USERS).where({ openid }).limit(1), [])
  return rows[0] || null
}

/** 管理员白名单（迁移接口用） */
function adminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 是否管理员：环境变量白名单 或 users.role = 'admin' */
function isAdminUser(user) {
  if (!user) return false
  if (adminOpenids().indexOf(user.openid) > -1) return true
  return user.role === 'admin' && (!user.status || user.status === 'active')
}

function assertAdmin(openid) {
  const allow = adminOpenids()
  // 控制台调用没有 openid，放行；客户端调用必须命中白名单
  if (!openid) return
  if (!allow.length || allow.indexOf(openid) === -1) {
    throw bizError('FORBIDDEN', '无权执行该操作')
  }
}

/**
 * 建档（仅在用户显式点击「微信一键登录」时调用，幂等）
 * consent=true 表示「用户确实点过登录」，用于把旧版自动建档的历史数据区分开
 */
async function ensureUser(openid) {
  const existed = await findUser(openid)
  const now = db.serverDate()

  if (existed) {
    const patch = {}
    if (!existed.consent) {
      patch.consent = true
      patch.registeredAt = now
    }
    // 兼容老数据：补齐昵称相关字段
    if (existed.nicknameChangeCount === undefined) patch.nicknameChangeCount = 0
    if (existed.nicknameKey === undefined) patch.nicknameKey = expectedKeyOf(existed)
    if (Object.keys(patch).length) {
      patch.updatedAt = now
      await db.collection(C_USERS).doc(existed._id).update({ data: patch }).catch(() => {})
    }
    return Object.keys(patch).length ? { ...existed, ...patch } : existed
  }

  const doc = {
    openid,
    nickname: '',
    // 唯一键占位：未设昵称时用 u:openid，保证唯一索引下每个文档都有唯一值
    nicknameKey: placeholderKeyOf(openid),
    nicknameChangeCount: 0,
    avatarUrl: '',
    status: 'active',
    consent: true,
    registeredAt: now,
    creditScore: 100,
    publishedCount: 0,
    takenCount: 0,
    createdAt: now,
    updatedAt: now
  }
  const r = await addWithColl(C_USERS, doc)
  return { ...doc, _id: r._id }
}

/** 是否属于「有效登录」：档案存在 + 状态正常 + 用户确实点过登录 */
function isActive(user) {
  if (!user) return false
  if (user.status && user.status !== 'active') return false
  return user.consent === true
}

/**
 * 资料是否完整（V4 判定依据）
 * 当前以「昵称非空」为准：头像需要云存储上传（TODO P1-1 未做），
 * 现在强制头像会把所有人都卡在资料页。
 */
function isProfileComplete(user) {
  if (!user) return false
  return !!normalizeNickname(user.nickname)
}

/** 给客户端用的昵称状态 */
function nicknameStateOf(user) {
  const st = nicknameChangeState(user)
  return {
    nickname: normalizeNickname(user && user.nickname),
    nicknameChangeCount: Number((user && user.nicknameChangeCount) || 0),
    canChangeNickname: st.allowed,
    isFirstSet: st.isFirstSet
  }
}

const ACTIONS = {
  /**
   * 只读：判断当前微信用户是否已建档。
   * 不建档 —— 这是匿名态成立的前提，也保证冷启动不产生脏数据。
   */
  async login(data, ctx) {
    if (!ctx.openid) throw bizError('UNAUTHORIZED', '无法识别用户身份')
    const user = await findUser(ctx.openid)
    return {
      openid: ctx.openid,
      authorized: isActive(user),
      profileComplete: isProfileComplete(user),
      isAdmin: isAdminUser(user),
      nickname: nicknameStateOf(user),
      status: user ? (user.consent ? user.status || 'active' : 'unregistered') : 'unregistered',
      user: user || null
    }
  },

  /** 显式登录：用户点击「微信一键登录」后建档 */
  async register(data, ctx) {
    if (!ctx.openid) throw bizError('UNAUTHORIZED', '无法识别用户身份')
    const user = await ensureUser(ctx.openid)
    if (!isActive(user)) throw bizError('ACCOUNT_DISABLED', '账号状态异常，暂时无法使用')
    return {
      openid: ctx.openid,
      authorized: true,
      profileComplete: isProfileComplete(user),
      isAdmin: isAdminUser(user),
      nickname: nicknameStateOf(user),
      status: user.status || 'active',
      user
    }
  },

  async profile(data, ctx) {
    const user = await findUser(ctx.openid)
    return {
      authorized: isActive(user),
      profileComplete: isProfileComplete(user),
      nickname: nicknameStateOf(user),
      user: user || null
    }
  },

  /**
   * 更新资料：昵称「首次设置不限、之后仅一次」+ 全局唯一
   *
   * 并发处理：
   *  1. 唯一性：先查重给友好提示；最终由 users.nicknameKey 的唯一索引兜底，
   *     命中 E11000 时同样返回 NICKNAME_TAKEN。
   *  2. 次数：条件更新 where({openid, nicknameChangeCount: 旧值})，
   *     只有一次能命中，第二次 stats.updated === 0 → NICKNAME_CHANGE_USED。
   */
  async updateProfile(data, ctx) {
    if (!ctx.openid) throw bizError('UNAUTHORIZED', '请先登录')
    const existed = await findUser(ctx.openid)
    if (!existed) throw bizError('UNAUTHORIZED', '请先登录')

    const rawNickname = typeof data.nickname === 'string' ? normalizeNickname(data.nickname) : ''
    const avatarUrl = (data.avatarUrl || '').trim()
    if (!rawNickname && !avatarUrl) throw bizError('INVALID_PARAM', '没有要更新的内容')

    const now = db.serverDate()
    const update = { updatedAt: now }
    let nicknameChanged = false

    if (rawNickname) {
      if (!isValidNickname(rawNickname)) {
        throw bizError('NICKNAME_INVALID', '昵称需 2-20 个字，不能是纯数字或特殊字符')
      }

      const current = normalizeNickname(existed.nickname)
      // 幂等：提交的就是当前昵称，直接成功，不消耗次数
      if (current && current === rawNickname) {
        if (avatarUrl) {
          await db.collection(C_USERS).where({ openid: ctx.openid }).update({ data: { avatarUrl, updatedAt: now } })
        }
        const user = await findUser(ctx.openid)
        return {
          user,
          profileComplete: isProfileComplete(user),
          nickname: nicknameStateOf(user),
          nicknameChanged: false
        }
      }

      const st = nicknameChangeState(existed)
      if (!st.allowed) {
        throw bizError('NICKNAME_CHANGE_USED', '昵称只能修改一次，你已经用过了')
      }

      await assertContentSafe(rawNickname, ctx.openid, 1)

      const key = nicknameKeyOf(rawNickname)
      const dup = await safeGet(db.collection(C_USERS).where({ nicknameKey: key }).limit(1), [])
      if (dup.length && dup[0].openid !== ctx.openid) {
        throw bizError('NICKNAME_TAKEN', '这个昵称已经有人用了，换一个吧')
      }

      update.nickname = rawNickname
      update.nicknameKey = key
      if (st.isFirstSet) {
        update.nicknameSetAt = now
      } else {
        update.nicknameChangeCount = 1
        update.nicknameChangedAt = now
      }
      nicknameChanged = true

      // 并发兜底：仅当次数仍等于读取时的值才写入
      const expectCount = Number(existed.nicknameChangeCount || 0)
      let res
      try {
        res = await db
          .collection(C_USERS)
          .where({ openid: ctx.openid, nicknameChangeCount: expectCount })
          .update({ data: update })
      } catch (e) {
        if (isDuplicateKeyError(e)) {
          throw bizError('NICKNAME_TAKEN', '这个昵称已经有人用了，换一个吧')
        }
        throw e
      }
      if (!res.stats || res.stats.updated !== 1) {
        throw bizError('NICKNAME_CHANGE_USED', '昵称只能修改一次，你已经用过了')
      }
    }

    if (avatarUrl) {
      await db.collection(C_USERS).where({ openid: ctx.openid }).update({ data: { avatarUrl, updatedAt: now } })
    }

    const user = await findUser(ctx.openid)
    return {
      user,
      profileComplete: isProfileComplete(user),
      nickname: nicknameStateOf(user),
      nicknameChanged
    }
  },

  /**
   * 昵称唯一键迁移（仅管理员）
   * 默认 dryRun，只报告不写库；传 { apply: true } 才真正落库。
   * 冲突处理：保留先注册者，后来者退回占位键并标记 nicknameConflict。
   */
  async migrateNicknameKey(data, ctx) {
    assertAdmin(ctx.openid)
    const dryRun = data.apply !== true
    const limit = 100
    let skip = 0
    const report = { total: 0, patched: 0, conflicts: [], dryRun }

    const seen = {}
    while (true) {
      const rows = await safeGet(
        db.collection(C_USERS).orderBy('createdAt', 'asc').skip(skip).limit(limit),
        []
      )
      if (!rows.length) break

      for (const u of rows) {
        report.total++
        const nick = normalizeNickname(u.nickname)
        let key = nick ? nicknameKeyOf(nick) : placeholderKeyOf(u.openid)
        let conflictWith = ''

        if (nick && seen[key]) {
          conflictWith = seen[key]
          report.conflicts.push({ openid: u.openid, nickname: nick, conflictWith })
          key = placeholderKeyOf(u.openid)
        } else if (nick) {
          seen[key] = u.openid
        }

        const patch = {}
        if (u.nicknameKey !== key) patch.nicknameKey = key
        if (u.nicknameChangeCount === undefined) patch.nicknameChangeCount = 0
        if (conflictWith && !u.nicknameConflict) patch.nicknameConflict = true
        if (!Object.keys(patch).length) continue

        report.patched++
        if (!dryRun) {
          await db.collection(C_USERS).doc(u._id).update({ data: patch }).catch((e) => {
            console.warn('[login] 迁移失败', u._id, e.message)
          })
        }
      }
      skip += limit
    }

    return report
  }
}

exports.main = async (event = {}) => {
  const { action = 'login', data = {} } = event
  const { OPENID } = cloud.getWXContext()
  const handler = ACTIONS[action]

  if (!handler) return fail('UNKNOWN_ACTION', `未知操作: ${action}`)

  try {
    return ok(await handler(data, { openid: OPENID }))
  } catch (e) {
    console.error('[login]', action, e)
    return fail(e.code || 'INTERNAL_ERROR', e.message || '服务异常')
  }
}
