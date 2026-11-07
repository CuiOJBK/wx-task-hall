Component({
  properties: {
    list: {
      type: Array,
      value: []
    },
    emptyText: {
      type: String,
      value: '还没有评论，来说两句'
    }
  },
  methods: {
    onReply(e) {
      const { item } = e.currentTarget.dataset
      this.triggerEvent('reply', { comment: item })
    }
  }
})
