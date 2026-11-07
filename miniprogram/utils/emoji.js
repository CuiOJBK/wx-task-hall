/**
 * Emoji 数据与文本编辑工具
 *
 * 设计决定：使用 Unicode 原生 emoji，不引入图片资源。
 * 原因：1) 无需打包 200+ 张 png，包体几乎零增长
 *      2) iOS/Android 渲染为系统彩色表情，不存在切图与真机不一致
 *      3) 直接以字符串存入云数据库（MongoDB 原生 UTF-8 支持），无需 id 映射
 *
 * 注意：emoji 是 4 字节字符，JS 里 length 算 2（代理对）。
 * 长度校验一律用 Array.from(str).length 计算「人眼看到的字数」。
 */

const CATEGORIES = [
  {
    key: 'common',
    name: '常用',
    list: [
      '😀', '😁', '😂', '🤣', '😊', '😍', '🤔', '😅',
      '😭', '😡', '😱', '🙄', '😴', '😎', '🥺', '😇',
      '👍', '👌', '🙏', '💪', '❤️', '🎉', '🔥', '✨',
      '💯', '🤝', '🤗', '😳'
    ]
  },
  {
    key: 'face',
    name: '表情',
    list: [
      '😃', '😄', '😆', '🙂', '🙃', '😉', '🥰', '🤩',
      '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
      '😝', '🤭', '🤫', '🤐', '🤨', '😐', '😑', '😶',
      '😏', '😒', '😬', '😔', '😪', '😷', '🤒', '🤕',
      '🥳', '😕', '😟', '😮', '😯', '😲', '😤', '😢'
    ]
  },
  {
    key: 'gesture',
    name: '手势',
    list: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️',
      '🖖', '👋', '🤝', '🙏', '💪', '👏', '🙌', '🤲',
      '👊', '✊', '🤛', '🤜'
    ]
  },
  {
    key: 'animal',
    name: '动物',
    list: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
      '🐧', '🐦', '🐤', '🦄', '🐝', '🦋', '🐢', '🐬',
      '🐳', '🦈', '🌵', '🌲'
    ]
  },
  {
    key: 'food',
    name: '食物',
    list: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓',
      '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑',
      '🥦', '🍞', '🧀', '🍗', '🍔', '🍟', '🍕', '🌭',
      '🍜', '🍚', '🍣', '🍰'
    ]
  },
  {
    key: 'activity',
    name: '活动',
    list: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓',
      '🏸', '🥊', '🎯', '🎮', '🎲', '🎸', '🎤', '🎧',
      '🎬', '🎨', '🎁', '🎈', '🏆', '🥇', '🎪', '🎫'
    ]
  },
  {
    key: 'symbol',
    name: '符号',
    list: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘',
      '⭐', '🌟', '💫', '💥', '💯', '✅', '❌', '⭕'
    ]
  }
]

/** 人眼字数：emoji 记 1 个 */
function charLength(text) {
  if (!text) return 0
  return Array.from(String(text)).length
}

/**
 * 在指定光标位置插入文本
 * @returns {{value: string, cursor: number}} cursor 为插入后的新光标位置
 */
function insertAt(text, insert, cursor) {
  const src = text || ''
  const pos = normalizeCursor(cursor, src.length)
  const next = src.slice(0, pos) + insert + src.slice(pos)
  return { value: next, cursor: pos + insert.length }
}

/**
 * 删除光标前一个字符（emoji 整个删掉，不会删成半个代理对）
 */
function deleteBefore(text, cursor) {
  const src = text || ''
  const pos = normalizeCursor(cursor, src.length)
  if (pos <= 0) return { value: src, cursor: 0 }

  // 代理对判断：低位代理前面如果跟着高位代理，说明是一个 4 字节字符，一次删 2 个单元
  const prev = src.charCodeAt(pos - 1)
  const beforePrev = pos >= 2 ? src.charCodeAt(pos - 2) : -1
  const isLowSurrogate = prev >= 0xdc00 && prev <= 0xdfff
  const isHighSurrogate = beforePrev >= 0xd800 && beforePrev <= 0xdbff
  const step = isLowSurrogate && isHighSurrogate ? 2 : 1

  return {
    value: src.slice(0, pos - step) + src.slice(pos),
    cursor: pos - step
  }
}

function normalizeCursor(cursor, max) {
  if (typeof cursor !== 'number' || Number.isNaN(cursor) || cursor < 0) return max
  return Math.min(cursor, max)
}

module.exports = {
  CATEGORIES,
  charLength,
  insertAt,
  deleteBefore
}
