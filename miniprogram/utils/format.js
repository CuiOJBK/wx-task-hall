/**
 * 展示层格式化工具：时间、金额、状态文本、任务装饰
 */
const { TASK_STATUS_LABEL } = require('./constants')

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 相对时间：刚刚 / 5分钟前 / 3小时前 / 2天前 / 2026-03-01 */
function timeAgo(input) {
  if (!input) return ''
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = 60 * 1000
  if (diff < min) return '刚刚'
  if (diff < 60 * min) return Math.floor(diff / min) + '分钟前'
  if (diff < 24 * 60 * min) return Math.floor(diff / (60 * min)) + '小时前'
  if (diff < 7 * 24 * 60 * min) return Math.floor(diff / (24 * 60 * min)) + '天前'
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 金额：12 -> 12.00（去掉多余小数） */
function yuan(v) {
  const n = Number(v || 0)
  if (!n) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** 状态文本 */
function statusText(status) {
  return TASK_STATUS_LABEL[status] || status || ''
}

/**
 * 位置展示文本
 * - 脱敏对象 { masked:true, regionText } → 只显示城市/区县
 * - 完整对象 → 地点名 · 地址
 */
function locationText(location) {
  if (!location) return ''
  if (location.masked) return location.regionText || '地址已隐藏'
  const name = location.name || ''
  const addr = location.address || ''
  if (name && addr && name !== addr) return `${name} · ${addr}`
  return name || addr
}

/**
 * 给任务对象补上视图字段，页面/组件直接用
 * 云函数返回的是原始文档，避免在 wxml 里写复杂表达式
 *
 * @param {object} task
 * @param {{maskAddress?: boolean}} opts maskAddress=true 时强制走脱敏展示
 *        （服务端已脱敏时是双保险；万一接口回的是完整地址，也不会漏到界面上）
 */
function decorateTask(task, opts = {}) {
  if (!task) return null
  const maskAddress = !!opts.maskAddress

  let locText = locationText(task.location)
  if (maskAddress) {
    locText = task.location && task.location.masked
      ? locationText(task.location)
      : '地址已隐藏'
  }

  return {
    ...task,
    statusText: statusText(task.status),
    rewardText: yuan(task.reward),
    timeText: timeAgo(task.createdAt),
    locationText: locText,
    descText: task.desc || '暂无描述'
  }
}

function decorateComment(c) {
  if (!c) return null
  return { ...c, timeText: timeAgo(c.createdAt) }
}

function decoratePost(p) {
  if (!p) return null
  return {
    ...p,
    timeText: timeAgo(p.createdAt),
    contentText: p.content || ''
  }
}

/**
 * 联系方式打码
 * 手机号：保留前 3 后 4；其他文本：保留首尾各 2 个字符
 */
function maskContact(text) {
  const s = String(text || '').trim()
  if (!s) return ''

  const digits = s.replace(/\D/g, '')
  // 按「数字序号」打码中间四位，保留原有分隔符（138-1234-5678 也能正确打码）
  if (digits.length === 11 && digits.charAt(0) === '1') {
    let di = -1
    return s.replace(/\d/g, (d) => {
      di++
      return di >= 3 && di <= 6 ? '*' : d
    })
  }
  if (s.length <= 2) return s.slice(0, 1) + '****'
  if (s.length <= 4) return s.slice(0, 1) + '****' + s.slice(-1)
  return s.slice(0, 2) + '****' + s.slice(-2)
}

module.exports = {
  maskContact,
  timeAgo,
  yuan,
  statusText,
  locationText,
  decorateTask,
  decorateComment,
  decoratePost
}
