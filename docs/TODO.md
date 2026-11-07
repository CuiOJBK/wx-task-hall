# 待实现模块清单

骨架已打通：路由、云函数、数据模型、状态机、两级评论、定位落库、权限下发、emoji 表情输入。
下面按优先级列出还没做的部分。P0 是**上线前必须做**，P1 是完整产品功能，P2 是商业化/规模化。

> **已完成**：任务状态机与并发抢单、两级评论、定位选点与距离排序、权限下发、**emoji 表情输入（v0.2.0，见 `docs/emoji.md`）**

---

## P0 — 上线提审前必须补

| # | 模块 | 现状 | 做法 | 参考 |
|---|---|---|---|---|
| P0-1 | 内容安全检测 | 无 | 云函数里写评论/发任务前调 `cloud.openapi.security.msgSecCheck`（文本）、`mediaCheckAsync`（图片）。命中直接返回 `CONTENT_RISK` | aircon-bang 的「全量文本过 msgSecCheck」做法 |
| P0-2 | 隐私协议 + 用户协议 | 无 | 小程序后台配置隐私协议，首启弹窗同意；`app.json` 的 `requiredPrivateInfos` 已声明位置，但后台接口权限要同步申请 | — |
| P0-3 | 昵称头像 | 用户集合有字段，但从未写入 | 用 `button open-type="chooseAvatar"` + `input type="nickname"` 获取，再调 `login.updateProfile`（云函数已实现） | — |
| P0-4 | 联系方式保护 | 列表页已剥离 `contact`，详情页仅双方可见 | 进一步：详情页展示时做中间四位打码，或接虚拟号。当前实现已够过审 | — |
| P0-5 | 列表 `hasMore` 不准 | 用 `rows.length === limit` 判断 | 换成 `collection.count()` 单独查总数，或 `skip+limit` 取 `limit+1` 条判断 | — |
| P0-6 | 举报入口 | 无 | 任务详情/话题详情加「举报」，写 `reports` 集合，管理端处理。审核时评委常查这一项 | — |
| **P0-7** | **权限体系落地** | **✅ G1–G8 全部完成（V4 按昵称判定）** | **剩余：① 头像纳入资料完整判定（依赖 P1-1 图片上传）；② 封禁管理后台；③ 评论点赞** | — |
| **P0-8** | **`initdb` 对客户端开放** | **✅ 已加 `ADMIN_OPENIDS` 白名单** | **部署时记得在云函数环境变量配 `ADMIN_OPENIDS`；顺便清理示例数据** | — |

---

## P1 — 完整产品功能

| # | 模块 | 现状 | 做法 | 参考 |
|---|---|---|---|---|
| P1-1 | 图片上传 | 无 | 云存储 `wx.cloud.uploadFile`，任务配图 / 接单完成凭证；`posts.images` 字段已预留 | — |
| P1-2 | 地理位置检索 | 内存 haversine 排序，只对当前页生效 | 改用 `db.collection('tasks').where({ geo: _.geoNear({ geometry: db.Geo.Point(lng,lat), maxDistance }) })`，并给 `geo` 建 2dsphere 索引。**这是当前最该补的技术短板**：翻页后排序会错乱 | campus_express_delivery_cos 的 `RealTimeLocationController` |
| P1-3 | 评论分页 / 更多回复 | 主楼分页，每条主楼下的回复一次最多取 100 条 | 加「查看更多回复」，按 `parentId` 单独分页 | — |
| P1-4 | 独立发帖页 | 用 `wx.showModal({editable:true})` 凑的，不能发图，**也不支持 emoji 面板** | 新建 `pages/post/create`，复用 `components/comment-bar` 或做多行版本，支持多图、字数统计 | — |
| P1-5 | 订阅消息通知 | 无 | 三个场景：被接单、被提交、被确认。用 `cloud.openapi.subscribeMessage.send`，用户端先 `requestSubscribeMessage` 拿授权 | — |
| P1-6 | 我接的单筛选 | 只有角色切换 | 加状态筛选 Tab，复用 `hall` 的 Tab 组件 | — |
| P1-7 | 任务超时处理 | 无 | 定时触发器（`config.json` 里配 `triggers`），`accepted` 超过 N 小时未提交 → 提醒或自动取消 | — |
| P1-8 | 评论删除入口 | 云函数 `comment.remove` 已实现，页面没接 | 长按自己的评论弹删除；主楼删除时云函数已连带清理回复 | — |
| P1-9 | 分享卡片 | 无 | `onShareAppMessage` + 任务详情页带 `id` 参数，`onShareTimeline` | — |
| P1-10 | 空态与骨架屏 | 只有文字空态 | 列表加载骨架屏，减少白屏感 | — |

---

## P2 — 商业化与规模化

| # | 模块 | 做法 | 参考 |
|---|---|---|---|
| P2-1 | 微信支付 + 资金托管 | 云开发 `cloud.cloudPay.unifiedOrder`；注意**平台代收货款有二清风险**，建议只收「接单服务费」而非抽佣，或接微信支付分账 | aircon-bang 的合规定位（按单收费、不碰交易资金） |
| P2-2 | 信用分体系 | `users.creditScore` 字段已预留（默认 100）。接单完成 +2、超时未完成 -5、被投诉 -10，低于阈值限制接单 | HYF-2005/xiaoyuanyiyuan 的信用分结算 |
| P2-3 | 实名认证 / 保证金 | 接单前需认证，防止放鸽子。保证金用 `users.deposit` + 退款审核流程 | Big-Monster-H/order-self-miniprogram 的保证金机制 |
| P2-4 | 后端迁移 | 数据量或结算复杂度超了云开发，再迁 Spring Boot / NestJS。**建议路径**：先保持云函数接口形状（`{action, data}` → `{code,data,msg}`）不变，前端 `services/*.js` 只改 `cloud.js` 一处即可切换 | fuu-run（Spring Boot）、order-self-miniprogram（NestJS） |
| P2-5 | 管理后台 | 云开发 CMS 快速搭，或自建 Vue 后台。核心：任务审核、举报处理、用户封禁、财务对账 | campus_express_delivery_cos 的 admin 端 |
| P2-6 | 客服与申诉工单 | 任务纠纷（说做了甲方不认）必须有仲裁入口，否则做不大 | fuu-run 的 order appeal 页面 |

---

## 技术债（不影响跑，但会拖慢后续）

| # | 问题 | 建议 |
|---|---|---|
| D-1 | 集合名、状态枚举在前端 `utils/constants.js` 和 5 个云函数里各写一份 | 抽一个 `shared/` 目录，用构建脚本同步进各云函数（云函数无法直接 require 上级目录） |
| D-2 | 云函数的 `addWithColl` / `safeGet` / `bizError` 是复制粘贴的 | 同上，或发布成私有 npm 包 |
| D-3 | 零单元测试 | 把 `transition` 的状态机判断、`haversine`、评论层级校验抽成纯函数放 `lib/`，用 jest 覆盖 |
| D-4 | 错误只 `console.error` | 接云开发日志告警或自建上报，至少把 `code !== 0` 的调用打点 |
| D-5 | 页面无 loading 骨架，弱网体验差 | 抽 `loading` / `error` 通用组件 |
| D-6 | ~~emoji 插入位置以「最后一次输入的光标」为准~~ | **已修（v0.2.1）**：改用 `wx.getSelectedTextRange()` 在输入框失焦前读真实选区，点文本中间再插表情也能精确落位 |
| D-7 | `comment-bar` 只支持单行 `input` | 多行输入（长评论）需要换 `textarea`，但 textarea 的 `cursor` 属性在部分安卓机不生效，需真机分机型验证后再切 |
| D-8 | 键盘偏移依赖 `windowHeight` 变化做平台判断 | 少数深度定制 ROM 可能两者都不符合，极端情况下输入条会有一次偏移误差。已加兜底（拿不到视口高度就按键盘高度上移），若线上出现再按机型做白名单 |

---

## 建议的实现顺序

1. **P0-1 + P0-2 + P0-3** — 这三项不做，提审大概率被驳回
2. **P1-2** — 定位排序是产品核心卖点，内存排序撑不住第二页
3. **P1-1 + P1-5** — 图片和通知决定留存
4. **P0-6 + P1-8** — 举报和删除入口，合规需要
5. 其余按运营反馈排
