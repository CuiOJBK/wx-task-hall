/**
 * 轻量 UI 入口：统一错误提示
 * 授权类错误（UNAUTHORIZED / PROFILE_INCOMPLETE / ACCOUNT_BANNED）已由 app 层的
 * handleAuthError 统一处理并标记 err.silent，页面不要再弹一遍。
 */
function showError(err, fallback) {
  if (err && err.silent) return
  wx.showToast({
    title: (err && err.message) || fallback || '操作失败',
    icon: 'none'
  })
}

module.exports = { showError }
