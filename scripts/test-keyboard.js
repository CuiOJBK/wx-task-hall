/**
 * 键盘偏移计算单元测试
 * 用法：node scripts/test-keyboard.js
 *
 * 覆盖 iOS（视口不变）与 Android（视口被压缩）两种键盘行为
 */
const assert = require('assert')
const path = require('path')

const { computeKeyboardOffset } = require(path.join(__dirname, '../miniprogram/utils/keyboard'))

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

console.log('键盘偏移计算测试\n')

console.log('[键盘收起]')
test('高度 0 → 偏移 0', () => {
  assert.strictEqual(computeKeyboardOffset(0, 800, 800), 0)
})
test('负数或空值 → 偏移 0', () => {
  assert.strictEqual(computeKeyboardOffset(-10, 800, 800), 0)
  assert.strictEqual(computeKeyboardOffset(null, 800, 800), 0)
  assert.strictEqual(computeKeyboardOffset(undefined, 800, 800), 0)
})

console.log('\n[iOS：视口高度不变，需要上移键盘高度]')
test('键高 300，视口 800→800 → 偏移 300', () => {
  assert.strictEqual(computeKeyboardOffset(300, 800, 800), 300)
})
test('键高 260，视口仅抖动 4px → 仍按 260 上移', () => {
  assert.strictEqual(computeKeyboardOffset(260, 800, 796), 260)
})

console.log('\n[Android：视口被压缩，fixed 已自动跟随，不能再叠加]')
test('键高 300，视口 800→500 → 偏移 0', () => {
  assert.strictEqual(computeKeyboardOffset(300, 800, 500), 0)
})
test('键高 300，视口 800→560（压缩 240 ≥ 150）→ 偏移 0', () => {
  assert.strictEqual(computeKeyboardOffset(300, 800, 560), 0)
})
test('键高 400，视口 800→600（压缩 200 < 200 边界）→ 按比例判定', () => {
  // 压缩 200，阈值 400*0.5=200，200 >= 200 成立 → 视为 resize
  assert.strictEqual(computeKeyboardOffset(400, 800, 600), 0)
})

console.log('\n[边界与异常]')
test('拿不到初始视口高度时不压缩，按键盘高度上移', () => {
  assert.strictEqual(computeKeyboardOffset(300, 0, 500), 300)
})
test('拿不到当前视口高度时不压缩，按键盘高度上移', () => {
  assert.strictEqual(computeKeyboardOffset(300, 800, 0), 300)
})
test('返回值永远是有效数字，不会 NaN', () => {
  const cases = [
    [300, 800, 800],
    [300, 0, 0],
    ['300', '800', '800'],
    [0, undefined, undefined]
  ]
  cases.forEach((args) => {
    const r = computeKeyboardOffset.apply(null, args)
    assert.ok(typeof r === 'number' && !Number.isNaN(r), `参数 ${JSON.stringify(args)} 返回 ${r}`)
    assert.ok(r >= 0, `偏移不能为负：${r}`)
  })
})

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
