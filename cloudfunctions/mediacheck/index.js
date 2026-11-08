/**
 * mediacheck 云函数：图片内容安全异步回调
 *
 * 微信的消息推送事件 `wxa_media_check` 会推到这里。必须在
 * 小程序后台 → 开发管理 → 消息推送 里配置，事件类型勾选「图片审核」，
 * 推送方式选云函数并把环境/函数名指向本函数。没配置则收不到结果，
 * 图片仍可正常上传展示，但违规图不会被自动删除。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const C_CHECK = 'image_checks'
const C_TASK = 'tasks'

async function safeUpdate(coll, id, data) {
  try {
    await db.collection(coll).doc(id).update({ data })
  } catch (e) {
    console.warn('[mediacheck] 更新失败', coll, id, e.message)
  }
}

exports.main = async (event = {}) => {
  try {
    if (event.Event !== 'wxa_media_check') return { code: 0, msg: 'ignored' }

    const traceId = event.trace_id
    const suggest = (event.result && event.result.suggest) || 'pass'
    if (!traceId) return { code: 0, msg: 'no trace_id' }

    const rows = await db
      .collection(C_CHECK)
      .where({ traceId })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const record = (rows.data || [])[0]
    if (!record) return { code: 0, msg: 'record not found' }

    await safeUpdate(C_CHECK, record._id, {
      status: suggest,
      result: JSON.stringify(event.result || {}).slice(0, 500),
      checkedAt: db.serverDate()
    })

    // 判定违规：删存储文件 + 从任务里摘掉这张图
    if (suggest === 'block' && record.fileID) {
      await cloud.deleteFile({ fileList: [record.fileID] }).catch((e) => {
        console.warn('[mediacheck] 删除文件失败', record.fileID, e.message)
      })

      if (record.targetType === 'task' && record.targetId) {
        await safeUpdate(C_TASK, record.targetId, {
          images: _.pull(record.fileID),
          proofImages: _.pull(record.fileID),
          imageBlocked: true
        })
      }
    }

    return { code: 0 }
  } catch (e) {
    // 必须返回 0，否则微信会持续重推
    console.error('[mediacheck] 处理异常', e)
    return { code: 0 }
  }
}
