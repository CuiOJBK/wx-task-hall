const { createReport, REASONS } = require('../../services/report')
const { showError } = require('../../utils/ui')

Component({
  properties: {
    visible: { type: Boolean, value: false },
    targetType: { type: String, value: '' },
    targetId: { type: String, value: '' },
    title: { type: String, value: '举报' }
  },

  data: {
    reasons: REASONS,
    reasonIndex: -1,
    detail: '',
    submitting: false
  },

  observers: {
    // 每次打开时重置选择
    visible(v) {
      if (v) this.setData({ reasonIndex: -1, detail: '', submitting: false })
    }
  },

  methods: {
    onSelectReason(e) {
      const index = Number(e.currentTarget.dataset.index)
      this.setData({ reasonIndex: index })
    },

    onDetailInput(e) {
      this.setData({ detail: e.detail.value })
    },

    onClose() {
      if (this.data.submitting) return
      this.triggerEvent('close')
    },

    async onSubmit() {
      if (this.data.submitting) return
      const { reasonIndex, detail, targetType, targetId } = this.data
      if (reasonIndex < 0) {
        wx.showToast({ title: '请选择举报理由', icon: 'none' })
        return
      }
      if (!targetType || !targetId) {
        wx.showToast({ title: '举报目标不明确', icon: 'none' })
        return
      }

      this.setData({ submitting: true })
      try {
        await createReport({
          targetType,
          targetId,
          reason: REASONS[reasonIndex],
          detail: (detail || '').trim()
        })
        wx.showToast({ title: '已提交举报', icon: 'success' })
        this.triggerEvent('done')
      } catch (err) {
        showError(err, '举报失败')
      } finally {
        this.setData({ submitting: false })
      }
    },

    noop() {}
  }
})
