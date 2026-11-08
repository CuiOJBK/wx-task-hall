/**
 * initdb 云函数：一次性初始化
 * 在云开发控制台「云函数 - initdb - 云端测试」里执行一次，event 传 {} 即可。
 * 传 {"seed": true} 会写入一条示例任务和一条示例话题，方便验证页面。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = ['tasks', 'comments', 'posts', 'users', 'likes', 'reports', 'admin_logs', 'settings']

/**
 * 管理员白名单（逗号分隔的 openid）
 * 在 云开发控制台 → 云函数 → initdb → 配置 → 环境变量 里设置 ADMIN_OPENIDS
 *
 * 规则：
 *  - 控制台「云端测试」调用没有 OPENID  → 放行（只有管理员能进控制台）
 *  - 小程序端调用一定带 OPENID        → 必须在白名单里
 *  - 未配置白名单且从客户端调用        → 一律拒绝（默认安全）
 */
function adminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function createCollection(name) {
  try {
    await db.createCollection(name)
    return 'created'
  } catch (e) {
    return 'exists'
  }
}

async function seed() {
  const { OPENID } = cloud.getWXContext()
  const now = db.serverDate()
  const result = { task: null, post: null }

  const taskCount = await db
    .collection('tasks')
    .where({ ownerOpenid: OPENID })
    .count()
    .catch(() => ({ total: 0 }))

  if (!taskCount.total) {
    const r = await db.collection('tasks').add({
      data: {
        title: '示例任务：帮取一个快递送到 3 号宿舍楼',
        desc: '快递在菜鸟驿站，取件码会私信给你。送到楼下打电话即可，10 分钟内能完成。',
        reward: 5,
        contact: '',
        location: {
          name: '菜鸟驿站（示例）',
          address: '示例地址，可在发布页重新选点',
          latitude: 39.908823,
          longitude: 116.39747
        },
        geo: new db.Geo.Point(116.39747, 39.908823),
        status: 'pending',
        ownerOpenid: OPENID,
        takerOpenid: '',
        commentCount: 0,
        createdAt: now,
        updatedAt: now
      }
    })
    result.task = r._id
  }

  const postCount = await db
    .collection('posts')
    .where({ openid: OPENID })
    .count()
    .catch(() => ({ total: 0 }))

  if (!postCount.total) {
    const r = await db.collection('posts').add({
      data: {
        content: '欢迎来到任务大厅交流区。这里可以发闲聊、经验、组队需求，和任务无关的都放这儿。',
        images: [],
        openid: OPENID,
        nickname: '',
        replyCount: 0,
        likeCount: 0,
        createdAt: now,
        updatedAt: now
      }
    })
    result.post = r._id
  }

  return result
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const allow = adminOpenids()

  if (OPENID) {
    if (!allow.length) {
      console.warn('[initdb] 未配置 ADMIN_OPENIDS，拒绝客户端调用', OPENID)
      return { code: 'FORBIDDEN', msg: '未配置管理员白名单，禁止从客户端调用；请在云函数环境变量设置 ADMIN_OPENIDS' }
    }
    if (allow.indexOf(OPENID) === -1) {
      console.warn('[initdb] 非白名单用户尝试调用', OPENID)
      return { code: 'FORBIDDEN', msg: '无权执行初始化' }
    }
  }

  const report = {}
  for (const name of COLLECTIONS) {
    report[name] = await createCollection(name)
  }

  let seedResult = null
  if (event.seed) {
    try {
      seedResult = await seed()
    } catch (e) {
      seedResult = { error: e.message }
    }
  }

  return {
    code: 0,
    msg: 'ok',
    data: {
      collections: report,
      seeded: seedResult,
      next: '请到 云开发控制台 - 数据库 - 索引管理，为 tasks 建 created_at/status 索引，为 geo 建 2dsphere 索引'
    }
  }
}
