/**
 * 任务服务：只负责「参数 -> 云函数 -> 数据装饰」，不含业务规则
 * 业务规则全部在 cloudfunctions/task/index.js，前端不可信
 */
const { call } = require('../utils/cloud')
const { decorateTask } = require('../utils/format')
const { formatDistance } = require('../utils/location')
const config = require('../config/index')

/**
 * 任务列表（任务大厅）
 * @param {object} p { status, page, pageSize, center:{latitude,longitude}, keyword }
 */
async function listTasks(p = {}) {
  const res = await call('task', 'list', {
    status: p.status || 'pending',
    page: p.page || 0,
    pageSize: p.pageSize || config.pageSize,
    keyword: p.keyword || '',
    center: p.center || null
  })
  const d = res.data || {}
  const anonymous = !!d.anonymous
  return {
    list: (d.list || []).map((t) => {
      // 匿名强制走脱敏展示，服务端已脱敏时这里只是双保险
      const view = decorateTask(t, { maskAddress: anonymous })
      // 距离能反推位置，匿名不给
      if (!anonymous && t.distance != null) view.distanceText = formatDistance(t.distance)
      return view
    }),
    hasMore: !!d.hasMore,
    // 服务端下发的匿名标记：true 表示当前是受限浏览，前端据此切换渲染模式
    anonymous,
    total: d.total || 0
  }
}

async function getTask(id) {
  const res = await call('task', 'detail', { id })
  const d = res.data || {}
  return {
    task: decorateTask(d.task),
    // 服务端下发的操作权限，避免前端猜测
    permissions: d.permissions || {}
  }
}

async function createTask(payload) {
  const res = await call('task', 'create', payload)
  return res.data
}

async function grabTask(id) {
  const res = await call('task', 'grab', { id })
  return res.data
}

async function submitTask(id) {
  const res = await call('task', 'submit', { id })
  return res.data
}

async function confirmTask(id) {
  const res = await call('task', 'confirm', { id })
  return res.data
}

async function cancelTask(id) {
  const res = await call('task', 'cancel', { id })
  return res.data
}

/**
 * 我的任务
 * @param {'owner'|'taker'} role
 */
async function myTasks(role = 'owner', p = {}) {
  const res = await call('task', 'mine', {
    role,
    page: p.page || 0,
    pageSize: p.pageSize || config.pageSize
  })
  const d = res.data || {}
  return { list: (d.list || []).map(decorateTask), hasMore: !!d.hasMore }
}

module.exports = {
  listTasks,
  getTask,
  createTask,
  grabTask,
  submitTask,
  confirmTask,
  cancelTask,
  myTasks
}
