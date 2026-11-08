const taskService = require('../../../services/task')
const { showError } = require('../../../utils/ui')
const commentService = require('../../../services/comment')
const { COMMENT_TARGET } = require('../../../utils/constants')
const { maskContact } = require('../../../utils/format')
const { loginDirect } = require('../../../utils/auth')
const { chooseImages, uploadImages } = require('../../../utils/upload')

Page({
  data: {
    id: '',
    task: null,
    permissions: {},
    comments: [],
    commentText: '',
    replyTo: null,
    loading: true,
    sending: false,
    acting: false,
    needLogin: false,
    myOpenid: '',
    // 联系方式默认打码，需主动点「查看」才显示完整
    contactMasked: '',
    contactRevealed: false,
    timeoutHint: '',
    reportVisible: false,
    reportTarget: { type: '', id: '', title: '举报' }
  },

  async onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少任务 ID', icon: 'none' })
      return
    }
    this.setData({ id: options.id })
    const app = getApp()
    await app.userReady

    // 未登录不请求详情，只渲染登录引导（E1b / E12）
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

  /** 分享任务给好友 */
  onShareAppMessage() {
    const task = this.data.task
    const title = task && task.title ? `【任务】${task.title}` : '任务大厅：找人帮忙，顺手赚点'
    return {
      title: title.slice(0, 30),
      path: `/pages/task/detail/index?id=${this.data.id}`
    }
  },

  /** 分享到朋友圈（基础库 2.11.3+） */
  onShareTimeline() {
    const task = this.data.task
    const title = task && task.title ? `【任务】${task.title}` : '任务大厅：找人帮忙，顺手赚点'
    return {
      title: title.slice(0, 30),
      query: `id=${this.data.id}`
    }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  async loadAll() {
    this.setData({ loading: true, myOpenid: getApp().globalData.openid || '' })
    try {
      const [detail, commentRes] = await Promise.all([
        taskService.getTask(this.data.id),
        commentService.listComments(COMMENT_TARGET.TASK, this.data.id)
      ])
      this.setData({
        task: detail.task,
        permissions: detail.permissions || {},
        comments: commentRes.list,
        contactMasked: detail.task ? maskContact(detail.task.contact) : '',
        contactRevealed: false,
        timeoutHint: detail.timeoutHint || ''
      })
      wx.setNavigationBarTitle({ title: detail.task ? detail.task.title : '任务详情' })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 显示 / 隐藏完整联系方式（只有任务双方能看到这一行） */
  onToggleContact() {
    this.setData({ contactRevealed: !this.data.contactRevealed })
  },

  /** 追加主楼下的更多回复 */
  onMoreChildren(e) {
    const { parentId, list, hasMore } = e.detail || {}
    if (!parentId) return
    const comments = (this.data.comments || []).map((c) => {
      if (c._id !== parentId) return c
      return Object.assign({}, c, {
        children: (c.children || []).concat(list || []),
        childrenHasMore: !!hasMore
      })
    })
    this.setData({ comments })
  },

  /** 评论点赞后同步本地列表，避免整页重载 */
  onCommentLiked(e) {
    const { id, liked, likeCount } = e.detail || {}
    if (!id) return
    const list = (this.data.comments || []).map((c) => {
      if (c._id === id) return Object.assign({}, c, { liked, likeCount })
      if (c.children && c.children.length) {
        return Object.assign({}, c, {
          children: c.children.map((ch) => (ch._id === id ? Object.assign({}, ch, { liked, likeCount }) : ch))
        })
      }
      return c
    })
    this.setData({ comments: list })
  },

  /** 举报任务 */
  onTapReport() {
    const task = this.data.task
    if (!task) return
    this.setData({
      reportVisible: true,
      reportTarget: { type: 'task', id: task._id, title: '举报该任务' }
    })
  },

  /** 举报评论 */
  onReportComment(e) {
    const { id } = e.detail || {}
    if (!id) return
    this.setData({
      reportVisible: true,
      reportTarget: { type: 'comment', id, title: '举报该评论' }
    })
  },

  onCloseReport() {
    this.setData({ reportVisible: false })
  },

  onReportDone() {
    this.setData({ reportVisible: false })
  },

  /** 长按删除自己的评论（主楼会连带删回复） */
  async onRemoveComment(e) {
    const { id } = e.detail || {}
    if (!id) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '删除评论',
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

  /** 统一处理「需要二次确认的写操作」 */
  async doAction(actionName, confirmText, successText) {
    if (this.data.acting) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认操作',
        content: confirmText,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    this.setData({ acting: true })
    wx.showLoading({ title: '处理中', mask: true })
    try {
      await taskService[actionName](this.data.id)
      wx.hideLoading()
      wx.showToast({ title: successText, icon: 'success' })
      await this.loadAll()
    } catch (err) {
      wx.hideLoading()
      // STATUS_CONFLICT 是最常见的并发态，单独提示
      const msg = err.code === 'STATUS_CONFLICT' ? '手慢了，任务状态已变化' : err.message
      wx.showToast({ title: msg || '操作失败', icon: 'none' })
      if (err.code === 'STATUS_CONFLICT') this.loadAll()
    } finally {
      this.setData({ acting: false })
    }
  },

  onGrab() {
    this.doAction('grabTask', '接单后需要按约定完成任务，确定接吗？', '接单成功')
  },

  /** 提交完成：可直接提交，或先传最多 3 张凭证图 */
  onSubmitWork() {
    if (this.data.acting) return

    wx.showActionSheet({
      itemList: ['直接提交', '上传凭证图后提交'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.doAction('submitTask', '提交后等待发布者确认，确定已按要求完成？', '已提交')
        } else {
          this.pickProofAndSubmit()
        }
      },
      fail: () => {}
    })
  },

  async pickProofAndSubmit() {
    let tempPaths = []
    try {
      tempPaths = await chooseImages(0)
    } catch (e) {
      showError(e, '选择图片失败')
      return
    }
    if (!tempPaths.length) return

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认提交',
        content: `将上传 ${tempPaths.length} 张凭证图，提交后等待发布者确认。`,
        confirmText: '提交',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    this.setData({ acting: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const proofImages = await uploadImages(tempPaths, 'proofs')
      await taskService.submitTask(this.data.id, proofImages)
      wx.hideLoading()
      wx.showToast({ title: '已提交', icon: 'success' })
      await this.loadAll()
    } catch (err) {
      wx.hideLoading()
      showError(err, '提交失败')
    } finally {
      this.setData({ acting: false })
    }
  },

  /** 预览任务配图 / 凭证图 */
  onPreviewImages(e) {
    const { group, index } = e.currentTarget.dataset
    const task = this.data.task || {}
    const urls = group === 'proof' ? task.proofImages || [] : task.images || []
    if (!urls.length) return
    wx.previewImage({ current: urls[Number(index)] || urls[0], urls })
  },

  onConfirm() {
    this.doAction('confirmTask', '确认任务已完成？确认后不可撤销', '任务已完成')
  },

  onCancel() {
    this.doAction('cancelTask', '取消后任务将从大厅下架，确定取消？', '任务已取消')
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  onReply(e) {
    const { comment } = e.detail
    this.setData({
      replyTo: { id: comment._id, nickname: comment.nickname || '匿名用户' }
    })
  },

  onCancelReply() {
    this.setData({ replyTo: null })
  },

  async onSendComment(e) {
    // 组件回传当前文本，避免 this.data 与组件内部状态不同步（emoji 是直接改组件内部值的）
    const raw = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : this.data.commentText
    const content = (raw || '').trim()
    if (!content) {
      wx.showToast({ title: '说点什么吧', icon: 'none' })
      return
    }
    if (this.data.sending) return

    this.setData({ sending: true })
    try {
      await commentService.addComment({
        targetType: COMMENT_TARGET.TASK,
        targetId: this.data.id,
        content,
        parentId: this.data.replyTo ? this.data.replyTo.id : '',
        replyToNickname: this.data.replyTo ? this.data.replyTo.nickname : ''
      })
      this.setData({ commentText: '', replyTo: null })
      const res = await commentService.listComments(COMMENT_TARGET.TASK, this.data.id)
      this.setData({ comments: res.list })
    } catch (err) {
      showError(err, '发送失败')
    } finally {
      this.setData({ sending: false })
    }
  },

  onPreviewLocation() {
    const loc = this.data.task && this.data.task.location
    if (!loc) return
    wx.openLocation({
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      name: loc.name || '',
      address: loc.address || '',
      scale: 18
    })
  }
})
