/**
 * 举报服务
 * 理由列表与云函数 REASONS 保持一致；服务端为权威，不一致时会被拒（INVALID_PARAM）
 */
const { call } = require('../utils/cloud')

const REASONS = ['虚假信息', '违法违规', '骚扰辱骂', '涉嫌诈骗', '广告刷屏', '其他']

async function createReport(payload) {
  // payload: { targetType: 'task'|'post'|'comment', targetId, reason, detail }
  const res = await call('report', 'create', payload)
  return res.data
}

module.exports = { createReport, REASONS }
