/**
 * 任务状态机（纯函数，不依赖 wx-server-sdk，便于单测）
 *
 * 状态流转：
 *   pending --grab--> accepted --submit--> confirming --confirm--> completed
 *   pending --cancel--> cancelled
 *
 * 权限规则：
 *   grab    任何人，但不能接自己发的
 *   submit  接单者
 *   confirm 发布者
 *   cancel  发布者
 */

const STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const RULES = {
  grab: { from: STATUS.PENDING, to: STATUS.ACCEPTED, actor: 'anyone-but-owner' },
  submit: { from: STATUS.ACCEPTED, to: STATUS.CONFIRMING, actor: 'taker' },
  confirm: { from: STATUS.CONFIRMING, to: STATUS.COMPLETED, actor: 'owner' },
  cancel: { from: STATUS.PENDING, to: STATUS.CANCELLED, actor: 'owner' }
}

/**
 * 判断一次流转是否被允许
 * @param {string} action grab | submit | confirm | cancel
 * @param {object|null} task 任务文档（含 status / ownerOpenid / takerOpenid）
 * @param {string} openid 操作人
 * @returns {{allowed:boolean, code?:string, msg?:string, from?:string, to?:string}}
 */
function evaluateTransition(action, task, openid) {
  const rule = RULES[action]
  if (!rule) return { allowed: false, code: 'UNKNOWN_ACTION', msg: '未知操作' }
  if (!task) return { allowed: false, code: 'NOT_FOUND', msg: '任务不存在或已删除' }
  if (!openid) return { allowed: false, code: 'UNAUTHORIZED', msg: '请先登录' }

  // 身份校验在状态校验之前，和原实现顺序保持一致
  if (rule.actor === 'owner' && task.ownerOpenid !== openid) {
    return { allowed: false, code: 'FORBIDDEN', msg: '只有发布者可以操作' }
  }
  if (rule.actor === 'taker' && task.takerOpenid !== openid) {
    return { allowed: false, code: 'FORBIDDEN', msg: '只有接单者可以操作' }
  }
  if (rule.actor === 'anyone-but-owner' && task.ownerOpenid === openid) {
    return { allowed: false, code: 'SELF_GRAB', msg: '不能接自己发布的任务' }
  }

  if (task.status !== rule.from) {
    return { allowed: false, code: 'STATUS_CONFLICT', msg: '任务当前状态不允许该操作' }
  }

  return { allowed: true, from: rule.from, to: rule.to }
}

/** 严格数值转换：null / undefined / 空串一律视为无效（Number(null) 会变成 0） */
function toCoord(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(v)
}

/** 球面距离（米），任一坐标非法返回 null */
function haversine(a, b) {
  const R = 6371000
  const rad = Math.PI / 180
  const lat1 = toCoord(a && a.latitude)
  const lng1 = toCoord(a && a.longitude)
  const lat2 = toCoord(b && b.latitude)
  const lng2 = toCoord(b && b.longitude)
  if ([lat1, lng1, lat2, lng2].some((v) => Number.isNaN(v))) return null
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

module.exports = { STATUS, RULES, evaluateTransition, haversine }
