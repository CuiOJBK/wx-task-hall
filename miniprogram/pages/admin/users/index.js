const admin = require('../../../services/admin')
const { showError } = require('../../../utils/ui')

const EMPTY_FORM = { id: '', nickname: '', openid: '', creditScore: 100, status: 'active', role: 'user' }

Page({
  data: {
    list: [],
    loading: false,
    hasMore: true,
    page: 0,
    keyword: '',
    statusFilter: '',
    level: '',
    selected: {},
    selectedCount: 0,
    sheetVisible: false,
    formMode: 'create',
    form: Object.assign({}, EMPTY_FORM),
    errors: {}
  },

  onLoad() {
    this.init()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore()
  },

  async init() {
    try {
      const me = await admin.whoami()
      this.setData({ level: me.level })
      await this.reload()
    } catch (err) {
      showError(err, '无权访问')
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) }), 800)
    }
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
      const res = await admin.userList({
        keyword: this.data.keyword,
        status: this.data.statusFilter,
        page: this.data.page
      })
      const list = reset ? res.list : this.data.list.concat(res.list)
      this.setData({
        list,
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

  onStatusFilter(e) {
    const { status } = e.currentTarget.dataset
    this.setData({ statusFilter: status === this.data.statusFilter ? '' : status })
    this.reload()
  },

  /* ---------- 批量选择 ---------- */
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

  selectedIds() {
    return Object.keys(this.data.selected)
  },

  async onBatchStatus(e) {
    const status = e.currentTarget.dataset.status
    const ids = this.selectedIds()
    if (!ids.length) return
    try {
      const d = await admin.userSetStatus({ ids, status })
      wx.showToast({ title: `已${status === 'disabled' ? '禁用' : '启用'} ${d.count} 个`, icon: 'success' })
      this.reload()
    } catch (err) {
      showError(err, '操作失败')
    }
  },

  async onBatchDelete() {
    const ids = this.selectedIds()
    if (!ids.length) return
    const ok = await this.confirm(`确定删除选中的 ${ids.length} 个用户？该操作不可恢复。`)
    if (!ok) return
    try {
      const d = await admin.userDelete({ ids })
      wx.showToast({ title: `已删除 ${d.count} 个`, icon: 'success' })
      this.reload()
    } catch (err) {
      showError(err, '删除失败')
    }
  },

  /* ---------- 单条操作 ---------- */
  onEdit(e) {
    const item = e.currentTarget.dataset.item
    this.setData({
      sheetVisible: true,
      formMode: 'edit',
      errors: {},
      form: {
        id: item._id,
        nickname: item.nickname,
        openid: item.openid,
        creditScore: item.creditScore,
        status: item.status,
        role: item.role
      }
    })
  },

  onAdd() {
    this.setData({
      sheetVisible: true,
      formMode: 'create',
      errors: {},
      form: Object.assign({}, EMPTY_FORM)
    })
  },

  onToggleStatus(e) {
    const item = e.currentTarget.dataset.item
    const next = item.status === 'disabled' ? 'active' : 'disabled'
    admin
      .userSetStatus({ id: item._id, status: next })
      .then(() => {
        wx.showToast({ title: next === 'disabled' ? '已禁用' : '已启用', icon: 'success' })
        this.reload()
      })
      .catch((err) => showError(err, '操作失败'))
  },

  async onDelete(e) {
    const item = e.currentTarget.dataset.item
    const ok = await this.confirm(`确定删除用户「${item.nickname || item.openid}」？`)
    if (!ok) return
    try {
      await admin.userDelete({ id: item._id })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.reload()
    } catch (err) {
      showError(err, '删除失败')
    }
  },

  /* ---------- 表单 ---------- */
  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },

  onFormRole(e) {
    this.setData({ 'form.role': e.currentTarget.dataset.role })
  },

  validate() {
    const f = this.data.form
    const errors = {}
    const nickname = String(f.nickname || '').trim()
    if (nickname.length < 2 || nickname.length > 20) errors.nickname = '昵称需 2-20 个字'
    if (this.data.formMode === 'create') {
      if (!String(f.openid || '').trim()) errors.openid = '请填写 openid'
    }
    const score = Number(f.creditScore)
    if (Number.isNaN(score) || score < 0 || score > 1000) errors.creditScore = '信用分需为 0-1000'
    this.setData({ errors })
    return Object.keys(errors).length === 0
  },

  async onSubmit() {
    if (!this.validate()) return
    const f = this.data.form
    wx.showLoading({ title: '保存中', mask: true })
    try {
      if (this.data.formMode === 'create') {
        await admin.userCreate({
          nickname: f.nickname,
          openid: f.openid,
          status: f.status,
          role: f.role
        })
      } else {
        await admin.userUpdate({
          id: f.id,
          nickname: f.nickname,
          creditScore: Number(f.creditScore),
          role: f.role
        })
      }
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ sheetVisible: false })
      this.reload()
    } catch (err) {
      wx.hideLoading()
      showError(err, '保存失败')
    }
  },

  onCloseSheet() {
    this.setData({ sheetVisible: false })
  },

  confirm(content) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '请确认',
        content,
        confirmText: '确定',
        confirmColor: '#e0483c',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
  },

  noop() {}
})
