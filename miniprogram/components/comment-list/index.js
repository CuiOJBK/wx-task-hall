const commentService = require('../../services/comment')

Component({
  properties: {
    list: {
      type: Array,
      value: []
    },
    emptyText: {
      type: String,
      value: '还没有评论，来说两句'
    },
    // 当前用户 openid：用于判断哪些评论可以长按删除
    ownerOpenid: {
      type: String,
      value: ''
    }
  },
  methods: {
    onReply(e) {
      const { item } = e.currentTarget.dataset
      this.triggerEvent('reply', { comment: item })
    },

    /** 查看更多回复：按 parentId 单独分页拉取 */
    async onLoadMoreChildren(e) {
      const { id, loaded } = e.currentTarget.dataset
      if (!id) return
      try {
        const page = Math.floor(Number(loaded || 0) / 20)
        const d = await commentService.getChildren(id, page)
        this.triggerEvent('children', { parentId: id, list: d.list, hasMore: d.hasMore })
      } catch (err) {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      }
    },

    /** 点赞 / 取消：成功后抛事件，由页面更新列表数据 */
    async onToggleLike(e) {
      const { id } = e.currentTarget.dataset
      if (!id) return
      try {
        const d = await commentService.toggleLike(id)
        this.triggerEvent('liked', { id, liked: d.liked, likeCount: d.likeCount })
      } catch (err) {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      }
    },

    /** 点「删除」文字（仅自己的主楼会渲染这个按钮） */
    onDeleteTap(e) {
      const { id } = e.currentTarget.dataset
      if (!id) return
      this.triggerEvent('remove', { id })
    },

    /** 点「举报」文字（别人的主楼才会渲染） */
    onReportTap(e) {
      const { id } = e.currentTarget.dataset
      if (!id) return
      this.triggerEvent('report', { id })
    },

    /** 长按：自己的弹删除，别人的弹举报 */
    onLongPress(e) {
      const { id, own } = e.currentTarget.dataset
      if (!id) return
      const isOwn = Number(own) === 1
      wx.showActionSheet({
        itemList: [isOwn ? '删除' : '举报'],
        itemColor: isOwn ? '#ff5a1f' : '#4a5058',
        success: (res) => {
          if (res.tapIndex !== 0) return
          this.triggerEvent(isOwn ? 'remove' : 'report', { id })
        },
        fail: () => {}
      })
    }
  }
})
