const TABS = [
  { key: 'dashboard', name: '概览', url: '/pages/admin/dashboard/index' },
  { key: 'users', name: '用户', url: '/pages/admin/users/index' },
  { key: 'content', name: '内容', url: '/pages/admin/content/index' },
  { key: 'reports', name: '举报', url: '/pages/admin/reports/index' },
  { key: 'roles', name: '角色', url: '/pages/admin/roles/index' },
  { key: 'logs', name: '日志', url: '/pages/admin/logs/index' },
  { key: 'settings', name: '设置', url: '/pages/admin/settings/index' }
]

Component({
  properties: {
    active: { type: String, value: 'dashboard' },
    title: { type: String, value: '管理后台' }
  },
  data: { tabs: TABS },
  methods: {
    onTap(e) {
      const { key, url } = e.currentTarget.dataset
      if (key === this.data.active) return
      // 用 redirectTo 保证页面栈不膨胀，返回键仍能回到「我的」
      wx.redirectTo({ url })
    },
    onBack() {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/user/index' })
      })
    }
  }
})
