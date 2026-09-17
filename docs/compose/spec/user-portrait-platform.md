---
feature: user-portrait-platform
status: delivered
updated: 2026-09-17
branch: feat/user-portrait
commits: c9914e11c0bf398b9b4ee41e3308d710d0cbe3a0..8197369
---

# 织女 · 客户画像平台

## Report

**What was built** — 本地 monorepo「织女」：Fastify + Neo4j + React。工作记录按不可变时间线追加（修正 SUPERSEDES / 作废 / 回退历史内容）；LLM 手动重算只**新增**七维洞察与系统/联系人实体；洞察支持人工创建、合并、撤销合并、作废、置顶；实体备注卡走 NoteVersion 链可编辑与回退。小团队鉴权：环境变量 seed admin + 邀请码注册 + cookie session。前端含登录、客户列表、七维画像页、时间线、邀请码。

**Verification** — `npm run typecheck` PASS；`npm test`（需本机 Neo4j）8/8 PASS；`npm run build` PASS；冒烟 curl health/bootstrap/login/create customer PASS。审查发现的 4 个 CRITICAL（邀请码误耗、跨客户回退、缺撤销合并 UI、备注版本历史 UI）已修复并由 general-2 复审确认 FIXED。

**Journey log**
- 首轮 Grill 曾误把产品焦点放在「系统/事项清单」；用户纠正后改为洞察流 + 七维画像，Neo4j 仅服务关系浏览。
- Neo4j `executeWrite` 正常 return 即提交：业务冲突 early-return 仍会 commit 前半段变更（邀请码 used=true 陷阱）。
- 多 `OPTIONAL MATCH` + LIMIT 会笛卡尔积；图邻居改为 `CALL` 子查询分别 collect。
- `needsRecompute` 不能写死 `eventCount>0`，需与 `Portrait.lastEventCount` 对比。
- LLM stub 注入测服务层足够；HTTP 502/原子性尚未做端到端失败用例（已知缺口）。
- 暖米色纸感是 AI UI 默认簇之一，内部工具更宜冷灰底 + 单一靛青强调；品牌用星点/织线做轻签名即可。

## [S1] Problem

服务团队在日常支持中积累了大量工作记录，但这些原料没有沉淀成**立体的客户画像**：客户是谁、业务目标、沟通与决策风格、风险情绪、系统环境等。系统/事项只是画像的从属证据，不是产品核心。需要平台把工作记录交给 LLM 持续提炼洞察，人工可合并/过时洞察并写实体备注；历史不可静默改写。

## [S2] Design

### 决策摘要

| 轴 | 决策 |
|---|---|
| 产品名 | 织女 |
| 图数据库 | Neo4j 5（docker-compose） |
| 后端 | Fastify 5 + TypeScript，`apps/api` |
| 前端 | React 19 + Vite 6，`apps/web` |
| 仓库 | npm workspaces monorepo + `packages/shared` |
| LLM | OpenAI 兼容 API |
| 使用者 | 小团队；画像对象=客户 |
| 鉴权 | 邀请码 + cookie session；`admin`/`member` |
| 输入 | 工作记录时间线：不可变追加；修正=新事件 + SUPERSEDES |
| 画像核心 | **洞察流（只增不改）** + 人工合并/作废 + **实体自由备注卡** |
| 画像页 | 七维分区，每区有效洞察 + 关联实体 + 备注 |
| 版本回退 | 工作记录 / 洞察 / 备注卡均可回退（见下） |

### 架构

```
Browser ──session──► Fastify ──► Neo4j
                        │
                        └──► LLM（从有效时间线提炼洞察 + 实体建议）
```

### Neo4j 图模型

**身份**

- `User { id, email, passwordHash, name, role, createdAt }`
- `Invite { code, role, used }`

**客户与实体（画像从属）**

- `Customer { id, name, company?, createdAt, createdBy }`
- `System { id, name }` 业务系统
- `Contact { id, name, title? }` 对接人/决策链
- `OrgUnit { id, name }` 公司/部门（可选，与 Customer.company 或独立）

**输入时间线**

- `Event { id, title, content, occurredAt, tags[], status, createdAt, createdBy }`
  - `status`: `active` | `superseded` | `voided`
  - 正文创建后不修改
- `(Event)-[:ABOUT]->(Customer)`
- `(Event)-[:MENTIONS]->(System|Contact)` 可选
- `(new:Event)-[:SUPERSEDES]->(old:Event)`

**洞察流（画像正文的最小单位）**

- `Insight { id, dimension, title, body, source, status, pinned, createdAt, createdBy, llmRunId? }`
  - `dimension`（七维）:
    1. `profile` 基础与组织关系
    2. `business` 业务背景与目标
    3. `systems` 系统与技术环境
    4. `service` 工作模式与服务历史
    5. `communication` 沟通与性格偏好
    6. `risk` 风险与情绪信号
    7. `notes` 开放备忘（通常来自人工）
  - `source`: `llm` | `human`
  - `status`: `active` | `merged` | `retired`
- `(Insight)-[:ABOUT]->(Customer)`
- `(Insight)-[:SUPPORTED_BY]->(Event)` 证据边（可多条）
- `(Insight)-[:MENTIONS]->(System|Contact)` 可选
- 合并：`CREATE (new)-[:MERGES]->(old)`，并将 old 的 status 置为 `merged`

**实体备注卡（档案，不进洞察流；支持版本）**

- `Note { id, currentVersion, kind, createdAt, createdBy }`
- `NoteVersion { version, title, body, occurAt?, createdAt, createdBy }`
- `(Note)-[:HAS_VERSION]->(NoteVersion)`；`(Note)-[:ON]->(Customer|System|Contact)`
- 编辑 = 追加新 NoteVersion 并推进 `currentVersion`；回退 = 将 currentVersion 指回历史版本号（历史节点保留）
- 例：b 系统将发版 → `Note(kind=release)` ON System

**约束**：`User.email`、`*.id`、`Invite.code` 唯一。

### 画像版本快照（git 式客户时间线，2026-09-17）

与「工作记录时间线」并行：**每个客户**有独立的 **PortraitVersion 版本链**（Neo4j `PortraitVersion` 节点 + `Portrait-[:HEAD]->`）。

```text
v1 init → v2 insight/note → v3 llm → v4 edit → v5 restore
         ↑ 点开查看快照 + 与 HEAD diff；可「恢复到此版」（追加新版本，历史保留）
```

**节点** `PortraitVersion { id, customerId, number, message, reason, parentNumber, snapshot, createdAt, createdBy }`

- `reason`: `init` | `llm` | `insight` | `note` | `event` | `restore`
- `snapshot`: 完整七维洞察 + 系统/联系人/备注/有效记录数 的 JSON

**打版本时机**：客户创建（init）、洞察/备注/工作记录变更后 best-effort、LLM 重算、恢复版本。

**API**

| Method | Path | 说明 |
|---|---|---|
| GET | /api/customers/:id/versions | 版本列表（含 isHead） |
| GET | /api/customers/:id/versions/:number | 快照全文 |
| GET | /api/customers/:id/versions/:number/diff?with=head\|parent\|N | 与指定版本 diff |
| POST | /api/customers/:id/versions/:number/restore | 应用快照到实时图 + 追加 restore 版本 |

**前端**：画像右栏「版本时间线」；点开查看历史内容与与 HEAD 的 diff；「恢复到此版」。

### 设置页（LLM 运行时配置，2026-09-17）

管理员可在侧栏「设置」配置 OpenAI 兼容 LLM，无需改 `.env` 重启：

- 字段：`llmBaseUrl`、`llmModel`、`temperature`、`llmApiKey`（GET 返回掩码，不回传明文）
- 存储：Neo4j `AppSettings { id: 'singleton' }`，优先于环境变量 `LLM_*`
- API：`GET/PUT /api/settings`（写仅 admin）、`POST /api/settings/test-llm`（连通性探测）
- 画像重算 `recomputeWithLlm` 读取运行时配置；无 Key 时 502 并提示到设置页

### 版本与回退语义（三对象统一原则）

历史永不删除；「回退」只是把系统认定的当前有效版本指向旧内容，或再追加一条内容等于旧版的新版本。

| 对象 | 版本如何形成 | 回退操作 |
|---|---|---|
| 工作记录 Event | 修正追加新 Event 并 SUPERSEDES 旧 Event | `POST /api/events/:id/rollback`：取目标历史事件内容，**追加**一条新 active Event（内容=历史版），SUPERSEDES 当前版；链上仍可回溯 |
| 洞察 Insight | 本体只增；状态可变（active/merged/retired） | 合并可撤销：`POST /api/insights/:id/unmerge` → 恢复被合并旧条为 active，合并结果 retired；置顶可再取消；不改写 body |
| 备注 Note | 每次编辑追加 NoteVersion | `POST /api/notes/:id/rollback`：currentVersion 指回指定 version |

API 补充：

| Method | Path | 说明 |
|---|---|---|
| POST | /api/events/:id/rollback | 回退到某历史事件内容（body: `{ versionEventId }`） |
| POST | /api/insights/:id/unmerge | 撤销合并，恢复源洞察 |
| GET | /api/notes/:id/versions | 备注版本列表 |
| POST | /api/notes/:id/rollback | 回退备注到指定版本 |

### 时间线语义

1. 追加 `Event(active)`
2. 修正：新 Event + `SUPERSEDES` + 旧事件 `status=superseded`
3. 作废：`status=voided`
4. 回退：见「版本与回退语义」——追加内容等于目标历史版的新 active 事件
5. 洞察与 LLM 只消费 `status=active` 事件
6. 时间线 UI 可展开 supersede 链与「回退到此版」

### LLM 重算（洞察只增）

触发：`POST /api/customers/:id/recompute`（手动；创建/修正记录后 API 返回 `needsRecompute: true` 提示）。

输入：客户全部 active 事件 + 现有 active 洞察摘要 + 实体列表 + 现有备注摘要。

输出（JSON）：

```json
{
  "insights": [
    {
      "dimension": "communication",
      "title": "偏好微信短消息确认",
      "body": "…",
      "eventIds": ["…"],
      "mentionSystems": ["CRM"],
      "mentionContacts": []
    }
  ],
  "systems": [{ "name": "CRM", "note": "主用" }],
  "contacts": [{ "name": "张总", "title": "信息部" }]
}
```

合并规则（**代码执行，不改旧 Insight 正文**）：

1. 对每条建议洞察：`CREATE Insight(status=active, source=llm)`，连 `SUPPORTED_BY` / `MENTIONS`
2. Upsert `System`/`Contact` 并为 Customer 建关系（`HAS_SYSTEM`/`HAS_CONTACT`）
3. **不**自动 merge/retire 旧洞察（避免误杀人工结论）；重复由人工合并
4. 失败：502，不写半截数据（同一 session 事务）

### 人工对洞察的操作

| 操作 | 行为 |
|---|---|
| 人工新建洞察 | `source=human`，可选 dimension，可链证据 |
| 合并 | 提供一条新洞察（可人工写或基于选中条目预填），旧条目 `MERGES` 边 + `status=merged` |
| 作废 | `status=retired`（无后继） |
| 置顶 | `pinned=true`，画像页该维度置顶区展示 |

画像页默认展示：`status=active` 的洞察 + `pinned`；折叠区可看 merged/retired 历史。

### 七维画像页布局

顶部：客户名、公司、置顶洞察。

分区（每区）：

- 有效洞察列表（标题、摘要、证据数、置顶/合并/作废按钮）
- 关联实体 chips（系统/联系人），点开看备注卡
- 该维度下挂的 Note
- 「写一条」人工洞察

`notes` 分区：以 Note 与 human Insight 为主。

### 鉴权

- bootstrap 首位 admin（env）
- 邀请码注册；login/logout/me
- admin 创建邀请
- 写操作对 admin+member 开放（MVP 无客户级 ACL）

### HTTP API（MVP）

| Method | Path | 说明 |
|---|---|---|
| GET | /api/health | 健康 |
| POST | /api/auth/bootstrap | seed admin |
| POST | /api/auth/register | 邀请码注册 |
| POST | /api/auth/login | 登录 |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 当前用户 |
| POST | /api/invites | 建邀请码（admin） |
| GET/POST | /api/customers | 列表/创建 |
| GET | /api/customers/:id | 详情（七维分区数据：insights+entities+notes） |
| GET | /api/customers/:id/graph | 一跳邻居 |
| GET | /api/events | 时间线筛选 |
| POST | /api/events | 追加记录 |
| POST | /api/events/:id/supersede | 修正 |
| POST | /api/events/:id/void | 作废 |
| POST | /api/events/:id/rollback | 回退到历史版内容 |
| POST | /api/insights/:id/unmerge | 撤销合并 |
| GET | /api/notes/:id/versions | 备注版本历史 |
| POST | /api/notes/:id/rollback | 备注回退 |
| POST | /api/customers/:id/insights | 人工洞察 |
| POST | /api/insights/:id/merge | 合并到新洞察 |
| POST | /api/insights/:id/retire | 作废洞察 |
| POST | /api/insights/:id/pin | 置顶切换 |
| POST | /api/notes | 在实体/客户上写备注卡 |
| PATCH/DELETE | /api/notes/:id | 编辑/删除备注 |
| POST | /api/customers/:id/recompute | LLM 重算 |

错误：401/403/404/400/502。

### 前端页面

1. 登录（左右分栏品牌+表单）
2. **总览**（登录首页）：统计卡 + 最近客户
3. **客户管理**：列表 / 新建 / 进入画像
4. **客户画像工作台**：七维 + 置顶 + 备注 + 重算（原型 A）
5. 时间线：录入/修正/作废/回退
6. 邀请码（admin）

品牌：中文「织女」；暖纸色底 `#f4f1ea`，墨色 `#1c1b19`。

### 配置

`.env`：`PORT`、`SESSION_SECRET`、`NEO4J_*`、`LLM_*`、`ADMIN_*`。

### 视觉（2026-09-17 重设计）

原暖米色 `#f4f1ea` 观感偏旧，整站 token 重写为「夜空织线」冷调工作台：

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#F4F6FA` | 页面冷灰底 |
| `--surface` | `#FFFFFF` | 卡片 |
| `--ink` | `#141821` | 主文字 / 顶栏底 |
| `--muted` | `#5C6478` | 次级文字 |
| `--line` | `#DDE2EC` | 描边/分割 |
| `--accent` | `#4F46E5` | 主按钮、链接、强调 |
| `--accent-soft` | `#EEF0FF` | 强调底、hover 面 |
| `--star` | `#8B7CFF` | 置顶星点 |
| `--ok` / `--warn` / `--danger` | `#0F766E` / `#B45309` / `#B91C1C` | 状态徽章 |

- 顶栏近夜空 `#141821`，品牌名带星点装饰
- 七维分区左侧 3px 靛青竖线（织线意象）
- 置顶洞察用 `--star` 点标记，不再用重色块
- 全站焦点环 `outline: 2px solid var(--accent)`，禁用 `outline: none`
- 字体：系统中文栈（PingFang SC / Noto Sans SC / system-ui）

### 画像版本时间线（git 式 · 2026-09-17 修订）

「时间线」对每个客户是一条**版本库**，不是单纯工作记录列表：

- **PortraitVersion** = 一次提交：七维展示态快照（各维有效洞察 + 系统/联系人 + 当前备注卡）+ `message` + `reason` + `parent` 链
- **HEAD** = `Portrait.currentVersionId`；画像页默认渲染 HEAD
- 触发新提交：LLM 重算、人工洞察创建/合并/作废/置顶、备注新建/编辑、工作记录追加/修正/作废（事件本身也进时间线）
- **查看版本 n**：只读该快照；**对比**：版本 n vs HEAD（或 n vs parent）；**恢复到 n**：新建提交，内容=n 的快照（不删历史，类似 revert 成目标内容）
- 全局「工作时间线」页改为：选客户 → 版本 log（可筛 reason）+ 事件日志混排

API 增量：

| Method | Path | 说明 |
|---|---|---|
| GET | /api/customers/:id/versions | 版本列表（含 HEAD 标记） |
| GET | /api/customers/:id/versions/:number | 版本快照详情 |
| GET | /api/customers/:id/versions/:number/diff?with=head\|parent\|N | 维度级 diff |
| POST | /api/customers/:id/versions/:number/restore | 恢复为新版本 |

### 布局（2026-09-17 修订 · 原型 A）

采用「侧栏工作台」：

- 左侧深色全高侧栏：品牌星点「织女」、主导航（**总览 / 客户管理 / 工作时间线 / 邀请码**）、底部当前用户
- **登录后首页 = 总览**（`/`）：客户数、有效记录、活跃洞察、待重算等统计；最近客户入口
- **客户管理**（`/customers`）：列表、新建、点开进入画像工作台
- 画像工作台（`/customers/:id`）：顶栏操作；主区置顶+七维洞察流；右栏 280px 概览/联系人/备注/最近时间线
- 全局时间线、邀请码共用同一侧栏壳
- **登录页**（`/login`）：无侧栏；左右分栏——左侧品牌与产品说明，右侧登录卡片
- 原型文件：`docs/compose/prototypes/a-sidebar-workbench.html`

## [S3] Out of Scope

- 自动后台重算队列
- 客户级 ACL、多租户、SSO
- 图算法推荐
- 从附件/聊天自动抽取
- 生产 K8s
- 自动合并旧洞察

## Tasks

- [x] T1: Neo4j schema/constraints + bootstrap 脚本 — acceptance: 约束存在；可创建 User/Customer (covers: S2)
- [x] T2: 鉴权与邀请码 — acceptance: bootstrap/login/register/me/logout 行为符合规格 (covers: S2; depends: T1)
- [x] T3: 客户/系统/联系人实体 API — acceptance: 客户列表/创建；upsert System/Contact；HAS_* 关系（HTTP 表未含客户 PATCH/DELETE） (covers: S2; depends: T2)
- [x] T4: 工作记录时间线 — acceptance: 追加/修正/作废/回退；active 过滤；回退产生新 active 事件并 SUPERSEDES 原现行版 (covers: S2; depends: T3)
- [x] T5: 洞察 API（创建/合并/作废/置顶/撤销合并） — acceptance: merge 后旧条 merged；unmerge 恢复源洞察并 retired 合并结果；默认查询不含 merged/retired (covers: S2; depends: T3)
- [x] T6: 实体备注卡 API — acceptance: Note 版本链；编辑追加版本；rollback 指回历史版本；详情页取 current 版本 (covers: S2; depends: T3)
- [x] T7: LLM 重算服务 — acceptance: mock LLM 下只新增 Insight 与实体；不修改旧 Insight；失败 502 无半截写入（服务层单写事务；HTTP 失败用例未覆盖） (covers: S2; depends: T4 T5)
- [x] T8: 客户详情七维组装 API — acceptance: GET detail 返回七维 insights+entities+notes 与置顶列表 (covers: S2; depends: T5 T6)
- [x] T9: 前端登录布局 — acceptance: 登录可用 (covers: S2; depends: T2)
- [x] T10: 前端客户画像页 — acceptance: 七维展示、置顶/合并/撤销合并/作废、写备注与版本回退、触发重算 (covers: S2; depends: T8 T9)
- [x] T11: 前端时间线 — acceptance: 录入/修正/作废/回退与 supersede 链展示 (covers: S2; depends: T4 T9)
- [x] T12: 图邻居展示 — acceptance: detail/graph 渲染一跳实体 (covers: S2; depends: T3 T9)
- [x] T13: 集成验证 — acceptance: typecheck；API 测试；docker 冒烟 (covers: S1 S2; depends: T7 T10 T11 T12)
