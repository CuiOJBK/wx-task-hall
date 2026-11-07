/**
 * 用户服务
 */
const { call } = require('../utils/cloud')

async function getProfile() {
  const res = await call('login', 'profile', {})
  return res.data
}

/**
 * 微信一键注册/登录：建档（幂等）
 * 只有用户显式点击登录时才调用；冷启动只读不建档
 */
async function register() {
  const res = await call('login', 'register', {})
  return res.data
}

/**
 * 更新昵称/头像（微信新版要求用 chooseAvatar + nickname input 获取，不再返回真实昵称头像）
 */
async function updateProfile({ nickname, avatarUrl }) {
  const res = await call('login', 'updateProfile', { nickname, avatarUrl })
  return res.data
}

module.exports = { getProfile, register, updateProfile }
