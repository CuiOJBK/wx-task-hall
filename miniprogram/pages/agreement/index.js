const SECTIONS = [
  {
    key: 'terms',
    name: '用户协议',
    blocks: [
      {
        title: '一、服务说明',
        paragraphs: [
          '本小程序为用户提供任务信息发布与接单撮合服务。平台仅提供信息展示与沟通工具，不参与任务的实际履行，不对任务结果作出担保。',
          '发布者应保证任务信息真实、合法、可完成；接单者应具备完成该任务的能力，并按约定时间与质量交付。'
        ]
      },
      {
        title: '二、账号规则',
        paragraphs: [
          '本服务使用微信授权登录，无需单独注册账号。你需对使用本账号进行的所有操作负责。',
          '昵称全局唯一且仅可修改一次，请谨慎设置。账号不得转让、出借或用于任何违法用途。'
        ]
      },
      {
        title: '三、行为规范',
        paragraphs: [
          '禁止发布违法违规、涉及人身危险、代考代写、刷单炒信、金融借贷、色情低俗、赌博等类型的内容或任务。',
          '禁止在任务中索要他人身份证号、银行卡号、支付密码等敏感信息；禁止以任何形式骚扰、威胁其他用户。'
        ]
      },
      {
        title: '四、内容规范与审核',
        paragraphs: [
          '你发布的任务、评论、话题、昵称等文字内容会经过内容安全检测。命中敏感内容将被拒绝发布。',
          '平台有权对违规内容进行删除、对违规账号限制功能直至封禁，且无需事先通知。'
        ]
      },
      {
        title: '五、纠纷与免责',
        paragraphs: [
          '任务履行过程中产生的纠纷由双方自行协商解决。平台可提供沟通记录作为参考，但不承担赔付责任。',
          '因不可抗力、网络故障、第三方服务中断导致的服务不可用，平台不承担赔偿责任。'
        ]
      },
      {
        title: '六、协议变更',
        paragraphs: [
          '本协议可能随功能调整而更新，更新后在页面公示。继续使用即视为接受更新后的协议。'
        ]
      }
    ]
  },
  {
    key: 'privacy',
    name: '隐私政策',
    blocks: [
      {
        title: '一、我们收集哪些信息',
        paragraphs: [
          '微信标识（openid）：用于识别你的账户身份，区分任务归属，无法反向定位到你的真实姓名。',
          '你主动填写的昵称、头像：用于在任务与评论中展示，属于公开信息。',
          '位置信息：仅在你主动选择任务地点、或同意「按距离排序」时获取，用于生成任务地点和计算距离。我们不会在后台持续定位。',
          '你发布的任务内容、评论、话题文字：用于展示和履行服务。'
        ]
      },
      {
        title: '二、信息的使用',
        paragraphs: [
          '上述信息仅用于实现任务发布、接单、沟通、内容展示等本服务功能，不会用于广告推送或出售给第三方。',
          '未登录状态下你仅能浏览任务大厅的前 10 条摘要；任务详细地址、联系方式等需登录后可见，且地址对未登录用户做区县级脱敏。'
        ]
      },
      {
        title: '三、存储与保护',
        paragraphs: [
          '数据存储于微信云开发（腾讯云）境内服务器，传输过程加密。',
          '我们按最小必要原则控制数据访问权限，联系方式仅对任务双方可见。'
        ]
      },
      {
        title: '四、信息共享',
        paragraphs: [
          '除以下情形外不对外共享：你主动在任务中填写的联系方式会展示给任务双方；法律法规要求或司法、行政机关依法要求提供。'
        ]
      },
      {
        title: '五、你的权利',
        paragraphs: [
          '你可以随时修改昵称头像、删除自己发布的评论与话题。如需注销账号或删除全部数据，可通过下方联系方式提出。'
        ]
      },
      {
        title: '六、联系我们',
        paragraphs: [
          '运营主体：【请填写主体名称】',
          '联系邮箱：【请填写邮箱】'
        ]
      }
    ]
  }
]

Page({
  data: {
    sections: SECTIONS,
    activeKey: 'terms',
    active: SECTIONS[0]
  },

  onLoad(options) {
    const key = options && options.tab === 'privacy' ? 'privacy' : 'terms'
    this.setData({ activeKey: key, active: SECTIONS.find((s) => s.key === key) || SECTIONS[0] })
    wx.setNavigationBarTitle({ title: key === 'privacy' ? '隐私政策' : '用户协议' })
  },

  onSwitch(e) {
    const { key } = e.currentTarget.dataset
    const target = SECTIONS.find((s) => s.key === key)
    if (!target || key === this.data.activeKey) return
    this.setData({ activeKey: key, active: target })
    wx.setNavigationBarTitle({ title: key === 'privacy' ? '隐私政策' : '用户协议' })
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/hall/index' }) })
  }
})
