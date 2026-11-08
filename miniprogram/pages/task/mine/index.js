const taskService = require('../../../services/task')
const { showError } = require('../../../utils/ui')
const { ensureAuthorized, loginDirect } = require('../../../utils/auth')

const ROLES = [
  { key: 'owner', label: '我发布的' },
  { key: 'taker', label: '我接的单' }
]

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待接单' },
  { key: 'running', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' }
]

Page({
  data: {
    roles: ROLES,
    filters: FILTERS,
    role: 'owner',
    filter: 'all',
    list: [],
    loading: false,
    finished: false,
    page: 0,
    needLogin: false
  },

  async onShow() {
    const app = getApp()
    await app.userReady
    if (!app.globalData.authorized) {
      this.setData({ needLogin: true, list: [] })
      return
    }
    this.setData({ needLogin: false })
    this.refresh()
  },

  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    this.setData({ needLogin: false })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.needLogin) return
    this.loadMore()
  },

  onSwitchRole(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.role) return
    this.setData({ role: key })
    this.refresh()
  },

  onSwitchFilter(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.filter) return
    this.setData({ filter: key })
    this.refresh()
  },

  async refresh() {
    this.setData({ list: [], page: 0, finished: false })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && this.data.finished) return
    const app = getApp()
    await app.userReady
    if (!app.globalData.authorized) {
      this.setData({ needLogin: true, finished: true })
      return
    }
    this.setData({ loading: true })
    try {
      const { list, hasMore } = await taskService.myTasks(this.data.role, { page: this.data.page })
      this.setData({
        list: reset ? list : this.data.list.concat(list),
        page: this.data.page + 1,
        finished: !hasMore
      })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onTapTask(e) {
    const { task } = e.detail
    wx.navigateTo({ url: `/pages/task/detail/index?id=${task._id}` })
  }
})
