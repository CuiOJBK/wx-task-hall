/**
 * 图片上传工具
 * 统一走云存储，返回 fileID 数组；与云函数 task 的 MAX_IMAGES=3 保持一致
 */
const MAX_IMAGES = 3

/** 从相册/相机选图，返回临时路径数组 */
function chooseImages(count) {
  const rest = Math.max(0, MAX_IMAGES - (count || 0))
  if (!rest) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: rest,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        resolve(paths)
      },
      fail: (err) => {
        // 用户取消不算错误
        if (err && /cancel/i.test(err.errMsg || '')) resolve([])
        else reject(new Error((err && err.errMsg) || '选择图片失败'))
      }
    })
  })
}

/** 批量上传，返回 fileID 数组 */
function uploadImages(tempPaths, dir) {
  const list = (tempPaths || []).slice(0, MAX_IMAGES)
  if (!list.length) return Promise.resolve([])

  const tasks = list.map((p, i) => {
    return new Promise((resolve, reject) => {
      const ext = (String(p).match(/\.\w+$/) || ['.jpg'])[0]
      const prefix = dir || 'images'
      const cloudPath = `${prefix}/${Date.now()}_${i}${ext}`
      wx.cloud.uploadFile({
        cloudPath,
        filePath: p,
        success: (res) => {
          if (res && res.fileID) resolve(res.fileID)
          else reject(new Error('上传失败，请重试'))
        },
        fail: (err) => reject(new Error((err && err.errMsg) || '上传失败'))
      })
    })
  })

  return Promise.all(tasks)
}

module.exports = { MAX_IMAGES, chooseImages, uploadImages }
