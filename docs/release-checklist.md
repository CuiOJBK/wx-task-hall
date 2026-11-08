# 提审前后台配置清单

> 代码侧已完成 P0-1 / P0-2 / P0-3，但下面这些配置只能在**微信公众平台后台**和**云开发控制台**做。
> 少配任何一项，对应功能等于没做。

---

## 一、小程序后台（mp.weixin.qq.com）

| # | 配置项 | 位置 | 缺了会怎样 |
|---|---|---|---|
| 1 | **用户隐私保护指引** | 设置 → 服务内容声明 → 用户隐私保护指引 | `wx.getPrivacySetting` 返回 `needAuthorization: false`，隐私弹窗**永远不出现**，提审会因「未声明隐私政策」被拒 |
| 2 | 声明收集的信息 | 同上表单 | 必须勾选：**微信昵称、头像**（chooseAvatar / nickname），**位置信息**（getLocation / chooseLocation）。说明用途写「发布任务时标记地点、按距离排序」 |
| 3 | **位置接口权限** | 开发 → 开发管理 → 接口设置 | `wx.getLocation` / `wx.chooseLocation` 会被直接拒绝调用（errMsg: `getLocation:fail the api need to be declared in the requiredPrivateInfos`） |
| 4 | 服务类目 | 设置 → 基本设置 → 服务类目 | 类目与功能不符会被驳回。建议「生活服务 / 跑腿代取」或「工具 / 效率」 |
| 5 | 隐私政策里的主体信息 | — | `pages/agreement` 里两处 `【请填写】`（运营主体、联系邮箱）必须替换成真实信息 |

**顺序建议**：先配隐私指引 → 再申请位置接口（要审核，1–3 天）→ 然后才提交代码审核。

---

## 二、云开发控制台

| # | 配置项 | 位置 | 缺了会怎样 |
|---|---|---|---|
| 1 | **云存储权限** | 存储 → 权限设置 | 头像用 `open-type="chooseAvatar"` 上传后，别人页面加载不出来（默认只有创建者可读）。改成「**所有用户可读，仅创建者可写**」 |
| 2 | **`initdb` 环境变量** | 云函数 → initdb → 配置 → 环境变量 | 加 `ADMIN_OPENIDS=你的openid`，否则客户端调不进来（控制台仍可调） |
| 2c | **`taskcron` 定时触发器** | 云函数 → taskcron → 触发器，应看到 `taskTimeoutScan`（每小时整点） | CLI 部署会带上 config.json，但个别版本不自动建触发器，部署后务必到控制台确认；手动补建时类型选 timer、cron 填 `0 0 * * * * *` |
| 2b | **消息推送（图片审核）** | 开发管理 → 消息推送 → 启用，数据格式 JSON，事件勾选「图片审核」，推送方式选云函数并指向 `mediacheck` | 不配也能发图，但违规图不会被自动删除；配了之后 `mediacheck` 才收得到 `wxa_media_check` 回调 |
| 3 | **`users.nicknameKey` 唯一索引** | 数据库 → users → 索引管理 | 昵称唯一性只剩代码层查重，并发下会重名。**建索引前先跑 `login.migrateNicknameKey`** |
| 4 | 其余索引 | 数据库 → 索引管理 | 见 README 步骤 6：`tasks` 三个复合索引、`comments.idx_target`、`posts.idx_created` |
| 4b | **`tasks.geo` 2dsphere 索引** | CloudBase 控制台 → 数据库 → 索引管理 → 新建（字段 `geo`，类型「地理位置」） | 不建也能用，但距离排序会降级为「仅当前页有效」，翻页后顺序错乱。建完本功能自动启用 |
| 5 | 集合权限 | 数据库 → 每个集合 → 权限设置 | 四个集合统一「所有用户可读，仅创建者可写」，写操作走云函数不受影响 |
| 6 | **`reports` 集合权限** | 数据库 → reports → 权限设置 | 设为「**仅管理端可读写**」（不要开放客户端读），举报内容属内部处理数据 |

---

## 三、内容安全（P0-1）相关

| 项 | 说明 |
|---|---|
| 是否需要开通 | **不需要**。`cloud.openapi.security.msgSecCheck` 属于云调用，云函数默认可用 |
| 每日额度 | 免费额度足够早期使用；超限会返回错误码，代码里是**放行并记日志**，不会阻断用户 |
| 命中表现 | 返回 `CONTENT_RISK`，前端 toast「内容包含敏感信息，请修改后重试」 |
| 未覆盖 | **图片检测**（`mediaCheckAsync`）尚未接，等 P1-1 图片上传做完再补 |
| 自测方法 | 发一条明显违规的文本（如涉政敏感词），应被拒；正常文本应通过 |

---

## 四、发布前自检命令

```bash
node scripts/check-project.js     # 静态自检，应 0 错误 0 警告
node scripts/test-nickname.js     # 26 条
node scripts/test-region.js       # 21 条
node scripts/test-emoji.js        # 19 条
node scripts/test-keyboard.js     # 10 条
```

AppID 与环境 ID 在仓库里是占位符，**导入开发者工具后必须先填**：
- `project.config.json` → `appid`
- `miniprogram/config/index.js` → `envId`（留空则用默认环境）

---

## 五、已知的提审风险点

| 风险 | 说明 |
|---|---|
| 强制登录 | 目前匿名只能看大厅 10 条摘要，其余全要登录。审核可能要求「核心功能可体验」，建议在提审说明里写清「任务详情需登录以保护发布者联系方式」 |
| 联系方式展示 | 目前仅任务双方可见，合规。若后续放开，需加打码或虚拟号 |
| ~~无举报入口~~ | ✅ 已补（任务/话题/评论三类）。审核如追问处理流程，回答「进 `reports` 集合，管理员在后台『举报处理』页查看后处置，可标记已处理或直接删除违规内容」 |
