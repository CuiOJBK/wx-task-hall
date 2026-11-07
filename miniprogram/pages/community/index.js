const postService = require('../../services/post')
const { showError } = require('../../utils/ui')
const { ensureAuthorized, loginDirect } = require('../../utils/auth')

Page({
  data: {
    list: [],
    loading: false,
    finished: false,
    page: 0,
    needLogin: false
  },

  onLoad() {
    const app = getApp()
    Promise.resolve(app.userReady).then(() => {
      if (!app.globalData.authorized) {
        this.setData({ needLogin: true })
        return
      }
      this.refresh()
    })
  },

  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    this.setData({ needLogin: false })
    this.refresh()
  },

  onPullDownRefresh() {
    if (this.data.needLogin) {
      wx.stopPullDownRefresh()
      return
    }
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.needLogin) return
    this.loadMore()
  },

  async refresh() {
    this.setData({ list: [], page: 0, finished: false })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && this.data.finished) return
    this.setData({ loading: true })
    try {
      const { list, hasMore } = await postService.listPosts({ page: this.data.page })
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

  /** 骨架阶段用 editable modal 收集内容，后续替换为独立发帖页（见 TODO P1-4） */
  onCreate() {
    wx.showModal({
      title: '发布话题',
      editable: true,
      placeholderText: '和大厅里的其他人聊点什么…',
      success: async (res) => {
        if (!res.confirm) return
        const content = (res.content || '').trim()
        if (content.length < 2) {
          wx.showToast({ title: '至少 2 个字', icon: 'none' })
          return
        }
        wx.showLoading({ title: '发布中', mask: true })
        try {
          await postService.createPost({ content })
          wx.hideLoading()
          this.refresh()
        } catch (err) {
          wx.hideLoading()
          showError(err, '发布失败')
        }
      }
    })
  },

  /** 点赞（catchtap 阻止冒泡，避免触发卡片跳转） */
  async onTapLike(e) {
    const { id, index } = e.currentTarget.dataset
    if (!id) return
    try {
      const d = await postService.toggleLike(id)
      const key = `list[${index}]`
      this.setData({
        [`${key}.liked`]: d.liked,
        [`${key}.likeCount`]: d.likeCount
      })
    } catch (err) {
      showError(err, '操作失败')
    }
  },

  onTapPost(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/post/detail/index?id=${id}` })
  }
})
