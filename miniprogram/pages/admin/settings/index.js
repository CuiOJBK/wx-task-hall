const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

Page({
  data: {
    loading: true,
    saving: false,
    settings: {
      maxReward: 500,
      reportThreshold: 3,
      announcement: '',
      allowPublish: true,
      acceptTimeoutHours: 24
    },
    errors: {}
  },

  onLoad() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const d = await admin.settingsGet()
      this.setData({ settings: Object.assign(this.data.settings, d.settings || {}) })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`settings.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },

  onTogglePublish(e) {
    this.setData({ 'settings.allowPublish': e.detail.value })
  },

  validate() {
    const s = this.data.settings
    const errors = {}

    const maxReward = Number(s.maxReward)
    if (Number.isNaN(maxReward) || maxReward < 0 || maxReward > 100000) {
      errors.maxReward = '赏金上限需为 0-100000'
    }

    const threshold = Number(s.reportThreshold)
    if (Number.isNaN(threshold) || threshold < 1 || threshold > 100) {
      errors.reportThreshold = '举报阈值需为 1-100'
    }

    if (String(s.announcement || '').length > 200) {
      errors.announcement = '公告最多 200 字'
    }

    const timeoutHours = Number(s.acceptTimeoutHours)
    if (Number.isNaN(timeoutHours) || timeoutHours < 1 || timeoutHours > 168) {
      errors.acceptTimeoutHours = '需为 1-168 小时'
    }

    this.setData({ errors })
    return Object.keys(errors).length === 0
  },

  async onSave() {
    if (this.data.saving) return
    if (!this.validate()) {
      wx.showToast({ title: '请检查表单填写', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const d = await admin.settingsSave({
        settings: {
          maxReward: Number(this.data.settings.maxReward),
          reportThreshold: Number(this.data.settings.reportThreshold),
          announcement: this.data.settings.announcement,
          allowPublish: this.data.settings.allowPublish,
          acceptTimeoutHours: Number(this.data.settings.acceptTimeoutHours)
        }
      })
      this.setData({ settings: Object.assign(this.data.settings, d.settings) })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      showError(err, '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  }
})
