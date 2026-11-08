/**
 * taskcron 云函数：接单超时处理
 *
 * 每小时整点触发（config.json 的 timer 触发器）。
 *
 * 两段式策略：
 *   1. 超过 acceptTimeoutHours（默认 24h）→ 打 timeoutRemindedAt 标记 + 发站内通知
 *   2. 超过 2 倍时长仍未提交 → 自动回收：status 回 pending、清空接单者、发通知
 *
 * 为什么是回收而不是直接取消：发布者还要找人，任务回大厅比作废更有用。
 * 接单者扣信用分要等 P2-2 信用分体系，这里只留数据（autoReopenedAt）。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_TASK = 'tasks'
const C_SETTING = 'settings'
const C_NOTIFY = 'notifications'

const STATUS = { PENDING: 'pending', ACCEPTED: 'accepted' }
const DEFAULT_TIMEOUT_HOURS = 24

async function safeGet(query, fallback) {
  try {
    const r = await query.get()
    return r.data
  } catch (e) {
    return fallback
  }
}

async function addWithColl(name, data) {
  try {
    return await db.collection(name).add({ data })
  } catch (e) {
    const msg = (e && e.message) || ''
    if (/not exist|not found|collection/i.test(msg)) {
      await db.createCollection(name).catch(() => {})
      return await db.collection(name).add({ data })
    }
    throw e
  }
}

async function getTimeoutHours() {
  const rows = await safeGet(db.collection(C_SETTING).where({ key: 'global' }).limit(1), [])
  const v = (rows[0] && rows[0].value) || {}
  const hours = Number(v.acceptTimeoutHours)
  if (Number.isNaN(hours) || hours < 1 || hours > 168) return DEFAULT_TIMEOUT_HOURS
  return hours
}

async function notify(toOpenid, task, type, text) {
  if (!toOpenid) return
  await addWithColl(C_NOTIFY, {
    toOpenid,
    type,
    taskId: task._id,
    title: task.title || '',
    body: text,
    read: false,
    createdAt: db.serverDate()
  }).catch((e) => console.warn('[taskcron] 写通知失败', e.message))
}

exports.main = async (event = {}) => {
  const startedAt = Date.now()
  const hours = await getTimeoutHours()
  const hourMs = 3600 * 1000
  const remindBefore = new Date(Date.now() - hours * hourMs)
  const reopenBefore = new Date(Date.now() - hours * 2 * hourMs)

  const result = { hours, reminded: 0, reopened: 0, errors: [] }

  // ---------- 1) 严重超时：自动回收 ----------
  const staleTasks = await safeGet(
    db
      .collection(C_TASK)
      .where({
        status: STATUS.ACCEPTED,
        takenAt: _.lt(reopenBefore),
        autoReopenedAt: _.exists(false)
      })
      .limit(50),
    []
  )

  for (const task of staleTasks) {
    try {
      const res = await db
        .collection(C_TASK)
        .where({ _id: task._id, status: STATUS.ACCEPTED })
        .update({
          data: {
            status: STATUS.PENDING,
            takerOpenid: '',
            autoReopenedAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      if (res.stats && res.stats.updated === 1) {
        result.reopened++
        await notify(
          task.takerOpenid,
          task,
          'task_timeout_reopen',
          `你接的任务「${task.title}」超过 ${hours * 2} 小时未提交，已自动退回大厅`
        )
        await notify(
          task.ownerOpenid,
          task,
          'task_timeout_owner',
          `你的任务「${task.title}」因接单人长时间未完成，已重新开放接单`
        )
      }
    } catch (e) {
      result.errors.push(task._id)
      console.warn('[taskcron] 回收失败', task._id, e.message)
    }
  }

  // ---------- 2) 轻度超时：提醒一次 ----------
  const reminders = await safeGet(
    db
      .collection(C_TASK)
      .where({
        status: STATUS.ACCEPTED,
        takenAt: _.lt(remindBefore),
        timeoutRemindedAt: _.exists(false)
      })
      .limit(50),
    []
  )

  for (const task of reminders) {
    try {
      await db
        .collection(C_TASK)
        .doc(task._id)
        .update({ data: { timeoutRemindedAt: db.serverDate() } })
      result.reminded++
      await notify(
        task.takerOpenid,
        task,
        'task_timeout_remind',
        `你接的任务「${task.title}」已超过 ${hours} 小时未提交，请尽快完成`
      )
    } catch (e) {
      result.errors.push(task._id)
      console.warn('[taskcron] 提醒失败', task._id, e.message)
    }
  }

  const payload = Object.assign({}, result, { costMs: Date.now() - startedAt })
  console.log('[taskcron] 执行完成', JSON.stringify(payload))
  return { code: 0, data: payload, msg: 'ok' }
}
