const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

Page({
  data: {
    loading: true,
    level: '',
    adminName: '',
    cards: [],
    bars: [],
    shortcuts: [
      { key: 'users', name: '用户管理', url: '/pages/admin/users/index' },
      { key: 'content', name: '内容治理', url: '/pages/admin/content/index' },
      { key: 'roles', name: '角色权限', url: '/pages/admin/roles/index' },
      { key: 'logs', name: '操作日志', url: '/pages/admin/logs/index' },
      { key: 'settings', name: '系统设置', url: '/pages/admin/settings/index' }
    ]
  },

  onLoad() {
    this.init()
  },

  onPullDownRefresh() {
    this.loadOverview().then(() => wx.stopPullDownRefresh())
  },

  async init() {
    try {
      const me = await admin.whoami()
      this.setData({
        level: me.level,
        adminName: me.nickname || String(me.openid).slice(0, 8)
      })
      await this.loadOverview()
    } catch (err) {
      this.setData({ loading: false })
      wx.showModal({
        title: '无权访问',
        content: err.message || '当前账号不是管理员',
        showCancel: false,
        confirmText: '知道了',
        success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      })
    }
  },

  async loadOverview() {
    this.setData({ loading: true })
    try {
      const d = await admin.overview()
      this.setData({ cards: d.cards || [], bars: d.bars || [] })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onShortcut(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url })
  }
})
