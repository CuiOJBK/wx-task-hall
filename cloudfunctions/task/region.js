/**
 * 地址区划解析 & 脱敏（纯函数，不依赖 wx-server-sdk，便于单测）
 *
 * 背景：wx.chooseLocation 只返回 { name, address, latitude, longitude }，
 *      没有省市区字段。好在 address 是微信逆地理编码过的完整地址，
 *      形如「广东省深圳市南山区科技南十路8号」，可直接解析出区划。
 *
 * 脱敏规则（匿名可见）：
 *   - 保留：城市 + 区县（如「深圳市南山区」）
 *   - 丢弃：详细街道、门牌号、地点名、经纬度
 *   - 解析不出区划时：返回「地址已隐藏」
 */

/**
 * 从完整地址串解析行政区划
 * @param {string} address 例如「广东省深圳市南山区科技南十路8号」
 * @returns {{province:string, city:string, district:string, regionText:string}}
 */
function parseRegion(address) {
  const text = String(address || '').trim()
  const empty = { province: '', city: '', district: '', regionText: '' }
  if (!text) return empty

  let rest = text
  let province = ''
  let city = ''
  let district = ''

  // 省 / 自治区 / 特别行政区
  const p = rest.match(/^(.{2,12}?(?:省|自治区|特别行政区))/)
  if (p) {
    province = p[1]
    rest = rest.slice(province.length)
  }

  // 市 / 自治州 / 地区 / 盟
  const c = rest.match(/^(.{1,14}?(?:市|自治州|地区|盟))/)
  if (c) {
    city = c[1]
    rest = rest.slice(city.length)
  }

  // 区 / 县 / 旗 / 县级市（如「林州市」）
  const d = rest.match(/^(.{1,14}?(?:区|县|旗|市))/)
  if (d) {
    district = d[1]
  }

  const regionText = [city || province, district].filter(Boolean).join('')

  return { province, city, district, regionText }
}

/**
 * 取某个 location 的区划文本。优先用已存的 region，缺失则从 address 现算，
 * 兼容改造前入库的老数据（没有 region 字段）。
 * @param {object} location { name, address, region? }
 */
function regionTextOf(location) {
  if (!location) return ''
  if (location.region && location.region.regionText) return location.region.regionText
  return parseRegion(location.address).regionText
}

/**
 * 生成匿名可用的地址对象：只保留区划文本，其余全部丢弃
 * @returns {{masked:true, regionText:string}} 或 null
 */
function maskLocation(location) {
  if (!location) return null
  const text = regionTextOf(location)
  return {
    masked: true,
    regionText: text || '地址已隐藏'
  }
}

module.exports = { parseRegion, regionTextOf, maskLocation }
