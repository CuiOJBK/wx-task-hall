/**
 * 底部输入条：文本输入 + emoji 面板 + 发送
 *
 * ══ 光标追踪（v0.2.2 重做）══════════════════════════════
 *
 * 为什么 v0.2.1 的修法不生效：
 *   小程序里「点击输入框以外的区域」会让 input 失焦，这个失焦发生在
 *   手指抬起的 tap 事件**之前**。所以等到 onToggleEmoji 执行时，
 *   输入框已经不是聚焦态，wx.getSelectedTextRange() 直接 fail，
 *   我们只能回退到 bindinput 留下的旧位置 —— 也就是文字末尾。
 *   症状就是「点了表情，光标没了，表情插到末尾」。
 *
 * 结论：光标必须在**失焦之前**读到。失焦之前能抓到的时机只有三个：
 *   1. 手指按下表情按钮的 touchstart（此刻 input 还聚焦）
 *   2. 用户点击输入框内部（移动光标）之后的下一帧
 *   3. 输入框获得焦点之后
 *
 * 所以这里不再只在 onToggleEmoji 里读，而是把上面所有时机都接上，
 * 每次读到的真实位置都写回 data.cursor。插入时直接用这个值。
 *
 * ══ 键盘遮挡（v0.2.1 修复，保留）════════════════════════
 *   .composer 是 position:fixed; bottom:0，adjust-position 只推页面内容
 *   不推 fixed 元素。改为 adjust-position=false + 监听键盘高度自己设 bottom，
 *   并按视口有没有被压缩区分 iOS / Android（见 utils/keyboard.js）。
 */
const { insertAt, deleteBefore } = require('../../utils/emoji')
const { computeKeyboardOffset } = require('../../utils/keyboard')
const config = require('../../config/index')

Component({
  properties: {
    value: {
      type: String,
      value: ''
    },
    placeholder: {
      type: String,
      value: '说点什么…'
    },
    // { id, nickname } 或 null
    replyTo: {
      type: Object,
      value: null
    },
    sending: {
      type: Boolean,
      value: false
    },
    maxlength: {
      type: Number,
      value: 300
    },
    // 排查光标问题时置 true，会在控制台打印每次读取结果
    debug: {
      type: Boolean,
      value: !!(config.features && config.features.debugEmoji)
    }
  },

  data: {
    innerValue: '',
    // 光标位置（UTF-16 下标），-1 表示未知，插入时回退到末尾
    cursor: -1,
    showEmoji: false,
    focus: false,
    keyboardHeight: 0
  },

  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync()
        this._initWindowHeight = info.windowHeight || 0
      } catch (e) {
        this._initWindowHeight = 0
      }
      // 延迟捕获的序号，用于丢弃过期的回调
      this._cursorToken = 0
      // 聚焦期间的轮询定时器
      this._pollTimer = null
    },
    detached() {
      this.stopCursorPolling()
    }
  },

  observers: {
    value(v) {
      if (v === this.data.innerValue) return
      const next = v || ''
      this.setData({ innerValue: next, cursor: next.length })
    }
  },

  methods: {
    log(...args) {
      if (this.data.debug) console.log('[comment-bar]', ...args)
    },

    /**
     * 读输入框真实选区起始位置。
     * 只在输入框「当前处于聚焦态」时有效 —— 失焦会走 fail，正是我们判断时机的依据。
     * @returns {Promise<number|null>}
     */
    captureSelection() {
      return new Promise((resolve) => {
        if (typeof wx.getSelectedTextRange !== 'function') {
          this.log('wx.getSelectedTextRange 不可用（基础库过低）')
          resolve(null)
          return
        }
        wx.getSelectedTextRange({
          success: (res) => {
            const pos = res && typeof res.start === 'number' && res.start >= 0 ? res.start : null
            this.log('读取光标成功', pos)
            resolve(pos)
          },
          fail: (err) => {
            this.log('读取光标失败（输入框已失焦）', err && err.errMsg)
            resolve(null)
          }
        })
      })
    },

    /** 把读到的位置写进 data.cursor */
    applyCursor(pos) {
      if (typeof pos !== 'number' || pos < 0) return
      if (pos === this.data.cursor) return
      this.setData({ cursor: pos })
    },

    /**
     * 延迟同步一次光标
     * @param {number} delay 延迟毫秒，给原生层留出移动光标的时间
     * @param {boolean} skipWhenPanelOpen 面板已展开时跳过（避免覆盖表情插入后的位置）
     */
    syncCursor(delay, skipWhenPanelOpen) {
      const token = ++this._cursorToken
      setTimeout(() => {
        if (token !== this._cursorToken) return
        if (skipWhenPanelOpen && this.data.showEmoji) return
        this.captureSelection().then((pos) => this.applyCursor(pos))
      }, delay || 0)
    },

    /**
     * 聚焦期间的低频兜底轮询。
     * 有些机型 touchstart 里读选区仍会失败（原生侧已提前失焦），
     * 这里每 400ms 补读一次，保证光标移动后最迟 400ms 内被记录。
     * 失焦 / 页面卸载时立即停止，不会常驻。
     */
    startCursorPolling() {
      this.stopCursorPolling()
      this._pollTimer = setInterval(() => {
        if (this.data.showEmoji) return
        this.captureSelection().then((pos) => this.applyCursor(pos))
      }, 400)
    },

    stopCursorPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    },

    onInput(e) {
      const value = e.detail.value
      const cursor = e.detail.cursor
      this.setData({ innerValue: value, cursor })
      this.triggerEvent('input', { value, cursor })
    },

    /** 点击输入框内部：可能只是移动光标（不触发 bindinput），补读一次 */
    onInputTap() {
      this.syncCursor(0, true)
    },

    onFocus() {
      // 点输入框 = 要打字，收起表情面板
      if (this.data.showEmoji) this.setData({ showEmoji: false })
      // 首次聚焦时补读一次（原生层落光标略慢，给 80ms）
      this.syncCursor(80, true)
      this.startCursorPolling()
    },

    onBlur() {
      this.log('输入框失焦')
      this.stopCursorPolling()
      // 失焦后再确认一次：若此前一直没读到，这里通常是最后机会
      this.syncCursor(0, true)
    },

    onKeyboardHeightChange(e) {
      const height = (e.detail && e.detail.height) || 0
      let current = 0
      try {
        current = wx.getSystemInfoSync().windowHeight || 0
      } catch (err) {
        current = 0
      }
      const offset = computeKeyboardOffset(height, this._initWindowHeight, current)
      if (offset !== this.data.keyboardHeight) {
        this.setData({ keyboardHeight: offset })
      }
    },

    /**
     * 关键：手指按下的瞬间读光标。
     * touchstart 早于 tap，也早于「点击输入框外部导致的失焦」，
     * 这是全程唯一能稳定拿到真实光标的时机。
     */
    onEmojiTouchStart() {
      if (this.data.showEmoji) return
      // 不跳过面板展开判断：这个回调可能晚于 onToggleEmoji 的 setData 到达
      this.captureSelection().then((pos) => this.applyCursor(pos))
    },

    /** 输入框与表情面板切换，互斥：开面板必收键盘 */
    async onToggleEmoji() {
      if (this.data.showEmoji) {
        this.setData({ showEmoji: false, focus: true })
        return
      }

      // 双保险：touchstart 可能还没来得及回调，这里再读一次
      const pos = await this.captureSelection()
      if (pos !== null) {
        this.applyCursor(pos)
      } else if (this.data.cursor < 0) {
        // 完全读不到且从未记录过，退化为末尾插入
        this.log('光标完全未知，退化为末尾插入')
      }

      // 显式收键盘，不依赖 focus 属性的隐式行为
      try {
        wx.hideKeyboard({})
      } catch (e) {
        // 低版本基础库没有该 API，忽略
      }

      this.setData({ showEmoji: true, focus: false })
    },

    onPickEmoji(e) {
      const { emoji } = e.detail
      if (!emoji) return

      const base = this.data.cursor
      const { value, cursor } = insertAt(this.data.innerValue, emoji, base)
      this.log('插入表情', emoji, '位置', base, '→', cursor)
      this.setData({ innerValue: value, cursor })
      this.triggerEvent('input', { value, cursor })
    },

    onDeleteEmoji() {
      const { value, cursor } = deleteBefore(this.data.innerValue, this.data.cursor)
      this.setData({ innerValue: value, cursor })
      this.triggerEvent('input', { value, cursor })
    },

    onSend() {
      if (this.data.sending) return
      this.triggerEvent('send', { value: this.data.innerValue })
    },

    onCancelReply() {
      this.triggerEvent('cancelreply', {})
    }
  }
})
