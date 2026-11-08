/**
 * 列表骨架屏
 * 用于首屏加载时占位，避免「白屏 → 突然出现内容」的跳变
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    count: { type: Number, value: 4 }
  },
  data: {
    rows: [0, 1, 2, 3]
  },
  observers: {
    count(n) {
      const total = Math.max(1, Math.min(Number(n) || 4, 8))
      const rows = []
      for (let i = 0; i < total; i++) rows.push(i)
      this.setData({ rows })
    }
  }
})
