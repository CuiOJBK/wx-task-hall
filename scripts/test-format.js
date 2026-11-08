/**
 * 展示层格式化工具测试（联系方式打码）
 * 用法：node scripts/test-format.js
 */
const assert = require('assert')
const path = require('path')

const { maskContact } = require(path.join(__dirname, '../miniprogram/utils/format'))

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

console.log('联系方式打码测试\n')

test('11 位手机号保留前 3 后 4', () => {
  assert.strictEqual(maskContact('13812345678'), '138****5678')
})
test('带分隔符的手机号只打码数字，符号保留', () => {
  assert.strictEqual(maskContact('138-1234-5678'), '138-****-5678')
})
test('带空格的手机号', () => {
  assert.strictEqual(maskContact('138 1234 5678'), '138 **** 5678')
})
test('微信号保留首尾各 2 字符', () => {
  assert.strictEqual(maskContact('wxid_abc123'), 'wx****23')
})
test('短文本（<=2）只留 1 个字符', () => {
  assert.strictEqual(maskContact('ab'), 'a****')
})
test('4 字符文本留首尾各 1', () => {
  assert.strictEqual(maskContact('abcd'), 'a****d')
})
test('空值返回空串', () => {
  assert.strictEqual(maskContact(''), '')
  assert.strictEqual(maskContact(null), '')
})
test('打码后不包含原始号码中段', () => {
  const masked = maskContact('13999998888')
  assert.ok(masked.indexOf('999') === -1, masked)
})

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
