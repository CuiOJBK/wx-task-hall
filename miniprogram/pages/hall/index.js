const taskService = require('../../services/task')
const { showError } = require('../../utils/ui')
const locationUtil = require('../../utils/location')
const { ensureAuthorized, loginDirect } = require('../../utils/auth')

const TABS = [
  { key: 'pending', label: '待接单' },
  { key: 'accepted', label: '进行中' },
  { key: 'completed', label: '已完成' }
]

Page({
  data: {
    tabs: TABS,
    activeStatus: 'pending',
    list: [],
    loading: false,
    finished: false,
    page: 0,
    center: null,
    locating: false,
    // 匿名模式：只渲染前 10 条摘要，切换筛选/发布/看详情都要登录
    anonymous: true,
    loginError: '',
    announcement: '',
    platform: null
  },

  onLoad() {
    const app = getApp()
    Promise.resolve(app.userReady).then(() => {
      this.setData({
        anonymous: !app.globalData.authorized,
        loginError: app.globalData.loginError
      })
      this.loadAnnouncement()
      this.refresh()
    })
    this.tryLocate()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.anonymous) return // 匿名不翻页（L1）
    this.loadMore()
  },

  onShow() {
    if (this._needRefresh) {
      this._needRefresh = false
      this.refresh()
    }
  },

  onHide() {
    this._needRefresh = true
  },

  /** 读取平台公告与发布开关（公开设置接口） */
  async loadAnnouncement() {
    try {
      const d = await taskService.getSettings()
      this.setData({
        announcement: d.announcement || '',
        platform: d
      })
    } catch (e) {
      console.warn('[hall] 读取平台设置失败', e.message)
    }
  },

  /** 静默获取当前位置；匿名不参与距离排序（避免反推坐标） */
  async tryLocate() {
    this.setData({ locating: true })
    try {
      const center = await locationUtil.getCurrentLocation()
      this.setData({ center })
      if (this.data.list.length && !this.data.anonymous) this.refresh()
    } catch (e) {
      console.warn('[hall] 定位失败，降级为按时间排序：', e.message)
    } finally {
      this.setData({ locating: false })
    }
  },

  /** 顶部引导条 / 各处登录入口 */
  async onLoginTap() {
    const ok = await loginDirect()
    if (!ok) return
    const app = getApp()
    this.setData({ anonymous: !app.globalData.authorized })
    this.refresh()
  },

  onSwitchTab(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.activeStatus) return
    if (this.data.anonymous) {
      // E1c：切筛选需要登录
      ensureAuthorized({ title: '登录后可筛选任务' }).then((ok) => {
        if (!ok) return
        const app = getApp()
        this.setData({ anonymous: !app.globalData.authorized, activeStatus: key })
        this.refresh()
      })
      return
    }
    this.setData({ activeStatus: key })
    this.refresh()
  },

  async refresh() {
    this.setData({ list: [], page: 0, finished: false })
    await this.loadMore(true)
  },

  async loadMore(reset) {
    if (this.data.loading) return
    if (!reset && this.data.finished) return
    this.setData({ loading: true })
    try {
      const res = await taskService.listTasks({
        status: this.data.activeStatus,
        page: this.data.page,
        center: this.data.center
      })
      this.setData({
        list: reset ? res.list : this.data.list.concat(res.list),
        page: this.data.page + 1,
        finished: res.anonymous ? true : !res.hasMore,
        anonymous: res.anonymous
      })
    } catch (err) {
      showError(err, '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 匿名点卡片 → 登录引导，不跳详情（L6 / E1b） */
  async onTapTask(e) {
    const { task } = e.detail
    if (!this.data.anonymous) {
      wx.navigateTo({ url: `/pages/task/detail/index?id=${task._id}` })
      return
    }

    const ok = await ensureAuthorized({
      title: '登录后才能查看任务详情',
      content: '确认身份后即可查看完整内容并接单，我们只获取你的微信标识。'
    })
    if (!ok) return

    const app = getApp()
    this.setData({ anonymous: !app.globalData.authorized })
    this.refresh()
    wx.navigateTo({ url: `/pages/task/detail/index?id=${task._id}` })
  },

  async onPublish() {
    if (this.data.platform && this.data.platform.allowPublish === false) {
      wx.showToast({ title: '平台暂停发布，请稍后再试', icon: 'none' })
      return
    }
    if (this.data.anonymous) {
      const ok = await ensureAuthorized({ title: '登录后才能发布任务' })
      if (!ok) return
      const app = getApp()
      this.setData({ anonymous: !app.globalData.authorized })
      this.refresh()
    }
    wx.navigateTo({ url: '/pages/task/publish/index' })
  }
})
