/**
 * 隐私授权弹窗（P0-2）
 *
 * 微信要求：调用 getLocation / chooseLocation 等隐私接口前，用户必须同意
 * 《小程序用户隐私保护指引》。指引在小程序后台配置，代码侧只负责：
 *   1. 用 wx.getPrivacySetting 判断是否需要授权
 *   2. 用 <button open-type="agreePrivacyAuthorization"> 让用户同意
 *
 * 注意：如果后台没配隐私指引，needAuthorization 会是 false，弹窗不会出现。
 * 这是预期行为，不是 bug。
 */
Component({
  data: {
    visible: false
  },

  lifetimes: {
    attached() {
      this.checkPrivacy()
    }
  },

  methods: {
    checkPrivacy() {
      if (typeof wx.getPrivacySetting !== 'function') return
      wx.getPrivacySetting({
        success: (res) => {
          if (res && res.needAuthorization) this.setData({ visible: true })
        },
        fail: () => {}
      })
    },

    /** 供外部页面主动拉起 */
    open() {
      this.setData({ visible: true })
    },

    onAgree() {
      this.setData({ visible: false })
      this.triggerEvent('agree', {})
    },

    onReject() {
      this.setData({ visible: false })
      wx.showToast({ title: '未同意将无法使用定位相关功能', icon: 'none' })
      this.triggerEvent('reject', {})
    },

    onOpenDoc(e) {
      const tab = (e && e.currentTarget && e.currentTarget.dataset.tab) || 'privacy'
      wx.navigateTo({ url: '/pages/agreement/index?tab=' + tab })
    },

    noop() {}
  }
})
