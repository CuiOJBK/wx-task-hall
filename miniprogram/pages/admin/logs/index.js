const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

Page({
  data: {
    list: [],
    loading: false,
    hasMore: true,
    page: 0,
    keyword: ''
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

  async reload() {
    this.setData({ list: [], page: 0, hasMore: true })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && !this.data.hasMore) return
    this.setData({ loading: true })
    try {
      const res = await admin.logList({
        keyword: this.data.keyword,
        page: this.data.page
      })
      const rows = res.list.map((r) => ({
        _id: r._id,
        action: r.action,
        operatorOpenid: r.operatorOpenid,
        operatorLevel: r.operatorLevel,
        detail: String(r.detail || '').slice(0, 120),
        timeText: this.formatTime(r.createdAt)
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

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.reload()
  }
})
