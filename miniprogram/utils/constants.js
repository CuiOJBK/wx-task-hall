/**
 * 全局常量：集合名、任务状态机、错误码
 * 注意：云函数侧有一份同步副本，改动时两处都要改（各 cloudfunctions 目录下的 index.js 顶部）。
 */

// 任务状态机（与需求文档一致）
// pending 待接单 -> accepted 进行中 -> confirming 待确认 -> completed 已完成
// 任意状态中仅 pending 可 cancelled（取消）
const TASK_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const TASK_STATUS_LABEL = {
  pending: '待接单',
  accepted: '进行中',
  confirming: '待确认',
  completed: '已完成',
  cancelled: '已取消'
}

// 合法的状态流转表：当前状态 -> 允许流转到的状态
const TASK_STATUS_FLOW = {
  pending: ['accepted', 'cancelled'],
  accepted: ['confirming'],
  confirming: ['completed'],
  completed: [],
  cancelled: []
}

// 评论承载对象类型：任务下评论 / 大厅话题回复
const COMMENT_TARGET = {
  TASK: 'task',
  HALL: 'hall'
}

// 统一错误码（云函数返回 code，前端按 code 做分支）
const ERR = {
  OK: 0,
  INVALID_PARAM: 'INVALID_PARAM',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  STATUS_CONFLICT: 'STATUS_CONFLICT',
  SELF_GRAB: 'SELF_GRAB',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
}

module.exports = {
  TASK_STATUS,
  TASK_STATUS_LABEL,
  TASK_STATUS_FLOW,
  COMMENT_TARGET,
  ERR
}
