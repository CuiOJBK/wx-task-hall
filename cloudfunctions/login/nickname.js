/**
 * 昵称规则（纯函数，不依赖 wx-server-sdk，便于单测）
 *
 * 两条约束：
 *  1. 昵称只能「修改」一次。首次设置（从空到有）不占次数，否则新用户一设昵称就被锁死。
 *  2. 昵称不可重复。判定**不区分大小写**，并忽略首尾/连续空白：
 *     "Tom" 与 " tom " 视为同一个，避免用大小写冒充他人。
 *
 * 唯一键设计（nicknameKey）：
 *   已设昵称 → 'n:' + 归一化小写昵称
 *   未设昵称 → 'u:' + openid      （占位键，保证唯一索引下每个文档都有唯一值）
 * 这样 users.nicknameKey 可以直接建唯一索引，且不会因为「很多人还没设昵称」而冲突。
 */

const NICK_MIN = 2
const NICK_MAX = 20

/** 归一化：全角空格转半角、压缩连续空白、去首尾 */
function normalizeNickname(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 人眼字数（emoji 记 1） */
function charLength(text) {
  return Array.from(String(text || '')).length
}

/** 合法性：2-20 字、不含控制字符、不能是纯数字 */
function isValidNickname(nickname) {
  const n = normalizeNickname(nickname)
  if (!n) return false
  const len = charLength(n)
  if (len < NICK_MIN || len > NICK_MAX) return false
  if (/[\u0000-\u001f\u007f]/.test(n)) return false
  if (/^[0-9\s]+$/.test(n)) return false
  return true
}

/** 去重键：不区分大小写 */
function nicknameKeyOf(nickname) {
  return 'n:' + normalizeNickname(nickname).toLowerCase()
}

/** 未设置昵称时的占位键 */
function placeholderKeyOf(openid) {
  return 'u:' + String(openid || '')
}

/**
 * 是否还能设置/修改昵称
 * @param {{nickname?:string, nicknameChangeCount?:number}} user
 * @returns {{allowed:boolean, isFirstSet:boolean, reason?:string}}
 */
function nicknameChangeState(user) {
  const current = normalizeNickname(user && user.nickname)
  if (!current) {
    return { allowed: true, isFirstSet: true }
  }
  const used = Number((user && user.nicknameChangeCount) || 0)
  if (used >= 1) {
    return { allowed: false, isFirstSet: false, reason: 'NICKNAME_CHANGE_USED' }
  }
  return { allowed: true, isFirstSet: false }
}

/** 该文档应使用的 nicknameKey */
function expectedKeyOf(user) {
  const nick = normalizeNickname(user && user.nickname)
  if (nick) return nicknameKeyOf(nick)
  return placeholderKeyOf(user && user.openid)
}

module.exports = {
  NICK_MIN,
  NICK_MAX,
  normalizeNickname,
  charLength,
  isValidNickname,
  nicknameKeyOf,
  placeholderKeyOf,
  nicknameChangeState,
  expectedKeyOf
}
