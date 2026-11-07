/**
 * emoji 工具单元测试（纯函数，不依赖小程序环境）
 * 用法：node scripts/test-emoji.js
 */
const assert = require('assert')
const path = require('path')

const { CATEGORIES, charLength, insertAt, deleteBefore } = require(path.join(
  __dirname,
  '../miniprogram/utils/emoji'
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

console.log('emoji 工具测试\n')

console.log('[字数统计]')
test('纯文本按字符数', () => {
  assert.strictEqual(charLength('hello'), 5)
})
test('单个 emoji 记 1 个字（String.length 会是 2）', () => {
  assert.strictEqual('😀'.length, 2)
  assert.strictEqual(charLength('😀'), 1)
})
test('文本与 emoji 混合', () => {
  assert.strictEqual(charLength('a😀b'), 3)
})
test('连续 emoji', () => {
  assert.strictEqual(charLength('😀😀😀'), 3)
})
test('空值返回 0', () => {
  assert.strictEqual(charLength(''), 0)
  assert.strictEqual(charLength(null), 0)
})

console.log('\n[光标插入]')
test('插入到开头', () => {
  const r = insertAt('abc', '😀', 0)
  assert.strictEqual(r.value, '😀abc')
  assert.strictEqual(r.cursor, 2)
})
test('插入到中间', () => {
  const r = insertAt('hello', '😀', 2)
  assert.strictEqual(r.value, 'he😀llo')
  assert.strictEqual(r.cursor, 4)
})
test('插入到末尾', () => {
  const r = insertAt('hello', '😀', 5)
  assert.strictEqual(r.value, 'hello😀')
  assert.strictEqual(r.cursor, 7)
})
test('cursor 为 -1 时追加到末尾（首次点表情的场景）', () => {
  const r = insertAt('hello', '😀', -1)
  assert.strictEqual(r.value, 'hello😀')
})
test('cursor 越界时收敛到末尾', () => {
  const r = insertAt('ab', '😀', 99)
  assert.strictEqual(r.value, 'ab😀')
})
test('连续插入两个 emoji 位置正确累积', () => {
  const r1 = insertAt('hello', '😀', 2)
  const r2 = insertAt(r1.value, '🎉', r1.cursor)
  assert.strictEqual(r2.value, 'he😀🎉llo')
})
test('空文本插入', () => {
  const r = insertAt('', '😀', 0)
  assert.strictEqual(r.value, '😀')
})

console.log('\n[删除]')
test('删除 emoji 一次删完整字符，不留半个代理对', () => {
  const r = deleteBefore('a😀', 3)
  assert.strictEqual(r.value, 'a')
  assert.strictEqual(r.cursor, 1)
})
test('删除普通字符', () => {
  const r = deleteBefore('abc', 3)
  assert.strictEqual(r.value, 'ab')
})
test('光标在 0 时不删', () => {
  const r = deleteBefore('abc', 0)
  assert.strictEqual(r.value, 'abc')
  assert.strictEqual(r.cursor, 0)
})
test('删除后紧跟插入的 emoji', () => {
  const ins = insertAt('abc', '😀', 3)
  const del = deleteBefore(ins.value, ins.cursor)
  assert.strictEqual(del.value, 'abc')
})

console.log('\n[数据完整性]')
test('分类数量与每个分类非空', () => {
  assert.ok(CATEGORIES.length >= 6)
  CATEGORIES.forEach((c) => {
    assert.ok(c.key && c.name && c.list.length > 0, `分类 ${c.key} 数据异常`)
  })
})
test('分类内无重复表情', () => {
  CATEGORIES.forEach((c) => {
    const uniq = new Set(c.list)
    assert.strictEqual(uniq.size, c.list.length, `分类 ${c.name} 有重复表情`)
  })
})
test('所有表情都是非空字符串且不含空格', () => {
  CATEGORIES.forEach((c) => {
    c.list.forEach((e) => {
      assert.strictEqual(typeof e, 'string')
      assert.ok(e.length > 0 && e.trim() === e, `非法表情: ${JSON.stringify(e)}`)
    })
  })
})

const total = CATEGORIES.reduce((n, c) => n + c.list.length, 0)
console.log(`\n结果：${pass} 通过 / ${failures.length} 失败　共 ${CATEGORIES.length} 个分类 ${total} 个表情`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
