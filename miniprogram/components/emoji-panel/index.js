const { CATEGORIES } = require('../../utils/emoji')

Component({
  properties: {
    // 面板高度由使用方决定，方便以后在别的场景复用
    height: {
      type: Number,
      value: 520
    }
  },

  data: {
    tabs: CATEGORIES.map((c) => ({ key: c.key, name: c.name })),
    activeKey: CATEGORIES[0].key,
    list: CATEGORIES[0].list
  },

  methods: {
    onTapTab(e) {
      const { key } = e.currentTarget.dataset
      if (key === this.data.activeKey) return
      const target = CATEGORIES.find((c) => c.key === key)
      if (!target) return
      this.setData({ activeKey: key, list: target.list })
    },

    onTapEmoji(e) {
      const { emoji } = e.currentTarget.dataset
      if (!emoji) return
      this.triggerEvent('select', { emoji })
    },

    onDelete() {
      this.triggerEvent('delete', {})
    }
  }
})
