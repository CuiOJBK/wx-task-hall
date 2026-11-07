/**
 * 昵称规则单元测试
 * 用法：node scripts/test-nickname.js
 */
const assert = require('assert')
const path = require('path')

const N = require(path.join(__dirname, '../cloudfunctions/login/nickname'))
const {
  normalizeNickname,
  isValidNickname,
  nicknameKeyOf,
  placeholderKeyOf,
  nicknameChangeState
} = N

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

/**
 * 决策模拟：与服务端 updateProfile 的判断顺序保持一致
 * @returns {string} 'OK' | 'OK_IDEMPOTENT' | 错误码
 */
function decide(user, newNickname, registry) {
  const nick = normalizeNickname(newNickname)
  if (!isValidNickname(nick)) return 'NICKNAME_INVALID'

  const current = normalizeNickname(user.nickname)
  if (current && current === nick) return 'OK_IDEMPOTENT'

  const st = nicknameChangeState(user)
  if (!st.allowed) return 'NICKNAME_CHANGE_USED'

  const key = nicknameKeyOf(nick)
  if (registry[key] && registry[key] !== user.openid) return 'NICKNAME_TAKEN'

  return 'OK'
}

console.log('昵称规则测试\n')

console.log('[归一化]')
test('去首尾空白', () => {
  assert.strictEqual(normalizeNickname('  Tom  '), 'Tom')
})
test('压缩连续空白', () => {
  assert.strictEqual(normalizeNickname('a   b'), 'a b')
})
test('全角空格转半角', () => {
  assert.strictEqual(normalizeNickname('a\u3000b'), 'a b')
})
test('空值安全', () => {
  assert.strictEqual(normalizeNickname(null), '')
  assert.strictEqual(normalizeNickname(undefined), '')
})

console.log('\n[合法性]')
test('2 字可通过', () => assert.strictEqual(isValidNickname('小明'), true))
test('1 字拒绝', () => assert.strictEqual(isValidNickname('明'), false))
test('20 字可通过', () => assert.strictEqual(isValidNickname('一'.repeat(20)), true))
test('21 字拒绝', () => assert.strictEqual(isValidNickname('一'.repeat(21)), false))
test('纯数字拒绝', () => assert.strictEqual(isValidNickname('12345'), false))
test('纯空白拒绝', () => assert.strictEqual(isValidNickname('   '), false))

console.log('\n[唯一键：不区分大小写]')
test('Tom 与 tom 生成同一个 key', () => {
  assert.strictEqual(nicknameKeyOf('Tom'), nicknameKeyOf('tom'))
})
test('带空白的 Tom 与 tom 同 key', () => {
  assert.strictEqual(nicknameKeyOf(' Tom '), nicknameKeyOf('tom'))
})
test('不同昵称 key 不同', () => {
  assert.notStrictEqual(nicknameKeyOf('Tom'), nicknameKeyOf('Jerry'))
})
test('占位键按 openid 唯一', () => {
  assert.strictEqual(placeholderKeyOf('oA'), 'u:oA')
  assert.notStrictEqual(placeholderKeyOf('oA'), placeholderKeyOf('oB'))
})
test('占位键不会与真实昵称键冲突', () => {
  assert.ok(placeholderKeyOf('oA').indexOf('n:') !== 0)
})

console.log('\n[修改次数状态]')
test('未设昵称 → 首次设置，不计次数', () => {
  const st = nicknameChangeState({ nickname: '', nicknameChangeCount: 0 })
  assert.deepStrictEqual(st, { allowed: true, isFirstSet: true })
})
test('已设昵称且未改过 → 可修改', () => {
  const st = nicknameChangeState({ nickname: '小明', nicknameChangeCount: 0 })
  assert.deepStrictEqual(st, { allowed: true, isFirstSet: false })
})
test('已改过一次 → 拒绝', () => {
  const st = nicknameChangeState({ nickname: '小明', nicknameChangeCount: 1 })
  assert.strictEqual(st.allowed, false)
  assert.strictEqual(st.reason, 'NICKNAME_CHANGE_USED')
})
test('老数据缺 nicknameChangeCount → 视为未改过', () => {
  const st = nicknameChangeState({ nickname: '小明' })
  assert.strictEqual(st.allowed, true)
})

console.log('\n[三个关键场景]')
test('场景1：首次修改成功（用户原来没昵称）', () => {
  const user = { openid: 'oA', nickname: '', nicknameChangeCount: 0 }
  assert.strictEqual(decide(user, '小明', {}), 'OK')
})
test('场景2：二次修改被拒绝', () => {
  const user = { openid: 'oA', nickname: '小明', nicknameChangeCount: 1 }
  assert.strictEqual(decide(user, '小红', { 'n:小明': 'oA' }), 'NICKNAME_CHANGE_USED')
})
test('场景3：昵称重复被拒绝', () => {
  const user = { openid: 'oA', nickname: '小明', nicknameChangeCount: 0 }
  const registry = { 'n:张三': 'oB' }
  assert.strictEqual(decide(user, '张三', registry), 'NICKNAME_TAKEN')
})
test('场景3b：大小写不同也算重复', () => {
  const user = { openid: 'oA', nickname: '小明', nicknameChangeCount: 0 }
  const registry = { [nicknameKeyOf('Tom')]: 'oB' }
  assert.strictEqual(decide(user, 'tom', registry), 'NICKNAME_TAKEN')
})
test('场景3c：重复提交自己的昵称 → 幂等成功，不消耗次数', () => {
  const user = { openid: 'oA', nickname: '小明', nicknameChangeCount: 0 }
  assert.strictEqual(decide(user, '小明', { 'n:小明': 'oA' }), 'OK_IDEMPOTENT')
})
test('首次设置时撞名 → 拒绝，且不消耗次数', () => {
  const user = { openid: 'oA', nickname: '', nicknameChangeCount: 0 }
  assert.strictEqual(decide(user, '张三', { 'n:张三': 'oB' }), 'NICKNAME_TAKEN')
})
test('非法昵称优先于重复判定', () => {
  const user = { openid: 'oA', nickname: '小明', nicknameChangeCount: 0 }
  assert.strictEqual(decide(user, '1', { 'n:1': 'oB' }), 'NICKNAME_INVALID')
})

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
