/**
 * 评论服务：任务下的评论 与 大厅话题的回复 共用一套数据结构
 * targetType: 'task' | 'hall'，parentId 为空表示主楼，两级结构
 */
const { call } = require('../utils/cloud')
const { decorateComment } = require('../utils/format')
const config = require('../config/index')

async function listComments(targetType, targetId, p = {}) {
  const res = await call('comment', 'list', {
    targetType,
    targetId,
    page: p.page || 0,
    pageSize: p.pageSize || 20
  })
  const d = res.data || {}
  return { list: (d.list || []).map(decorateComment), hasMore: !!d.hasMore }
}

async function addComment(payload) {
  // payload: { targetType, targetId, content, parentId, replyTo }
  const res = await call('comment', 'add', payload)
  return res.data
}

async function removeComment(id) {
  const res = await call('comment', 'remove', { id })
  return res.data
}

/** 某条主楼下的回复分页（「查看更多回复」） */
async function getChildren(parentId, page) {
  const res = await call('comment', 'children', {
    parentId,
    page: page || 0,
    pageSize: 20
  })
  const d = res.data || {}
  return { list: (d.list || []).map(decorateComment), hasMore: !!d.hasMore }
}

/** 点赞 / 取消点赞（切换），返回 { liked, likeCount } */
async function toggleLike(id) {
  const res = await call('comment', 'like', { id })
  return res.data
}

module.exports = {
  listComments,
  addComment,
  removeComment,
  toggleLike,
  getChildren,
  pageSize: config.pageSize
}
