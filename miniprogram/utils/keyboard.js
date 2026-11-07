/**
 * 键盘高度 → 输入条底部偏移
 *
 * 背景：`.composer` 是 position:fixed; bottom:0。
 * 键盘弹起时，iOS 与 Android 的表现不一样：
 *   - iOS：视口高度不变，fixed 元素仍贴在屏幕底 → 被键盘遮住，需要把 bottom 上移 keyboardHeight
 *   - Android：WebView 被压缩，fixed 元素已随视口上移 → 再叠加 offset 会「飘」到键盘上方一截
 *
 * 所以不能无脑 +height，要判断视口有没有被压缩。
 *
 * @param {number} keyboardHeight    键盘高度（px），0 表示收起
 * @param {number} initWindowHeight  初始 windowHeight（页面 attached 时记录）
 * @param {number} currentWindowHeight 当前 windowHeight
 * @returns {number} 需要设置的 bottom 偏移（px）
 */
function computeKeyboardOffset(keyboardHeight, initWindowHeight, currentWindowHeight) {
  const h = Number(keyboardHeight) || 0
  if (h <= 0) return 0

  const init = Number(initWindowHeight) || 0
  const current = Number(currentWindowHeight) || 0

  // 视口被压缩超过键盘高度的一半 → 判定为 Android 那种 resize 模式，无需再偏移
  if (init > 0 && current > 0 && init - current >= h * 0.5) return 0

  return h
}

module.exports = { computeKeyboardOffset }
