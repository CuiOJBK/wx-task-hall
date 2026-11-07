/**
 * 地址区划解析与脱敏单元测试
 * 用法：node scripts/test-region.js
 */
const assert = require('assert')
const path = require('path')

const { parseRegion, regionTextOf, maskLocation } = require(path.join(
  __dirname,
  '../cloudfunctions/task/region'
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

console.log('地址脱敏测试\n')

console.log('[正常省市区]')
test('广东省深圳市南山区 → 深圳市南山区', () => {
  const r = parseRegion('广东省深圳市南山区科技南十路8号')
  assert.strictEqual(r.province, '广东省')
  assert.strictEqual(r.city, '深圳市')
  assert.strictEqual(r.district, '南山区')
  assert.strictEqual(r.regionText, '深圳市南山区')
})
test('浙江省杭州市西湖区 → 杭州市西湖区', () => {
  assert.strictEqual(parseRegion('浙江省杭州市西湖区文三路100号').regionText, '杭州市西湖区')
})
test('江苏省南京市玄武区 → 南京市玄武区', () => {
  assert.strictEqual(parseRegion('江苏省南京市玄武区中山路1号').regionText, '南京市玄武区')
})

console.log('\n[直辖市 / 特殊行政区]')
test('北京市海淀区 → 北京市海淀区（无省级）', () => {
  const r = parseRegion('北京市海淀区中关村大街1号')
  assert.strictEqual(r.province, '')
  assert.strictEqual(r.city, '北京市')
  assert.strictEqual(r.regionText, '北京市海淀区')
})
test('上海市浦东新区 → 上海市浦东新区', () => {
  assert.strictEqual(parseRegion('上海市浦东新区世纪大道100号').regionText, '上海市浦东新区')
})
test('内蒙古自治区呼和浩特市新城区（自治区）', () => {
  assert.strictEqual(parseRegion('内蒙古自治区呼和浩特市新城区海东路').regionText, '呼和浩特市新城区')
})
test('香港特别行政区', () => {
  assert.strictEqual(parseRegion('香港特别行政区中西区皇后大道').regionText, '香港特别行政区中西区')
})

console.log('\n[降级场景]')
test('只有市没有区 → 只返回市', () => {
  assert.strictEqual(parseRegion('四川省成都市天府大道').regionText, '成都市')
})
test('只有省 → 返回省', () => {
  assert.strictEqual(parseRegion('海南省').regionText, '海南省')
})
test('空字符串 → 空', () => {
  assert.strictEqual(parseRegion('').regionText, '')
  assert.strictEqual(parseRegion(null).regionText, '')
})
test('解析不出区划 → 空（由 mask 层兜底为「地址已隐藏」）', () => {
  assert.strictEqual(parseRegion('某某路1号').regionText, '')
})

console.log('\n[县级市]')
test('河南省安阳市林州市 → 安阳市林州市（截图那条数据）', () => {
  const r = parseRegion('河南省安阳市林州市黄华镇王小凹')
  assert.strictEqual(r.city, '安阳市')
  assert.strictEqual(r.district, '林州市')
  assert.strictEqual(r.regionText, '安阳市林州市')
})
test('浙江省金华市义乌市 → 金华市义乌市', () => {
  assert.strictEqual(parseRegion('浙江省金华市义乌市稠城街道').regionText, '金华市义乌市')
})

console.log('\n[脱敏输出]')
test('maskLocation 只保留 regionText，丢弃 name/address/坐标', () => {
  const out = maskLocation({
    name: '菜鸟驿站（科技园店）',
    address: '广东省深圳市南山区科技南十路8号',
    latitude: 22.5431,
    longitude: 114.0579
  })
  assert.deepStrictEqual(out, { masked: true, regionText: '深圳市南山区' })
  assert.strictEqual(out.latitude, undefined)
  assert.strictEqual(out.name, undefined)
  assert.strictEqual(out.address, undefined)
})
test('解析不出区划时兜底为「地址已隐藏」', () => {
  assert.deepStrictEqual(maskLocation({ name: '某处', address: '某某路1号' }), {
    masked: true,
    regionText: '地址已隐藏'
  })
})
test('location 为 null 时返回 null', () => {
  assert.strictEqual(maskLocation(null), null)
})
test('老数据无 region 字段时从 address 现算', () => {
  assert.strictEqual(
    regionTextOf({ address: '广东省深圳市南山区科技南十路8号' }),
    '深圳市南山区'
  )
})
test('已存 region 时优先用缓存值', () => {
  assert.strictEqual(
    regionTextOf({ address: '任意', region: { regionText: '杭州市西湖区' } }),
    '杭州市西湖区'
  )
})

console.log('\n[展示层 format.decorateTask]')
const { decorateTask } = require(path.join(__dirname, '../miniprogram/utils/format'))

test('服务端已脱敏 → 只显示区划', () => {
  const v = decorateTask(
    { title: '取快递', status: 'pending', location: { masked: true, regionText: '深圳市南山区' } },
    { maskAddress: true }
  )
  assert.strictEqual(v.locationText, '深圳市南山区')
})
test('服务端漏脱敏 + 前端 maskAddress → 兜底为「地址已隐藏」', () => {
  const v = decorateTask(
    {
      title: '取快递',
      status: 'pending',
      location: { name: '菜鸟驿站', address: '广东省深圳市南山区科技南十路8号', latitude: 1, longitude: 2 }
    },
    { maskAddress: true }
  )
  assert.strictEqual(v.locationText, '地址已隐藏')
})
test('登录用户 → 显示完整「地点 · 地址」', () => {
  const v = decorateTask({
    title: '取快递',
    status: 'pending',
    location: { name: '菜鸟驿站', address: '广东省深圳市南山区科技南十路8号' }
  })
  assert.strictEqual(v.locationText, '菜鸟驿站 · 广东省深圳市南山区科技南十路8号')
})

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`)

if (failures.length) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.message))
  process.exit(1)
}
