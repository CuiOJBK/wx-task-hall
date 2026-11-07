/**
 * 云开发调用层：初始化、统一入参/返回、统一错误、登录态缓存
 */
const config = require('../config/index')

let loginPromise = null

function initCloud() {
  if (!wx.cloud) {
    console.error('[cloud] 基础库版本过低，请使用 2.2.3 及以上')
    return false
  }
  wx.cloud.init({
    env: config.envId || wx.cloud.DYNAMIC_CURRENT_ENV,
    traceUser: true
  })
  return true
}

/** 需要统一处理的错误码：由注册的处理器决定弹登录/跳资料/清态 */
const AUTH_CODES = ['UNAUTHORIZED', 'PROFILE_INCOMPLETE', 'ACCOUNT_BANNED', 'ACCOUNT_DISABLED']

let authErrorHandler = null
let handlingAuthError = false

/**
 * 注册授权错误处理器（由 app.js 注入，避免 cloud → auth → services → cloud 的循环依赖）
 */
function setAuthErrorHandler(fn) {
  authErrorHandler = typeof fn === 'function' ? fn : null
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {string} action 业务动作（云函数内部路由）
 * @param {object} data 业务参数
 * @returns {Promise<{code:number,data:any,msg:string}>}
 */
function call(name, action, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: { action, data },
      success: (res) => {
        const r = (res && res.result) || {}
        if (r.code === 0) {
          resolve(r)
          return
        }
        const err = new Error(r.msg || '请求失败')
        err.code = r.code
        err.action = `${name}.${action}`

        // 授权类错误交给统一层处理，页面不必再弹一次（err.silent）
        if (AUTH_CODES.indexOf(r.code) > -1) {
          err.silent = true
          if (authErrorHandler && !handlingAuthError) {
            handlingAuthError = true
            Promise.resolve(authErrorHandler(err))
              .catch((e) => console.error('[cloud] 授权错误处理失败', e))
              .then(() => {
                handlingAuthError = false
              })
          }
        }
        reject(err)
      },
      fail: (raw) => {
        const err = new Error(`云函数 ${name} 调用失败，请确认已部署`)
        err.code = 'CLOUD_FAIL'
        err.raw = raw
        reject(err)
      }
    })
  })
}

/**
 * 登录：拿 openid + 授权状态（只读，不会建档）
 */
function login() {
  if (!loginPromise) {
    loginPromise = call('login', 'login', {}).then((r) => r.data)
  }
  return loginPromise
}

/** 清除登录缓存，用于登录成功后重新拉取档案 */
function clearLoginCache() {
  loginPromise = null
}

module.exports = { initCloud, call, login, clearLoginCache, setAuthErrorHandler }
