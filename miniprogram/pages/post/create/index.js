const postService = require('../../../services/post')
const { showError } = require('../../../utils/ui')
const { ensureAuthorized, ensureProfile } = require('../../../utils/auth')
const { MAX_IMAGES, chooseImages, uploadImages } = require('../../../utils/upload')
const { charLength, insertAt, deleteBefore } = require('../../../utils/emoji')

Page({
  data: {
    content: '',
    charCount: 0,
    images: [],
    maxImages: MAX_IMAGES,
    showEmoji: false,
    submitting: false
  },

  /** 输入框光标位置，emoji 插到这个位置 */
  cursor: -1,

  async onLoad() {
    const ok = await ensureAuthorized({ title: '登录后才能发布话题' })
    if (!ok) {
      wx.navigateBack()
      return
    }
    const profileOk = await ensureProfile({ title: '先完善昵称再发帖' })
    if (!profileOk) wx.navigateBack()
  },

  onInput(e) {
    const content = e.detail.value
    this.cursor = typeof e.detail.cursor === 'number' ? e.detail.cursor : content.length
    this.setData({ content, charCount: charLength(content) })
  },

  onFocus() {
    if (this.data.showEmoji) this.setData({ showEmoji: false })
  },

  /** 读输入框真实选区，失败返回 null */
  captureSelection() {
    return new Promise((resolve) => {
      if (typeof wx.getSelectedTextRange !== 'function') {
        resolve(null)
        return
      }
      wx.getSelectedTextRange({
        success: (res) => resolve(res && typeof res.start === 'number' && res.start >= 0 ? res.start : null),
        fail: () => resolve(null)
      })
    })
  },

  async onToggleEmoji() {
    if (this.data.showEmoji) {
      this.setData({ showEmoji: false })
      return
    }
    const pos = await this.captureSelection()
    if (pos !== null) this.cursor = pos
    this.setData({ showEmoji: true })
  },

  onPickEmoji(e) {
    const emoji = e.detail && e.detail.emoji
    if (!emoji) return
    const r = insertAt(this.data.content, emoji, this.cursor)
    this.cursor = r.cursor
    this.setData({ content: r.value, charCount: charLength(r.value) })
  },

  onDeleteEmoji() {
    const r = deleteBefore(this.data.content, this.cursor)
    this.cursor = r.cursor
    this.setData({ content: r.value, charCount: charLength(r.value) })
  },

  async onChooseImage() {
    try {
      const paths = await chooseImages(this.data.images.length)
      if (!paths.length) return
      this.setData({ images: this.data.images.concat(paths).slice(0, MAX_IMAGES) })
    } catch (err) {
      showError(err, '选择图片失败')
    }
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({ current: this.data.images[index], urls: this.data.images })
  },

  validate() {
    const len = charLength(this.data.content)
    if (len < 2) {
      wx.showToast({ title: '至少 2 个字', icon: 'none' })
      return false
    }
    if (len > 500) {
      wx.showToast({ title: '最多 500 字', icon: 'none' })
      return false
    }
    return true
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.validate()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })
    try {
      let images = []
      if (this.data.images.length) {
        wx.showLoading({ title: '上传图片', mask: true })
        images = await uploadImages(this.data.images, 'posts')
      }
      await postService.createPost({
        content: this.data.content.trim(),
        images
      })
      wx.hideLoading()
      wx.showToast({ title: '已发布', icon: 'success' })
      // 通知列表页刷新
      const pages = getCurrentPages()
      const prev = pages[pages.length - 2]
      if (prev && prev.refresh) prev.refresh()
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      wx.hideLoading()
      showError(err, '发布失败')
    } finally {
      this.setData({ submitting: false })
    }
  }
})
