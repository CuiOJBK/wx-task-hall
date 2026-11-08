const { initCloud, login, clearLoginCache, setAuthErrorHandler } = require('./utils/cloud')
const { handleAuthError } = require('./utils/auth')

App({
  globalData: {
    openid: '',
    // 是否已完成微信一键登录（建档）。匿名用户为 false
    authorized: false,
    // 资料是否完整（昵称非空）。决定能否执行写操作
    profileComplete: false,
    isAdmin: false,
    user: null,
    loginError: ''
  },

  onLaunch() {
    const ok = initCloud()
    if (!ok) return

    // 注入统一授权错误处理器：接口返回 401/403 类错误时由它决定弹登录/跳资料/清态
    setAuthErrorHandler(handleAuthError)

    // 冷启动只读取授权状态，不建档 —— 保证匿名态真实存在
    this.userReady = this.refreshAuth()
  },

  /**
   * 重新读取授权状态，登录成功后也用它刷新
   * @returns {Promise<{openid:string, authorized:boolean, user:object|null}|null>}
   */
  async refreshAuth() {
    clearLoginCache()
    try {
      const d = await login()
      this.globalData.openid = (d && d.openid) || ''
      this.globalData.authorized = !!(d && d.authorized)
      this.globalData.profileComplete = !!(d && d.profileComplete)
      this.globalData.isAdmin = !!(d && d.isAdmin)
      this.globalData.user = (d && d.user) || null
      this.globalData.loginError = ''
      console.log('[app] 授权状态：', this.globalData.authorized ? '已登录' : '匿名')
      return d
    } catch (e) {
      this.globalData.loginError = e.message || '登录状态读取失败'
      console.error('[app] 读取授权状态失败：', e.message)
      return null
    }
  },

  /** 清空本地登录态（被封禁 / 主动退出时调用） */
  clearAuth() {
    clearLoginCache()
    this.globalData.openid = ''
    this.globalData.authorized = false
    this.globalData.profileComplete = false
    this.globalData.isAdmin = false
    this.globalData.user = null
  }
})
