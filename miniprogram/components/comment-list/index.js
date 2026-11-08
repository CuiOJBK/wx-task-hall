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

    /** 点「删除」文字（仅自己的主楼会渲染这个按钮） */
    onDeleteTap(e) {
      const { id } = e.currentTarget.dataset
      if (!id) return
      this.triggerEvent('remove', { id })
    },

    /** 长按：只有自己的评论才弹出删除，别人的静默忽略 */
    onLongPress(e) {
      const { id, own } = e.currentTarget.dataset
      if (!id || Number(own) !== 1) return
      wx.showActionSheet({
        itemList: ['删除'],
        itemColor: '#ff5a1f',
        success: (res) => {
          if (res.tapIndex === 0) this.triggerEvent('remove', { id })
        },
        fail: () => {}
      })
    }
  }
})
