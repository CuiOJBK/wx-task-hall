const { loginDirect } = require('../../utils/auth')
const { updateProfile } = require('../../services/user')

Page({
  data: {
    openid: '',
    authorized: false,
    profileComplete: false,
    // 昵称：canChangeNickname=false 表示那一次修改机会已用完
    canChangeNickname: true,
    nicknameChangeCount: 0,
    user: null,
    avatarText: '游',
    loginError: ''
  },

  async onShow() {
    const app = getApp()
    await app.userReady
    const user = app.globalData.user
    const nick = (user && user.nickname ? String(user.nickname) : '').trim()
    const changeCount = (user && user.nicknameChangeCount) || 0
    this.setData({
      openid: app.globalData.openid,
      authorized: !!app.globalData.authorized,
      profileComplete: !!app.globalData.profileComplete,
      nicknameChangeCount: changeCount,
      canChangeNickname: !nick ? true : changeCount < 1,
      user,
      avatarText: user && user.nickname ? user.nickname.charAt(0) : '游',
      loginError: app.globalData.loginError
    })
  },

  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    this.onShow()
  },

  /** 设置昵称：资料不完整的解锁入口（V4） */
  onEditNickname() {
    if (!this.data.canChangeNickname) {
      wx.showToast({ title: '昵称只能修改一次，已经用过了', icon: 'none' })
      return
    }
    const current = (this.data.user && this.data.user.nickname) || ''
    const isFirst = !String(current).trim()
    wx.showModal({
      title: isFirst ? '设置昵称' : '修改昵称（仅一次）',
      editable: true,
      placeholderText: '最多 20 个字',
      content: current,
      confirmText: '保存',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        const nickname = (res.content || '').trim()
        if (!nickname) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        if (nickname.length > 20) {
          wx.showToast({ title: '昵称最多 20 个字', icon: 'none' })
          return
        }
        wx.showLoading({ title: '保存中', mask: true })
        try {
          await updateProfile({ nickname })
          await getApp().refreshAuth()
          wx.hideLoading()
          wx.showToast({ title: '已保存', icon: 'success' })
          this.onShow()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: e.message || '保存失败', icon: 'none' })
        }
      }
    })
  },

  onCopyOpenid() {
    if (!this.data.openid) return
    wx.setClipboardData({ data: this.data.openid })
  },

  onGoTasks() {
    wx.switchTab({ url: '/pages/task/mine/index' })
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: '任务大厅小程序 v0.3.0\n技术栈：微信原生小程序 + 微信云开发',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
