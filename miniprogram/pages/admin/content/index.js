const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

const TYPES = [
  { key: 'task', name: '任务' },
  { key: 'post', name: '话题' },
  { key: 'comment', name: '评论' }
]

Page({
  data: {
    types: TYPES,
    type: 'task',
    list: [],
    loading: false,
    hasMore: true,
    page: 0,
    keyword: '',
    selected: {},
    selectedCount: 0
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

  onSwitchType(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.type) return
    this.setData({ type: key, selected: {}, selectedCount: 0 })
    this.reload()
  },

  async reload() {
    this.setData({ list: [], page: 0, hasMore: true, selected: {}, selectedCount: 0 })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && !this.data.hasMore) return
    this.setData({ loading: true })
    try {
      const res = await admin.contentList({
        type: this.data.type,
        keyword: this.data.keyword,
        page: this.data.page
      })
      this.setData({
        list: reset ? res.list : this.data.list.concat(res.list),
        page: this.data.page + 1,
        hasMore: res.hasMore
      })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.reload()
  },

  onToggleSelect(e) {
    const { id } = e.currentTarget.dataset
    const selected = Object.assign({}, this.data.selected)
    if (selected[id]) delete selected[id]
    else selected[id] = true
    this.setData({ selected, selectedCount: Object.keys(selected).length })
  },

  onClearSelect() {
    this.setData({ selected: {}, selectedCount: 0 })
  },

  async onDelete(e) {
    const item = e.currentTarget.dataset.item
    const ok = await this.confirm('删除后不可恢复，关联评论也会一并清理。确定删除？')
    if (!ok) return
    try {
      await admin.contentRemove({ type: this.data.type, id: item._id })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.reload()
    } catch (err) {
      showError(err, '删除失败')
    }
  },

  async onBatchDelete() {
    const ids = Object.keys(this.data.selected)
    if (!ids.length) return
    const ok = await this.confirm(`确定删除选中的 ${ids.length} 条内容？`)
    if (!ok) return
    try {
      const d = await admin.contentRemove({ type: this.data.type, ids })
      wx.showToast({ title: `已删除 ${d.count} 条`, icon: 'success' })
      this.reload()
    } catch (err) {
      showError(err, '删除失败')
    }
  },

  confirm(content) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '请确认',
        content,
        confirmText: '删除',
        confirmColor: '#e0483c',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
  }
})
