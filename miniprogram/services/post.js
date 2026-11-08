/**
 * 大厅话题服务（任务大厅的公共交流区）
 */
const { call } = require('../utils/cloud')
const { decoratePost } = require('../utils/format')
const config = require('../config/index')

async function listPosts(p = {}) {
  const res = await call('post', 'list', {
    page: p.page || 0,
    pageSize: p.pageSize || config.pageSize
  })
  const d = res.data || {}
  return { list: (d.list || []).map(decoratePost), hasMore: !!d.hasMore }
}

async function getPost(id) {
  const res = await call('post', 'detail', { id })
  return res.data
}

async function createPost(payload) {
  // payload: { content, images? }
  const res = await call('post', 'create', payload)
  return res.data
}

async function removePost(id) {
  const res = await call('post', 'remove', { id })
  return res.data
}

/** 点赞 / 取消点赞（切换），返回 { liked, likeCount } */
async function toggleLike(id) {
  const res = await call('post', 'like', { id })
  return res.data
}

module.exports = { listPosts, getPost, createPost, removePost, toggleLike }
