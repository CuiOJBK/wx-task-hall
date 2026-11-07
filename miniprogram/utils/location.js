/**
 * 定位能力封装
 * - chooseLocation：调起微信原生选点（需在小程序后台开通「地理位置」接口权限）
 * - getCurrentLocation：当前坐标（用于「按距离排序」）
 * - distanceMeters / formatDistance：球面距离，前端兜底排序用
 *
 * 说明：骨架阶段用前端 haversine 排序，数据量大后应改为云数据库 geoNear
 * （见 docs/TODO.md 的 P1-2）。
 */

const EARTH_RADIUS = 6371000

function chooseLocation() {
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: (res) =>
        resolve({
          name: res.name || '',
          address: res.address || '',
          latitude: res.latitude,
          longitude: res.longitude
        }),
      fail: (e) => {
        const msg = (e && e.errMsg) || ''
        if (msg.indexOf('cancel') > -1 || msg.indexOf('取消') > -1) {
          const err = new Error('用户取消选点')
          err.code = 'CANCELLED'
          reject(err)
        } else {
          const err = new Error('选点失败，请检查是否已开通位置权限')
          err.code = 'LOCATION_FAIL'
          reject(err)
        }
      }
    })
  })
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
      fail: () => {
        const err = new Error('获取当前位置失败')
        err.code = 'LOCATION_FAIL'
        reject(err)
      }
    })
  })
}

/** 两点球面距离（米） */
function distanceMeters(a, b) {
  if (!a || !b) return null
  const lat1 = Number(a.latitude)
  const lng1 = Number(a.longitude)
  const lat2 = Number(b.latitude)
  const lng2 = Number(b.longitude)
  if ([lat1, lng1, lat2, lng2].some((v) => Number.isNaN(v))) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return Math.round(2 * EARTH_RADIUS * Math.asin(Math.sqrt(s)))
}

function formatDistance(m) {
  if (m === null || m === undefined) return ''
  if (m < 1000) return `${m}m`
  return `${(m / 1000).toFixed(1)}km`
}

module.exports = {
  chooseLocation,
  getCurrentLocation,
  distanceMeters,
  formatDistance
}
