/**
 * 授权守卫：统一处理「未登录 → 登录 → 登录成功」
 *
 * 规则依据：docs/auth-rules.md
 *  - 匿名只能浏览任务大厅 10 条摘要
 *  - 其余页面与所有写操作都要登录
 *  - 前端拦截只做体验，服务端仍会独立校验（不可绕过）
 *
 * ⚠️ 踩过的坑：wx.showModal 的 confirmText / cancelText **最多 4 个字符**，
 *    超过会导致调用直接 fail（不弹窗、不报错到界面），表现就是「点了没反应」。
 *    所以这里做了长度兜底，并在 fail 时打日志，不要静默吞掉。
 */
const { register } = require('../services/user')

/** showModal 按钮文案上限 */
const BTN_TEXT_MAX = 4

function isAuthorized() {
  const app = getApp()
  return !!(app && app.globalData && app.globalData.authorized)
}

/** 资料是否完整（昵称非空）。判定逻辑必须与服务端保持一致 */
function isProfileComplete() {
  const app = getApp()
  return !!(app && app.globalData && app.globalData.profileComplete)
}

function safeBtnText(text, fallback) {
  const t = (text || fallback || '').trim()
  if (!t) return fallback
  return t.length > BTN_TEXT_MAX ? t.slice(0, BTN_TEXT_MAX) : t
}

/**
 * 直接登录：用于「微信一键登录」这类**本身就是登录动作**的按钮。
 * 不再弹确认框 —— 用户点的就是登录，多一层确认反而多余。
 * @returns {Promise<boolean>}
 */
async function loginDirect() {
  const app = getApp()
  await Promise.resolve(app && app.userReady)

  if (isAuthorized()) return true
  if (loginDirect._running) return false
  loginDirect._running = true

  wx.showLoading({ title: '登录中', mask: true })
  try {
    const d = await register()
    const refreshed = await app.refreshAuth()
    wx.hideLoading()

    if (!isAuthorized()) {
      // 区分两种失败：状态真异常 vs 状态没读回来（网络/云环境问题）
      if (!refreshed) {
        wx.showToast({ title: '登录状态获取失败，请重试', icon: 'none' })
        return false
      }
      const status = (d && d.status) || ''
      wx.showModal({
        title: status === 'banned' ? '账号已被封禁' : '账号状态异常',
        content: '当前账号暂时无法使用，如有疑问可联系客服申诉。',
        showCancel: false,
        confirmText: '知道了'
      })
      return false
    }

    wx.showToast({ title: '登录成功', icon: 'success' })
    return true
  } catch (e) {
    wx.hideLoading()
    console.error('[auth] 登录失败：', (e && e.code) || '', (e && e.message) || e)
    wx.showToast({ title: (e && e.message) || '登录失败，请重试', icon: 'none' })
    return false
  } finally {
    loginDirect._running = false
  }
}

/**
 * 拦截式登录：用户想做一个需要登录的操作时调用，先弹确认再登录。
 * @param {object} opts { title, content, confirmText }
 * @returns {Promise<boolean>}
 */
function ensureAuthorized(opts = {}) {
  const title = opts.title || '登录后才能继续'
  const content =
    opts.content || '确认身份后即可查看完整内容并参与互动，我们只获取你的微信标识，不会读取其他信息。'
  const confirmText = safeBtnText(opts.confirmText, '微信登录')

  return new Promise((resolve) => {
    const app = getApp()
    Promise.resolve(app && app.userReady).then(() => {
      if (isAuthorized()) {
        resolve(true)
        return
      }
      wx.showModal({
        title,
        content,
        confirmText,
        cancelText: '再看看',
        confirmColor: '#ff5a1f',
        success: async (res) => {
          if (!res.confirm) {
            resolve(false)
            return
          }
          resolve(await loginDirect())
        },
        fail: (err) => {
          // 关键：不要静默吞掉。showModal 失败在界面上就是「点了没反应」
          console.error('[auth] showModal 失败：', (err && err.errMsg) || err)
          resolve(false)
        }
      })
    })
  })
}

/**
 * 确保资料完整（V4）。未完善时引导去「我的」页设置昵称。
 * @returns {Promise<boolean>}
 */
function ensureProfile(opts = {}) {
  const title = opts.title || '先完善昵称'
  return new Promise((resolve) => {
    if (isProfileComplete()) {
      resolve(true)
      return
    }
    wx.showModal({
      title,
      content: '设置昵称后即可发布任务、接单和评论，方便对方知道是谁在操作。',
      confirmText: '去设置',
      cancelText: '取消',
      confirmColor: '#ff5a1f',
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({ url: '/pages/user/index' })
        }
        resolve(false)
      },
      fail: (err) => {
        console.error('[auth] showModal 失败：', (err && err.errMsg) || err)
        resolve(false)
      }
    })
  })
}

/**
 * 统一把接口错误码翻译成用户动作。
 * @returns {Promise<boolean>} 是否已处理（true 表示调用方不必再弹自己的提示）
 */
async function handleAuthError(err) {
  const code = err && err.code
  if (code === 'UNAUTHORIZED') {
    return await ensureAuthorized({ title: '登录已失效，请重新登录' })
  }
  if (code === 'PROFILE_INCOMPLETE') {
    await ensureProfile()
    return true
  }
  if (code === 'ACCOUNT_BANNED' || code === 'ACCOUNT_DISABLED') {
    const app = getApp()
    if (app && app.clearAuth) app.clearAuth()
    wx.showModal({
      title: code === 'ACCOUNT_BANNED' ? '账号已被封禁' : '账号已停用',
      content: '如有疑问可联系客服申诉。',
      showCancel: false,
      confirmText: '知道了'
    })
    return true
  }
  return false
}

module.exports = {
  isAuthorized,
  isProfileComplete,
  loginDirect,
  ensureAuthorized,
  ensureProfile,
  handleAuthError
}
