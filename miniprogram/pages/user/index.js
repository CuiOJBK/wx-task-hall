const { loginDirect } = require('../../utils/auth')
const { showError } = require('../../utils/ui')
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
    nickInput: '',
    avatarText: '游',
    uploading: false,
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
      nickInput: nick,
      avatarText: nick ? nick.charAt(0) : '游',
      loginError: app.globalData.loginError
    })
  },

  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    this.onShow()
  },

  /** 头像：微信官方 open-type="chooseAvatar"，拿到临时路径后上传云存储 */
  async onChooseAvatar(e) {
    const tempPath = e && e.detail && e.detail.avatarUrl
    if (!tempPath) return
    if (this.data.uploading) return

    this.setData({ uploading: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const fileID = await this.uploadAvatar(tempPath)
      await updateProfile({ avatarUrl: fileID })
      await getApp().refreshAuth()
      wx.hideLoading()
      wx.showToast({ title: '头像已更新', icon: 'success' })
      this.onShow()
    } catch (err) {
      wx.hideLoading()
      showError(err, '头像更新失败')
    } finally {
      this.setData({ uploading: false })
    }
  },

  /** 上传到云存储，返回 fileID */
  uploadAvatar(filePath) {
    return new Promise((resolve, reject) => {
      const ext = (String(filePath).match(/\.\w+$/) || ['.png'])[0]
      const openid = (getApp().globalData.openid || 'guest').slice(0, 12)
      const cloudPath = `avatars/${openid}_${Date.now()}${ext}`
      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: (res) => {
          if (res && res.fileID) resolve(res.fileID)
          else reject(new Error('上传失败，请重试'))
        },
        fail: (err) => reject(new Error((err && err.errMsg) || '上传失败'))
      })
    })
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value })
  },

  /** 保存昵称：首次设置不占次数，之后仅一次，且全局唯一 */
  async onSaveNickname() {
    if (!this.data.canChangeNickname) {
      wx.showToast({ title: '昵称只能修改一次，已经用过了', icon: 'none' })
      return
    }
    const nickname = (this.data.nickInput || '').trim()
    const current = ((this.data.user && this.data.user.nickname) || '').trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    if (nickname === current) {
      wx.showToast({ title: '昵称没有变化', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中', mask: true })
    try {
      await updateProfile({ nickname })
      await getApp().refreshAuth()
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.onShow()
    } catch (err) {
      wx.hideLoading()
      showError(err, '保存失败')
    }
  },

  onCopyOpenid() {
    if (!this.data.openid) return
    wx.setClipboardData({ data: this.data.openid })
  },

  onGoTasks() {
    wx.switchTab({ url: '/pages/task/mine/index' })
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index?tab=terms' })
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: '任务大厅小程序 v0.4.0\n技术栈：微信原生小程序 + 微信云开发',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
