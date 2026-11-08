const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

Page({
  data: {
    level: '',
    roots: [],
    admins: [],
    loading: true
  },

  onLoad() {
    this.init()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async init() {
    try {
      const me = await admin.whoami()
      this.setData({ level: me.level })
      await this.load()
    } catch (err) {
      showError(err, '无权访问')
    }
  },

  async load() {
    this.setData({ loading: true })
    try {
      const d = await admin.roleList({})
      this.setData({ roots: d.roots || [], admins: d.admins || [] })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async onRevoke(e) {
    const item = e.currentTarget.dataset.item
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '撤销管理员',
        content: `确定撤销「${item.nickname || item.openid}」的管理员权限？`,
        confirmText: '撤销',
        confirmColor: '#e0483c',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    try {
      await admin.roleUpdate({ id: item._id, role: 'user' })
      wx.showToast({ title: '已撤销', icon: 'success' })
      this.load()
    } catch (err) {
      showError(err, '操作失败')
    }
  },

  onGoUsers() {
    wx.redirectTo({ url: '/pages/admin/users/index' })
  }
})
