const taskService = require('../../../services/task')
const { showError } = require('../../../utils/ui')
const locationUtil = require('../../../utils/location')
const config = require('../../../config/index')
const { ensureAuthorized, ensureProfile } = require('../../../utils/auth')
const { MAX_IMAGES, chooseImages, uploadImages } = require('../../../utils/upload')

Page({
  data: {
    title: '',
    desc: '',
    reward: '',
    contact: '',
    location: null,
    locationText: '',
    submitting: false,
    mapEnabled: config.features.mapPicker,
    // 平台设置：赏金上限 / 是否允许发布 / 公告
    platform: { maxReward: 500, allowPublish: true, announcement: '' },
    // 最多 3 张，上传前是本地临时路径
    images: [],
    maxImages: MAX_IMAGES
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
    if (!profileOk) {
      wx.navigateBack()
      return
    }

    await this.loadPlatformSettings()
  },

  /** 读取平台设置（公开接口，无需管理员） */
  async loadPlatformSettings() {
    try {
      const d = await taskService.getSettings()
      this.setData({ platform: d })
      if (!d.allowPublish) {
        wx.showModal({
          title: '暂停发布',
          content: '平台当前暂停发布新任务，请稍后再来。',
          showCancel: false,
          confirmText: '返回',
          success: () => wx.navigateBack()
        })
      }
    } catch (e) {
      // 设置读取失败不阻断发布，服务端仍会兜底校验
      console.warn('[publish] 读取平台设置失败', e.message)
    }
  },

  /** 选图（本地暂存，提交时统一上传） */
  async onChooseImage() {
    try {
      const paths = await chooseImages(this.data.images.length)
      if (!paths.length) return
      this.setData({ images: this.data.images.concat(paths).slice(0, MAX_IMAGES) })
    } catch (e) {
      showError(e, '选择图片失败')
    }
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({ current: this.data.images[index], urls: this.data.images })
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
    const { title, reward, platform } = this.data
    if (!title || title.trim().length < 4) {
      wx.showToast({ title: '标题至少 4 个字', icon: 'none' })
      return false
    }
    if (reward !== '' && (Number.isNaN(Number(reward)) || Number(reward) < 0)) {
      wx.showToast({ title: '赏金需为不小于 0 的数字', icon: 'none' })
      return false
    }
    const max = Number(platform.maxReward)
    if (reward !== '' && !Number.isNaN(max) && Number(reward) > max) {
      wx.showToast({ title: `赏金不能超过 ${max} 元`, icon: 'none' })
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

      // 先传图，拿到 fileID 再落库；上传失败直接中止，避免出现「任务发了但没图」
      let images = []
      if (this.data.images.length) {
        wx.showLoading({ title: '上传图片', mask: true })
        images = await uploadImages(this.data.images, 'tasks')
      }

      await taskService.createTask({
        title: title.trim(),
        desc: (desc || '').trim(),
        reward: Number(reward || 0),
        contact: (contact || '').trim(),
        location,
        images
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
