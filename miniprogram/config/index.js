/**
 * 全局配置
 * envId 留空时使用 wx.cloud.DYNAMIC_CURRENT_ENV（即当前默认云环境），
 * 多环境（开发/生产）时再显式填写环境 ID。
 */
module.exports = {
  // 留空则使用当前默认云环境；多环境时再填自己的环境 ID
  envId: '',
  // 分页大小
  pageSize: 10,
  // 数据库集合名（与 cloudfunctions/*/index.js 中保持一致）
  collections: {
    task: 'tasks',
    comment: 'comments',
    post: 'posts',
    user: 'users'
  },
  // 业务开关（预留：后续接入的内容安全、支付等）
  features: {
    contentSecurity: false, // 文本/图片内容安全检测
    mapPicker: true,        // 发布任务时是否允许选点
    rewardPayment: false,   // 悬赏在线支付（当前仅记录金额）
    debugEmoji: false       // 打印输入条的光标捕获日志（排查 emoji 插入位置问题时打开）
  }
}
