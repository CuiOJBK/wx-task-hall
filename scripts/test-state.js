/**
 * 任务状态机与距离计算单元测试（D-3）
 * 用法：node scripts/test-state.js
 */
const assert = require('assert')
const path = require('path')

const { STATUS, evaluateTransition, haversine } = require(path.join(
  __dirname,
  '../cloudfunctions/task/state'
))

let pass = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push({ name, message: e.message })
    console.log('  ✗ ' + name + ' -> ' + e.message)
  }
}

/** 构造一个任务，默认 pending、owner=o1 */
function makeTask(over) {
  return Object.assign(
    { _id: 't1', status: STATUS.PENDING, ownerOpenid: 'o1', takerOpenid: '' },
    over || {}
  )
}

const OWNER = 'o1'
const TAKER = 'o2'
const OTHER = 'o3'

console.log('任务状态机测试\n')

console.log('[正常流转]')
test('pending 状态下他人可接单', () => {
  const v = evaluateTransition('grab', makeTask(), TAKER)
  assert.strictEqual(v.allowed, true)
  assert.strictEqual(v.to, STATUS.ACCEPTED)
})
test('accepted 状态下接单者可提交', () => {
  const task = makeTask({ status: STATUS.ACCEPTED, takerOpenid: TAKER })
  const v = evaluateTransition('submit', task, TAKER)
  assert.strictEqual(v.allowed, true)
  assert.strictEqual(v.to, STATUS.CONFIRMING)
})
test('confirming 状态下发布者可确认', () => {
  const task = makeTask({ status: STATUS.CONFIRMING, takerOpenid: TAKER })
  const v = evaluateTransition('confirm', task, OWNER)
  assert.strictEqual(v.allowed, true)
  assert.strictEqual(v.to, STATUS.COMPLETED)
})
test('pending 状态下发布者可取消', () => {
  const v = evaluateTransition('cancel', makeTask(), OWNER)
  assert.strictEqual(v.allowed, true)
  assert.strictEqual(v.to, STATUS.CANCELLED)
})

console.log('\n[身份校验]')
test('不能接自己发布的任务', () => {
  const v = evaluateTransition('grab', makeTask(), OWNER)
  assert.strictEqual(v.allowed, false)
  assert.strictEqual(v.code, 'SELF_GRAB')
})
test('非接单者不能提交', () => {
  const task = makeTask({ status: STATUS.ACCEPTED, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('submit', task, OTHER).code, 'FORBIDDEN')
})
test('非发布者不能确认', () => {
  const task = makeTask({ status: STATUS.CONFIRMING, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('confirm', task, TAKER).code, 'FORBIDDEN')
})
test('非发布者不能取消', () => {
  assert.strictEqual(evaluateTransition('cancel', makeTask(), TAKER).code, 'FORBIDDEN')
})

console.log('\n[状态冲突]')
test('已接单的任务不能再接', () => {
  const task = makeTask({ status: STATUS.ACCEPTED, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('grab', task, OTHER).code, 'STATUS_CONFLICT')
})
test('未接单时提交：身份校验先于状态校验，返回 FORBIDDEN', () => {
  // 与原实现顺序一致：先判「是不是接单者」，再判状态
  assert.strictEqual(evaluateTransition('submit', makeTask(), TAKER).code, 'FORBIDDEN')
})
test('接单者身份但对已取消任务提交 → 状态冲突', () => {
  const task = makeTask({ status: STATUS.CANCELLED, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('submit', task, TAKER).code, 'STATUS_CONFLICT')
})
test('accepted 状态不能直接确认', () => {
  const task = makeTask({ status: STATUS.ACCEPTED, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('confirm', task, OWNER).code, 'STATUS_CONFLICT')
})
test('已接单的任务不能取消', () => {
  const task = makeTask({ status: STATUS.ACCEPTED, takerOpenid: TAKER })
  assert.strictEqual(evaluateTransition('cancel', task, OWNER).code, 'STATUS_CONFLICT')
})

console.log('\n[终态不可再变]')
test('completed 状态任何动作都被拒', () => {
  const task = makeTask({ status: STATUS.COMPLETED, takerOpenid: TAKER })
  ;['grab', 'submit', 'confirm', 'cancel'].forEach((action) => {
    const v = evaluateTransition(action, task, OWNER)
    assert.strictEqual(v.allowed, false, action + ' 应被拒')
  })
})
test('cancelled 状态任何动作都被拒', () => {
  const task = makeTask({ status: STATUS.CANCELLED })
  ;['grab', 'submit', 'confirm', 'cancel'].forEach((action) => {
    assert.strictEqual(evaluateTransition(action, task, OWNER).allowed, false)
  })
})

console.log('\n[异常入参]')
test('未知动作', () => {
  assert.strictEqual(evaluateTransition('pay', makeTask(), OWNER).code, 'UNKNOWN_ACTION')
})
test('任务不存在', () => {
  assert.strictEqual(evaluateTransition('grab', null, TAKER).code, 'NOT_FOUND')
})
test('未登录', () => {
  assert.strictEqual(evaluateTransition('grab', makeTask(), '').code, 'UNAUTHORIZED')
})

console.log('\n[距离计算]')
test('同一坐标距离为 0', () => {
  const p = { latitude: 22.5431, longitude: 114.0579 }
  assert.strictEqual(haversine(p, p), 0)
})
test('深圳到北京约 1940 公里（±60km）', () => {
  const sz = { latitude: 22.5431, longitude: 114.0579 }
  const bj = { latitude: 39.9042, longitude: 116.4074 }
  const d = haversine(sz, bj)
  assert.ok(d > 1880000 && d < 2000000, '实际 ' + d)
})
test('坐标缺失返回 null', () => {
  assert.strictEqual(haversine({ latitude: null, longitude: 1 }, { latitude: 1, longitude: 1 }), null)
  assert.strictEqual(haversine(null, { latitude: 1, longitude: 1 }), null)
})
test('距离对称', () => {
  const a = { latitude: 22.5, longitude: 114 }
  const b = { latitude: 39.9, longitude: 116.4 }
  assert.strictEqual(haversine(a, b), haversine(b, a))
})

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
