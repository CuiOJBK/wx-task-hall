const postService = require('../../../services/post')
const { showError } = require('../../../utils/ui')
const commentService = require('../../../services/comment')
const { COMMENT_TARGET } = require('../../../utils/constants')
const { ensureAuthorized, loginDirect } = require('../../../utils/auth')

Page({
  data: {
    id: '',
    post: null,
    replies: [],
    text: '',
    replyTo: null,
    loading: true,
    sending: false,
    needLogin: false,
    myOpenid: ''
  },

  async onLoad(options) {
    if (!options.id) return
    this.setData({ id: options.id })
    const app = getApp()
    await app.userReady

    if (!app.globalData.authorized) {
      this.setData({ needLogin: true, loading: false })
      return
    }
    this.loadAll()
  },

  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    this.setData({ needLogin: false })
    this.loadAll()
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [detail, replyRes] = await Promise.all([
        postService.getPost(this.data.id),
        commentService.listComments(COMMENT_TARGET.HALL, this.data.id)
      ])
      this.setData({ post: detail.post, replies: replyRes.list })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 长按删除自己的回复 */
  async onRemoveComment(e) {
    const { id } = e.detail || {}
    if (!id) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '删除回复',
        content: '删除后不可恢复，主楼下的回复会一并删除',
        confirmText: '删除',
        confirmColor: '#ff5a1f',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    wx.showLoading({ title: '删除中', mask: true })
    try {
      await commentService.removeComment(id)
      wx.hideLoading()
      wx.showToast({ title: '已删除', icon: 'success' })
      await this.loadAll()
    } catch (err) {
      wx.hideLoading()
      showError(err, '删除失败')
    }
  },

  /** 话题点赞 / 取消 */
  async onTapLike() {
    if (!this.data.post) return
    try {
      const d = await postService.toggleLike(this.data.post._id)
      this.setData({ 'post.liked': d.liked, 'post.likeCount': d.likeCount })
    } catch (err) {
      showError(err, '操作失败')
    }
  },

  onInput(e) {
    this.setData({ text: e.detail.value })
  },

  onReply(e) {
    const { comment } = e.detail
    this.setData({ replyTo: { id: comment._id, nickname: comment.nickname || '匿名用户' } })
  },

  onCancelReply() {
    this.setData({ replyTo: null })
  },

  async onSend(e) {
    const raw = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : this.data.text
    const content = (raw || '').trim()
    if (!content) {
      wx.showToast({ title: '说点什么吧', icon: 'none' })
      return
    }
    if (this.data.sending) return
    this.setData({ sending: true })
    try {
      await commentService.addComment({
        targetType: COMMENT_TARGET.HALL,
        targetId: this.data.id,
        content,
        parentId: this.data.replyTo ? this.data.replyTo.id : '',
        replyToNickname: this.data.replyTo ? this.data.replyTo.nickname : ''
      })
      this.setData({ text: '', replyTo: null })
      const res = await commentService.listComments(COMMENT_TARGET.HALL, this.data.id)
      this.setData({ replies: res.list })
    } catch (err) {
      showError(err, '发送失败')
    } finally {
      this.setData({ sending: false })
    }
  }
})
