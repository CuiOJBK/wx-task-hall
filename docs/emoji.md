# emoji 表情输入 · 实现说明

> 版本：v0.2.0　实施日期：2026-11-08
> 需求：消息发送支持 emoji，交互参考微信聊天（可展开面板、分类、光标处插入、图文混排）

---

## 一、实现范围

### 覆盖

| 入口 | 位置 | 是否支持 |
|---|---|---|
| 任务详情 - 评论输入 | `pages/task/detail` | ✅ 完整支持 |
| 话题详情 - 回复输入 | `pages/post/detail` | ✅ 完整支持 |

两处共用同一个组件 `components/comment-bar`，逻辑只写一份。表情面板 `components/emoji-panel` 独立，可复用到任何输入场景。

### 不覆盖（明确排除）

| 入口 | 原因 |
|---|---|
| 大厅发帖（`pages/community` 的 `showModal({editable})`） | `showModal` 是系统原生弹窗，无法插入自定义面板。等 P1-4 独立发帖页落地后一并支持 |
| 任务标题/描述 | 非「消息」，且标题有 40 字限制，加表情没收益 |
| 自定义表情 / 表情包 | 需要素材管理与审核，超出本次范围 |

---

## 二、涉及改动模块

### 新增（10 个文件）

| 文件 | 职责 |
|---|---|
| `miniprogram/utils/emoji.js` | 表情数据（7 分类 200 个）+ `charLength` / `insertAt` / `deleteBefore` 纯函数 |
| `miniprogram/components/emoji-panel/index.{js,json,wxml,wxss}` | 表情面板：分类 Tab、网格、退格键。对外抛 `select` / `delete` 事件 |
| `miniprogram/components/comment-bar/index.{js,json,wxml,wxss}` | 底部输入条：输入框 + 表情开关 + 发送；内部管理光标与面板显隐 |
| `scripts/test-emoji.js` | 纯函数单元测试，19 条用例 |

### 修改（8 个文件）

| 文件 | 改动 |
|---|---|
| `pages/task/detail/index.wxml` | 内联输入条 → `<comment-bar>` 组件 |
| `pages/task/detail/index.js` | `onSendComment` 改为从事件 `e.detail.value` 取文本 |
| `pages/task/detail/index.json` | 注册 `comment-bar` |
| `pages/task/detail/index.wxss` | 删除约 50 行输入条样式（已迁到组件） |
| `pages/post/detail/*`（同 4 项） | 同上 |
| `cloudfunctions/comment/index.js` | 长度校验改用 `Array.from` 码点计数；新增控制字符过滤 `sanitize` |
| `cloudfunctions/post/index.js` | 同上（正文 500 字限制） |

### 未改动（兼容性关键）

- **数据库结构零变更**：`comments.content` / `posts.content` 仍是普通 String，emoji 直接存 UTF-8，无新字段、无迁移脚本
- 评论组件 `comment-list` 未改：`<text>` 直接渲染 emoji，无需适配
- 除 `comment` / `post` 外，其余 3 个云函数未动

---

## 三、交互行为

| 操作 | 行为 |
|---|---|
| 点输入框右侧 😀 | 收起键盘，面板从底部滑出，按钮变 ⌨ |
| 点 ⌨ | 收起面板，键盘弹回，光标回到输入框 |
| 点输入框本身 | 自动收起面板（要打字了） |
| 点面板内表情 | 插入到光标位置，面板保持展开，可连续点 |
| 点 ⌫ | 删除光标前一个字符，emoji 整删（不会留半个代理对） |
| 面板切分类 | 底部 Tab 横滑，切换即时刷新网格 |
| 发送 | 文本与 emoji 混排一条发出，成功后清空 |

---

## 四、光标处理原理（改之前必读）

1. 小程序 `input` **没有** selection-change 事件；`bindinput` 的 `e.detail.cursor` 只在「值变化」时才有，点击文本中间不触发。
2. 唯一能读到真实光标的是 **`wx.getSelectedTextRange()`**（返回 `{ start, end }`，基础库 2.7.0+），但它**要求输入框当前处于聚焦态**，失焦即 fail。
3. **致命时序**：点击输入框以外的区域时，系统先让 input 失焦，再派发 `tap`。所以 `onToggleEmoji` 里读光标已经来不及了（这是 v0.2.1 没修好的原因）。
4. 因此光标必须在**失焦之前**抓，共接了 5 个捕获点（touchstart / input 的 tap / focus / 400ms 轮询 / bindinput），任何一个成功都会写回 `data.cursor`。
5. 插入时直接用 `data.cursor`；`-1` 表示从未读到，退化为末尾插入。
6. 不使用 `selection-start` / `selection-end` 回填：各机型对该属性响应不一致，容易出现光标乱跳。
7. 排查开关：`config.features.debugEmoji = true`，Console 会打印每次读取成功/失败与插入位置。

---

## 四.B 问题修复记录

### 问题一（B6）：光标移到文本中间后，表情仍插到末尾

**复现步骤**
1. 打开任务详情，点底部输入框
2. 输入 `hello world`
3. 点一下 `hello` 和 `world` 之间（键盘不收起，看到光标竖线移到中间）
4. 点右侧 😀 打开面板
5. 点任意表情 → 结果插到末尾，不是中间

---

#### 第一次修复（v0.2.1）—— 有效但不够

**判断的根因**：`bindinput` 的 `e.detail.cursor` 只在「内容变化」时触发，第 3 步只移动光标不改内容，事件不触发，`data.cursor` 停在上次输入结束的位置（末尾）。

**当时的修法**：打开面板前用 `wx.getSelectedTextRange()` 读真实选区。

```js
async onToggleEmoji() {
  const pos = await this.captureSelection()   // 以为此时 input 仍聚焦
  this.setData({ showEmoji: true, focus: false, cursor: pos })
}
```

**为什么没修好**：这个修法成立的前提是「点 😀 的那一刻输入框还聚焦」。实际不成立。

---

#### 第二次修复（v0.2.2）—— 补上真正的触发点

**验证「光标消失」猜测的结论：成立，但因果反了。**

不是「点了表情导致光标消失」，而是**手指点在输入框以外的区域时，系统会先让 input 失焦，再派发 tap 事件**。也就是说：

```
touchstart → 【input 失焦，光标销毁】 → touchend → tap → onToggleEmoji 开始执行
```

等 `onToggleEmoji` 跑到 `captureSelection()`，输入框早就不是聚焦态了，`wx.getSelectedTextRange` 直接走 fail，`pos === null`，于是 `cursor` 保持旧值（末尾）→ 插到末尾。

**这解释了全部三个现象**：
- 光标消失：失焦是系统行为，不是我们 `setData({focus:false})` 造成的
- 插到末尾：读取失败后回退到了旧位置
- 「先输入文字再输表情」正常：那条路上 `bindinput` 刚更新过 `cursor`，恰好是对的

**核心结论：光标必须在失焦之前读到，而失焦早于 tap。** 所以只能在**更早的时机**抓：

| 捕获点 | 事件时机 | 说明 |
|---|---|---|
| `bindtouchstart`（😀 按钮） | 失焦之前 | **主路径**。touchstart 早于「点击外部导致的失焦」 |
| `bindtap`（input 内部） | 移动光标后 | 用户点文本中间时补读 |
| `bindfocus`（input） | 获得焦点后 80ms | 首次点进来时补读 |
| 400ms 轮询（仅聚焦期间） | 持续 | 兜底，防原生层提前失焦导致 touchstart 也读不到 |
| `bindinput` | 内容变化时 | 原有路径，保留 |

每次成功读到都写回 `data.cursor`，插入时直接用这个值。

```js
// 主路径：手指按下的瞬间先读
onEmojiTouchStart() {
  if (this.data.showEmoji) return
  this.captureSelection().then((pos) => this.applyCursor(pos))
}

// 兜底轮询：只在聚焦时跑，失焦立即停
startCursorPolling() {
  this.stopCursorPolling()
  this._pollTimer = setInterval(() => {
    if (this.data.showEmoji) return
    this.captureSelection().then((pos) => this.applyCursor(pos))
  }, 400)
}
```

另外两处配套改动：
- `onToggleEmoji` 里显式 `wx.hideKeyboard()`，不再依赖 `focus` 属性的隐式失焦行为
- 新增 `config.features.debugEmoji` 开关，打开后控制台会打印每次读取的结果和失败原因，用于确认走的是哪条路径

**如果还有问题，打开这个开关把日志发出来**，日志会明确显示是「读取成功 pos=N」还是「读取失败（输入框已失焦）」。


### 问题二（B8）：面板点完表情，再点输入框，输入框被键盘遮住

**复现步骤**
1. 打开任务详情，点 😀 展开表情面板
2. 点一个表情（面板保持展开，键盘是收起的）
3. 点文字输入框 → 键盘弹起
4. 期望输入框在键盘上方，实际输入框贴屏幕底，被键盘盖住

**根因**
`.composer` 是 `position: fixed; bottom: 0`，永远贴视口底边。
- 表情面板是**普通文档流**元素，撑高的是页面，输入条位置不变
- 键盘弹起时，`adjust-position`（默认 true）只推**页面内容**，不推 fixed 定位元素
- 结果：输入条仍在屏幕底，而键盘盖住了屏幕下半部分 → 输入框被遮

另外还叠加了一个因素：面板收起 → 键盘弹起，布局高度突变，而代码里没有任何地方监听键盘高度，输入条没有理由移动。

**修改方案**

1. 关闭系统自动上推，自己接管：

```xml
<input adjust-position="{{false}}" bindkeyboardheightchange="onKeyboardHeightChange" />
```

2. 监听键盘高度，按平台差异算底部偏移：

```js
onKeyboardHeightChange(e) {
  const height = (e.detail && e.detail.height) || 0
  const current = wx.getSystemInfoSync().windowHeight || 0
  const offset = computeKeyboardOffset(height, this._initWindowHeight, current)
  if (offset !== this.data.keyboardHeight) this.setData({ keyboardHeight: offset })
}
```

3. 输入条绑定偏移：

```xml
<view class="composer" style="bottom: {{keyboardHeight}}px;">…</view>
```

关键在 `utils/keyboard.js` 的平台判断——**不能无脑 `bottom = 键盘高度`**：

| 平台 | 键盘弹起时视口 | fixed 元素表现 | 需要的偏移 |
|---|---|---|---|
| iOS | 高度不变 | 仍贴屏幕底，被遮挡 | `keyboardHeight` |
| Android | 被压缩 | 随视口一起上移 | `0`（再叠加会飘到键盘上方） |

判断方式：`初始 windowHeight - 当前 windowHeight >= 键盘高度 × 0.5` 即视为视口被压缩（Android resize 模式），偏移取 0；否则取键盘高度。

4. 键盘弹起时去掉 `env(safe-area-inset-bottom)`（安全区已被键盘覆盖，留着会多一条空白），新增 `.kb-open` 类处理。

---

## 五、兼容性处理

| 维度 | 处理 |
|---|---|
| **旧数据** | 无 emoji 的历史评论不受影响；字段类型未变，无需迁移 |
| **字数统计** | `String.length` 把 emoji 算 2，统一改用 `Array.from().length` 按码点算，表情记 1 个字。前端 `maxlength=300`（UTF-16 单位）严格于云端 300 字，不会出现前端放行、云端拒绝 |
| **代理对安全** | 删除时判断高低代理位，一次删完整字符，避免拆出「半个 emoji」导致乱码 |
| **数据库** | 云开发底层是 MongoDB，原生 UTF-8，4 字节字符无压力（若以后迁 MySQL 需确认库表字符集为 `utf8mb4`） |
| **传输** | 云函数调用走 JSON，emoji 无需转义（`JSON.stringify` 正确处理代理对） |
| **渲染** | 原生 Unicode emoji，iOS/Android 均渲染系统彩色表情，无切图、无字体依赖 |
| **包体** | 200 个表情以字符串常量存储，整体 +8.2 KB（52.7 → 60.9 KB），远低于 2 MB 主包上限 |
| **输入框类型** | 保持单行 `input`，未改 textarea，不影响原有的 `confirm-type="send"` 与回车发送 |

---

## 六、验收标准（可逐条验证）

### A. 自动化（已执行，可重跑）

| # | 命令 | 通过标准 | 本次结果 |
|---|---|---|---|
| A1 | `node scripts/test-emoji.js` | 19 条用例全过 | ✅ 19/19，7 分类 200 表情 |
| A2 | `node scripts/check-project.js` | 0 错误 | ✅ 0 错误 0 警告 |
| A3 | 全量 `node --check` | 语法错误 0 | ✅ 0 |
| A4 | `cli preview` 编译 | 编译成功，无 WXML/WXSS 报错 | ✅ 64.9 KB |
| A5 | `node scripts/test-keyboard.js` | 10 条用例全过（含 iOS/Android 两种键盘行为） | ✅ 10/10 |

### B. 功能（模拟器 / 真机各跑一遍）

| # | 操作 | 预期 |
|---|---|---|
| B1 | 任务详情点 😀 | 键盘收起，面板滑出，7 个分类可见 |
| B2 | 点「表情」分类 | 网格切换为 40 个表情，Tab 高亮 |
| B3 | 点一个表情 | 输入框出现该表情，面板不关闭 |
| B4 | 连点 3 个表情 | 顺序追加，无错位、无重叠 |
| B5 | 输入「好的😀收到🎉」后发送 | 发送成功，评论列表完整显示文字+彩色表情 |
| **B6** | **输入 `hello world` → 点文本中间 → 点 😀 → 点表情** | **表情插在光标处（v0.2.2 主回归项）** |
| B7 | 点 ⌫ 连续删除 | emoji 一次整个删掉，不会剩乱码方块 |
| **B8** | **点 😀 展开面板 → 点一个表情 → 点文字输入框** | **键盘弹起后输入框仍在键盘上方，可继续输入（v0.2.1 已修）** |
| B9 | 回复他人评论时点表情 | 回复提示条「回复 xxx」保留，表情正常插入 |
| B10 | 发表含表情的大厅回复 | 话题详情正常显示，`replyCount` 正确 +1 |
| B11 | 纯 200 个表情发送 | 提示「评论最多 300 个字」，不写入数据库 |
| B12 | 断网后发送 | 报错提示，输入内容不丢失 |
| B13 | 键盘弹起后切后台再回来 | 输入条位置正确，不残留偏移 |
| B14 | 表情面板展开状态下切到其他页面再返回 | 面板收起，输入条回到屏幕底 |

### C. 数据层

| # | 操作 | 预期 |
|---|---|---|
| C1 | 云开发控制台查看 `comments` 记录 | `content` 字段原样存储 emoji（显示为彩色表情或 `\uD83D\uDE00` 形式均可） |
| C2 | 老评论（无表情）打开详情 | 正常显示，无异常 |

### D. B6 回归专项（v0.2.2 必跑）

六种操作顺序都要得到「插在光标处」的结果，缺一个都算没修完：

| # | 操作顺序 | 期望结果 |
|---|---|---|
| D1 | 输入文字 → 点文本中间 → 点 😀 → 点表情 | 插在中间 |
| D2 | 输入文字 → 点文本中间 → **立刻**点 😀（不给系统反应时间）→ 点表情 | 插在中间（验证 touchstart 抢到光标） |
| D3 | 输入文字 → 点文本**开头** → 点 😀 → 点表情 | 插在最前面（cursor = 0 边界） |
| D4 | 输入文字 → 点 😀（不改光标）→ 点表情 | 插在末尾（原有行为不能坏） |
| D5 | 输入文字 → 点中间 → 点 😀 → 连点 3 个表情 | 三个表情顺序插在中间，不跳到末尾 |
| D6 | 输入文字 → 点中间 → 点 😀 → 点表情 → 点 ⌨ → 继续打字 | 打字内容接在表情后面，位置连续 |
| D7 | 输入文字 → 点中间 → 点 😀 → 点 ⌫ 两次 | 从光标处往前删，emoji 整删 |

**打开日志对照**：`miniprogram/config/index.js` 里把 `debugEmoji` 改成 `true`，Console 会打印：

```
[comment-bar] 读取光标成功 5
[comment-bar] 插入表情 😀 位置 5 → 7
```

如果打的是「读取光标失败（输入框已失焦）」，说明该机型失焦比 touchstart 还早，把这条日志连机型一起发出来。

### E. 输入状态保持（对应用户诉求）

| # | 操作 | 预期 |
|---|---|---|
| E1 | 点 😀 打开面板 | 输入框里的文字完整保留，一个字都不能少 |
| E2 | 面板开着的状态下点 ⌨ | 键盘弹回，光标回到之前的位置附近，可继续输入 |
| E3 | 插入表情后立即点「发送」 | 发出的内容与输入框显示完全一致 |
| E4 | 面板开着时切到其他页面再返回 | 输入内容不丢 |

---

## 七、回滚方式

改动集中在两个组件 + 两个页面 + 两个云函数：

1. 页面回滚：把 `index.wxml` 里的 `<comment-bar>` 换回内联 `<input>`（组件文件保留不影响，只是不再引用）
2. 云函数回滚：长度校验改回 `content.length`（emoji 会被算 2 字，功能仍可用，只是限制变严）
3. 数据库无需回滚
