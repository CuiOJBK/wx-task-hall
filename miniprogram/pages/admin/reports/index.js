const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

const TABS = [
  { key: 'pending', name: '待处理' },
  { key: 'resolved', name: '已处理' },
  { key: 'ignored', name: '已忽略' },
  { key: 'removed', name: '已删除' },
  { key: '', name: '全部' }
]

const STATUS_TEXT = {
  pending: '待处理',
  resolved: '已处理',
  ignored: '已忽略',
  removed: '已删除'
}

const TYPE_TEXT = { task: '任务', post: '话题', comment: '评论' }

Page({
  data: {
    tabs: TABS,
    status: 'pending',
    list: [],
    loading: false,
    hasMore: true,
    page: 0
  },

  onLoad() {
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore()
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.status) return
    this.setData({ status: key })
    this.reload()
  },

  async reload() {
    this.setData({ list: [], page: 0, hasMore: true })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && !this.data.hasMore) return
    this.setData({ loading: true })
    try {
      const res = await admin.reportList({
        status: this.data.status,
        page: this.data.page
      })
      const rows = res.list.map((r) => ({
        ...r,
        typeText: TYPE_TEXT[r.targetType] || r.targetType,
        statusText: STATUS_TEXT[r.status] || r.status,
        timeText: this.formatTime(r.createdAt),
        canHandle: r.status === 'pending' || !r.status
      }))
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        page: this.data.page + 1,
        hasMore: res.hasMore
      })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  formatTime(v) {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  },

  /* 查看被举报内容：任务/话题有详情页，评论只能看快照 */
  onView(e) {
    const item = e.currentTarget.dataset.item
    if (item.targetType === 'task') {
      wx.navigateTo({ url: `/pages/task/detail/index?id=${item.targetId}` })
      return
    }
    if (item.targetType === 'post') {
      wx.navigateTo({ url: `/pages/post/detail/index?id=${item.targetId}` })
      return
    }
    wx.showModal({
      title: '被举报内容',
      content: item.targetSnapshot || '（内容已无快照）',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async onHandle(e) {
    const { id, action } = e.currentTarget.dataset
    if (!id || !action) return

    const label = { resolve: '标记已处理', ignore: '忽略该举报', remove: '删除被举报内容' }[action]
    const extra =
      action === 'remove'
        ? '内容将被物理删除，且不可恢复。'
        : '同一内容下的其他待处理举报会一并结案。'

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: label,
        content: extra,
        confirmText: '确定',
        confirmColor: action === 'remove' ? '#e0483c' : '#ff5a1f',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    wx.showLoading({ title: '处理中', mask: true })
    try {
      await admin.reportHandle({ id, action })
      wx.hideLoading()
      wx.showToast({ title: '已处理', icon: 'success' })
      this.reload()
    } catch (err) {
      wx.hideLoading()
      showError(err, '处理失败')
    }
  }
})
