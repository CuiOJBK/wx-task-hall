/**
 * 管理后台服务层：所有请求都走 admin 云函数，权限在服务端判定
 */
const { call } = require('../utils/cloud')

const wrap = (action, fn) => async (payload = {}) => {
  const res = await call('admin', action, payload)
  return fn ? fn(res.data) : res.data
}

const whoami = wrap('whoami')
const overview = wrap('overview')

const userList = wrap('userList', (d) => ({
  list: d.list || [],
  hasMore: !!d.hasMore
}))
const userCreate = wrap('userCreate')
const userUpdate = wrap('userUpdate')
const userSetStatus = wrap('userSetStatus')
const userDelete = wrap('userDelete')

const contentList = wrap('contentList', (d) => ({
  list: d.list || [],
  hasMore: !!d.hasMore
}))
const contentRemove = wrap('contentRemove')

const roleList = wrap('roleList', (d) => ({
  roots: d.roots || [],
  admins: d.admins || [],
  hasMore: !!d.hasMore
}))
const roleUpdate = wrap('roleUpdate')

const logList = wrap('logList', (d) => ({
  list: d.list || [],
  hasMore: !!d.hasMore
}))

const settingsGet = wrap('settingsGet')
const settingsSave = wrap('settingsSave')

module.exports = {
  whoami,
  overview,
  userList,
  userCreate,
  userUpdate,
  userSetStatus,
  userDelete,
  contentList,
  contentRemove,
  roleList,
  roleUpdate,
  logList,
  settingsGet,
  settingsSave
}
