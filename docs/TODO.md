# 待实现模块清单

骨架已打通：路由、云函数、数据模型、状态机、两级评论、定位落库、权限下发、emoji 表情输入。
下面按优先级列出还没做的部分。P0 是**上线前必须做**，P1 是完整产品功能，P2 是商业化/规模化。

> **已完成**：任务状态机与并发抢单、两级评论、定位选点、**身份权限体系（G1–G8，见 `docs/auth-rules.md`）**、emoji 表情输入（`docs/emoji.md`）、地址分级脱敏、昵称约束（`docs/nickname.md`）、话题点赞、`initdb` 白名单
>
> 单测现状：`scripts/` 下 4 组共 76 条（emoji 19 / 键盘 10 / 地址 21 / 昵称 26），均可在 node 下直接跑

---

## P0 — 上线提审前必须补

| # | 模块 | 现状 | 做法 | 参考 |
|---|---|---|---|---|
| P0-1 | 内容安全检测 | **✅ 已接**：任务标题+描述、评论、话题、昵称全部过 `msgSecCheck`（v2，scene 1/2/3），命中返回 `CONTENT_RISK` | 图片检测（`mediaCheckAsync`）待 P1-1 图片上传落地后再补 |
| P0-2 | 隐私协议 + 用户协议 | **✅ 代码侧完成**：`pages/agreement` 双 Tab 协议页 + `components/privacy-popup` 首启授权弹窗（`agreePrivacyAuthorization`） | **仍需在小程序后台配置《用户隐私保护指引》并申请位置接口**，否则弹窗不会出现 |
| P0-3 | 昵称头像 | **✅ 已完成**：头像用 `open-type="chooseAvatar"` → 云存储 → fileID；昵称改用 `input type="nickname"` | 云存储需设为「所有用户可读」，否则头像在别人页面加载不出 |
| P0-4 | 联系方式保护 | 列表页已剥离 `contact`，详情页仅双方可见 | 进一步：详情页展示时做中间四位打码，或接虚拟号。当前实现已够过审 | — |
| P0-5 | 列表 `hasMore` 不准 | **✅ 已修**：4 处改为「多取一条」（`limit+1`），`hasMore = rows.length > limit` 后裁剪 | task.list / task.mine / comment.list / post.list 全覆盖 |
| P0-6 | 举报入口 | **✅ 已完成**：任务/话题/评论三类目标都能举报，`report` 云函数去重 + 禁举报自己，`report-sheet` 弹层选理由 | 管理端 `report.list` 已备（仅 `ADMIN_OPENIDS`），后台 UI 待 P2-5 |
| **P0-7** | **权限体系落地** | **✅ G1–G8 全部完成（V4 按昵称判定）** | **剩余：① 头像纳入资料完整判定（依赖 P1-1 图片上传）；② 封禁管理后台；③ 评论点赞** | — |
| **P0-8** | **`initdb` 对客户端开放** | **✅ 已加 `ADMIN_OPENIDS` 白名单** | **部署时记得在云函数环境变量配 `ADMIN_OPENIDS`；顺便清理示例数据** | — |

---

## P1 — 完整产品功能

| # | 模块 | 现状 | 做法 | 参考 |
|---|---|---|---|---|
| P1-1 | 图片上传 | 无 | 云存储 `wx.cloud.uploadFile`，任务配图 / 接单完成凭证；`posts.images` 字段已预留 | — |
| P1-2 | 地理位置检索 | **✅ 已完成**：`listTasks` 优先走 `aggregate().geoNear()`（全局按距离排序 + 支持 skip/limit），索引缺失时自动降级内存排序并打日志；返回 `geoMode` 标记 | 待办：给 `tasks.geo` 建 2dsphere 索引即可启用（见 `docs/release-checklist.md`） |
| P1-3 | 评论分页 / 更多回复 | 主楼分页，每条主楼下的回复一次最多取 100 条 | 加「查看更多回复」，按 `parentId` 单独分页 | — |
| P1-4 | 独立发帖页 | 用 `wx.showModal({editable:true})` 凑的，不能发图，**也不支持 emoji 面板** | 新建 `pages/post/create`，复用 `components/comment-bar` 或做多行版本，支持多图、字数统计 | — |
| P1-5 | 订阅消息通知 | 无 | 三个场景：被接单、被提交、被确认。用 `cloud.openapi.subscribeMessage.send`，用户端先 `requestSubscribeMessage` 拿授权 | — |
| P1-6 | 我接的单筛选 | 只有角色切换 | 加状态筛选 Tab，复用 `hall` 的 Tab 组件 | — |
| P1-7 | 任务超时处理 | 无 | 定时触发器（`config.json` 里配 `triggers`），`accepted` 超过 N 小时未提交 → 提醒或自动取消 | — |
| P1-8 | 评论删除入口 | **✅ 已接**：主楼显示「删除」文字、长按任意自己的评论弹 ActionSheet | 顺带修了删主楼时计数只减 1 的 bug，现按「1+回复数」扣减 | — |
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
| P2-5 | 管理后台 | **✅ 已完成**：小程序内 7 个模块（概览/用户/举报/内容/角色/日志/设置），含举报处置闭环；设置项已接入发布校验 | 待补：PC 端（如需） |
| P2-6 | 客服与申诉工单 | 任务纠纷（说做了甲方不认）必须有仲裁入口，否则做不大 | fuu-run 的 order appeal 页面 |

---

## 技术债（不影响跑，但会拖慢后续）

| # | 问题 | 建议 |
|---|---|---|
| D-1 | 集合名、状态枚举在前端 `utils/constants.js` 和 5 个云函数里各写一份 | 抽一个 `shared/` 目录，用构建脚本同步进各云函数（云函数无法直接 require 上级目录） |
| D-2 | 云函数的 `addWithColl` / `safeGet` / `bizError` 是复制粘贴的 | 同上，或发布成私有 npm 包 |
| D-3 | 纯逻辑单测已有 76 条（emoji/键盘/地址/昵称），但**核心业务无覆盖**：`transition` 状态机、`haversine`、评论层级校验都没测 | 把这几个抽成纯函数模块，补测试；状态机是最该测的（错了会写脏数据） |
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
4. ~~P0-6 + P1-8~~ — ✅ 都已完成
5. 其余按运营反馈排
