const taskService = require('../../../services/task')
const { showError } = require('../../../utils/ui')
const locationUtil = require('../../../utils/location')
const config = require('../../../config/index')
const { ensureAuthorized, ensureProfile } = require('../../../utils/auth')

Page({
  data: {
    title: '',
    desc: '',
    reward: '',
    contact: '',
    location: null,
    locationText: '',
    submitting: false,
    mapEnabled: config.features.mapPicker
  },

  async onLoad() {
    // 发布页必须已登录，未登录直接引导，取消则退回上一页
    const ok = await ensureAuthorized({ title: '登录后才能发布任务' })
    if (!ok) {
      wx.navigateBack()
      return
    }
    // V4：资料不完整先让用户设昵称，别等填完表单才被拒
    const profileOk = await ensureProfile({ title: '先完善昵称再发布' })
    if (!profileOk) wx.navigateBack()
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async onChooseLocation() {
    try {
      const loc = await locationUtil.chooseLocation()
      this.setData({
        location: loc,
        locationText: loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`
      })
    } catch (err) {
      if (err.code === 'CANCELLED') return
      showError(err, '操作失败')
    }
  },

  onClearLocation() {
    this.setData({ location: null, locationText: '' })
  },

  validate() {
    const { title, reward } = this.data
    if (!title || title.trim().length < 4) {
      wx.showToast({ title: '标题至少 4 个字', icon: 'none' })
      return false
    }
    if (reward !== '' && (Number.isNaN(Number(reward)) || Number(reward) < 0)) {
      wx.showToast({ title: '赏金需为不小于 0 的数字', icon: 'none' })
      return false
    }
    return true
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.validate()) return

    const app = getApp()
    await app.userReady
    if (!app.globalData.authorized) {
      const ok = await ensureAuthorized({ title: '登录后才能发布任务' })
      if (!ok) return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })
    try {
      const { title, desc, reward, contact, location } = this.data
      await taskService.createTask({
        title: title.trim(),
        desc: (desc || '').trim(),
        reward: Number(reward || 0),
        contact: (contact || '').trim(),
        location
      })
      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      // 让大厅刷新
      const pages = getCurrentPages()
      const hall = pages.find((p) => p.route === 'pages/hall/index')
      if (hall && hall.refresh) hall.refresh()
      setTimeout(() => wx.navigateBack(), 600)
    } catch (err) {
      wx.hideLoading()
      showError(err, '发布失败')
    } finally {
      this.setData({ submitting: false })
    }
  }
})
