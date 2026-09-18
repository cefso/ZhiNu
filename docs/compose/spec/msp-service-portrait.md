---
feature: msp-service-portrait
status: in-progress
updated: 2026-09-18
branch: feat/msp-service-portrait
commits: 
---

# MSP 服务行为客户画像

## Report

## [S1] Problem

织女当前以「自由文本工作记录 → LLM 七维洞察」为画像主路径。真实 MSP 场景的数据不是客户 CMDB，而是**我们为客户做过什么**：部署 Redis、排查 MySQL 慢查询、扩容服务器、改 Nginx、处理 K8s 故障、安全加固等。平台需要从服务行为反推客户特征：技术领域、服务类型构成、运维依赖、故障驱动程度、变更活跃度、近期趋势与综合画像标签，而不是以七维叙述洞察为首页核心。

现有缺口：

1. Event 仅有自由 `tags`，无稳定的服务领域 / 服务类型 / 技术栈分类，指标无法确定性聚合。
2. 客户列表与总览只展示记录数与最近时间，缺少服务画像字段。
3. 客户详情是七维洞察工作台，未回答「这个客户我们了解多少、呈现出什么特征」。
4. 没有服务行为分析、跨客户多维查询、行为推导的 AI 洞察与画像变化对比。

## [S2] Design

### 决策摘要

| 轴 | 决策 |
|---|---|
| 产品定位 | **客户服务画像 / 运维画像**：从 MSP 服务记录推导客户特征 |
| 改造策略 | **重构为主**：主导航与客户主路径切换为服务画像；旧七维洞察/备注/版本数据保留，降为画像页折叠区 |
| 本轮范围 | **核心闭环**：分类体系 + 结构化 Event + 指标 API + 客户列表/画像/服务行为 + AI 行为洞察 + 种子数据；多维分析与全局画像洞察做可用骨架 |
| 分类方式 | **LLM 优先，规则兜底**：无 Key/LLM 失败时用关键词规则自动写入（`classifySource=rule|llm`）；body 带 `domain` 则 `human`；`autoClassify=false` 且无 domain → 400 `needsClassification` |
| 指标计算 | **确定性聚合**（基于已落库的 domain/serviceType/techs），不依赖 LLM 在线重算 |
| 种子数据 | 管理员可触发 MSP 演示种子（3 类典型客户 + 分类后服务史） |
| 品牌 | 保留「织女」；视觉延续冷灰底 + 靛青强调 |
| 技术栈 | 沿用 Fastify + Neo4j + React monorepo，不引入新后端框架 |

### 架构

```
录入服务记录 ──► LLM 分类（可降级手选）──► Event{domain,serviceType,techs}
                                              │
                                              ▼
                                    确定性指标聚合（Neo4j）
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              客户列表                    客户画像                  服务行为分析
                    │                         │
                    │                         ▼
                    │                  AI 行为洞察（LLM，措辞用可能/推测）
                    ▼
              多维分析 / 画像洞察（骨架：可回答固定交叉问题）
```

### 服务分类体系（`packages/shared`）

词表代码内维护，API 暴露只读字典；**不在本轮做管理端词表编辑**。

**服务领域 `ServiceDomain`**

| key | label | 典型技术（tech 字典示例） |
|---|---|---|
| `database` | 数据库 | MySQL, PostgreSQL, Oracle, SQL Server, MongoDB |
| `container` | 容器 / K8s | Kubernetes, Docker, Helm |
| `cache` | 缓存 | Redis, Memcached |
| `server` | 服务器 | Linux, Windows Server, VMware |
| `middleware` | 中间件 | Kafka, RabbitMQ, Nginx, Tomcat |
| `network` | 网络 | 防火墙, VPN, 负载均衡 |
| `security` | 安全 | 等保, 漏洞修复, 堡垒机 |
| `web` | Web 服务 | Nginx, Apache, HTTPS |
| `app` | 应用发布 | Java, Node, CI/CD |
| `other` | 其他 | — |

**服务类型 `ServiceType`**

| key | label |
|---|---|
| `incident` | 故障处理 |
| `routine` | 日常运维 |
| `change` | 变更实施 |
| `consult` | 咨询支持 |
| `project` | 项目实施 |

**技术标签**：规范化显示名字符串（如 `MySQL`、`Kubernetes`），来自 tech 字典或 LLM 返回后的 title-case 规范化；允许字典外技术，展示原样。

### Event 扩展（结构化服务记录）

在现有不可变时间线语义上**扩展字段**（不推翻 SUPERSEDES/void/rollback）：

```
Event {
  ...existing,
  domain?: ServiceDomain | 'other',
  serviceType?: ServiceType,
  techs?: string[],
  classifiedAt?: string,
  classifySource?: 'llm' | 'human' | 'seed' | 'rule'
}
```

- 创建：body 可带 `domain` / `serviceType` / `techs`；若缺省则自动分类（LLM 优先，失败回退规则词表）后写入；`autoClassify: false` 且未带 `domain` 时返回 400 `{ needsClassification: true }`。回退/修正产生的新 Event **继承或重分类**分类字段。
- 修正 SUPERSEDES：新事件继承或重分类，不自动信任旧分类字段以外的正文。
- 指标与画像**只统计** `status=active` 且 `domain`/`serviceType` 非空的事件；未分类事件计入「待分类」，不进入领域占比分母（列表可显示待分类数）。

**分类 API 契约（LLM）**

输入：`title` + `content`（+可选已有系统名）。

输出 JSON：

```json
{
  "domain": "database",
  "serviceType": "incident",
  "techs": ["MySQL"],
  "confidence": 0.86
}
```

非法 domain/serviceType → 降级 `other` / 不写 serviceType，`classifySource=llm` 仍可写 techs。失败（无 Key/超时/解析失败）→ 502 或标记未分类，**不写半截分类**。

### 指标与客户画像契约

`GET /api/customers/:id/profile`

```json
{
  "customer": { "id": "", "name": "", "company": "" },
  "summary": {
    "serviceCount": 1284,
    "classifiedCount": 1200,
    "pendingClassify": 84,
    "spanMonths": 18,
    "firstServiceAt": "...",
    "lastServiceAt": "...",
    "activityLevel": "high"
  },
  "domains": [{ "key": "database", "label": "数据库", "count": 412, "share": 0.32 }],
  "serviceTypes": [{ "key": "incident", "label": "故障处理", "count": 0, "share": 0 }],
  "techs": [{ "name": "MySQL", "count": 286, "domain": "database" }],
  "traits": {
    "serviceFrequency": 0.82,
    "faultDependency": 0.61,
    "changeActivity": 0.44,
    "consultDependency": 0.27,
    "labels": ["高频运维型", "故障驱动", "数据库重度"]
  },
  "trend": {
    "windowDays": 90,
    "current": { "total": 186, "byDomain": { "database": 76, "container": 42 } },
    "previous": { "total": 146, "byDomain": {} },
    "deltas": [{ "domain": "container", "current": 42, "previous": 18, "changePct": 133.3 }]
  },
  "archetype": {
    "title": "中大型互联网技术型客户",
    "summary": "…",
    "source": "rule"
  }
}
```

- `activityLevel`: 近 90 天**月均**（≈近90天次数/3）与全周期月均取峰值：`high` ≥ 20，`medium` ≥ 6，`low` 更低；无记录 `none`。
- `traits` 数值 0–1，由确定性规则计算：
  - `serviceFrequency` = min(1, 月均服务次数 / 15)
  - `faultDependency` = incident 占比
  - `changeActivity` = change 占比
  - `consultDependency` = consult 占比
  - `labels` 规则阈值示例：月均≥12 →「高频运维型」；incident 占比≥0.35 →「故障驱动」；单一 domain 占比≥0.30 →「{领域}重度」；change 占比≥0.25 →「高频变更」；consult 占比≥0.20 →「咨询依赖」。
- `archetype.source=rule`：无 LLM 时用标签组合映射（如 高频运维+故障驱动+database →「数据库依赖型客户」）；有洞察接口时 LLM 可覆盖为 `source=llm`。
- `trend.deltas`：对近 90 天 vs 前 90 天，任一侧 count>0 的 domain 计算 `changePct`。

`GET /api/customers/:id/behavior`

```json
{
  "monthly": [{ "month": "2026-05", "total": 40, "byType": { "incident": 12 }, "byDomain": { "database": 18 } }],
  "serviceTypes": [...],
  "domains": [...],
  "domainDetail": {
    "database": {
      "count": 412,
      "techs": [{ "name": "MySQL", "count": 286 }],
      "actions": [{ "label": "慢查询优化", "count": 86 }]
    }
  },
  "systems": [{ "name": "CRM", "count": 40 }],
  "period": { "from": "...", "to": "..." }
}
```

`actions` 本轮用关键词规则从 title/content 归纳（如 title 含「慢查询/优化」→「慢查询优化」；含「扩容」→「扩容」等，词表在 shared），非 LLM。

`GET /api/customers/:id/service-insights`（AI 行为洞察）

```json
{
  "narrative": ["过去 90 天共发生 186 次服务请求，较上一周期增长 27%。", "…"],
  "characteristics": ["数据库依赖度高", "容器化程度可能正在提升"],
  "archetype": "中大型互联网技术型客户",
  "caveats": ["画像由服务行为推断，非客户申报事实"],
  "generatedAt": "...",
  "source": "llm"
}
```

- Prompt 强制使用「可能 / 推测 / 较高」等措辞；输出为推断而非事实断言。
- 无 LLM Key → 502，前端展示规则 archetype + 指标区，不阻塞画像页。
- LLM 失败不写库；洞察按次生成，不强制持久化（可选缓存到 Portrait 节点字段，本轮允许内存/响应直出）。

### HTTP API（本轮增量）

| Method | Path | 说明 |
|---|---|---|
| GET | /api/taxonomy | 领域/服务类型/技术字典/动作关键词 |
| POST | /api/events | 创建；支持分类字段；可自动 LLM 分类 |
| POST | /api/events/:id/classify | 对单条 active 事件分类或重分类（LLM 或 body 手动字段） |
| GET | /api/analytics/customers | 客户列表 + 服务次数/活跃度/主要技术/特征标签 |
| GET | /api/customers/:id/profile | 客户服务画像（指标+特征+趋势+规则/LLM 架构标签） |
| GET | /api/customers/:id/behavior | 服务行为分析 |
| GET | /api/customers/:id/service-insights | AI 行为洞察 |
| GET | /api/analytics/cross | 多维交叉（query: `dims`）骨架 |
| POST | /api/analytics/reclassify | 批量给全库未分类 active 事件跑 LLM/规则 |
| POST | /api/customers/:id/reclassify | 仅重分类该客户未分类事件 |
| POST | /api/dev/seed | MSP 演示种子（见下） |

`GET /api/analytics/cross?dims=domain,customer` 等支持有限组合：`domain|serviceType|tech` × `customer|month`。返回 `{ rows: [{ keys: {...}, count }] }`。不支持的 dims → 400。

### 种子数据 `POST /api/dev/seed`

- 鉴权：登录用户；`NODE_ENV=production` 时默认拒绝（403），除非 `ALLOW_DEV_SEED=true`。
- 幂等键：客户名若已存在则跳过该客户创建，不重复灌入同名完整数据集（已存在同名则整客户跳过）。
- 三类客户（与设计示例对齐）：

| 客户 | 特征 | 服务史要点 |
|---|---|---|
| XX科技 | 高频运维 / 数据库+K8s / 故障+变更 | 约 60–70 条，分布在约 14 个月内；MySQL/Redis/K8s/Java；近 90 天 K8s 配置类明显增多 |
| XX集团 | 稳定型 / Oracle+VMware | 约 30–40 条，例行与变更为主，跨度约 12 个月 |
| XX制造 | 传统 IT / Windows+SQL Server | 约 20–30 条，故障与咨询为主 |

- 每客户写入**已分类** Event（`classifySource=seed`），`occurredAt` **分散在 past 12–18 个月**（不可挤在当月），以便趋势/preset 可演示。
- 响应：`{ seeded: [{ customer, eventCount }], skipped: string[] }`。

### 多维分析页（骨架）

`/analytics`：选择预设问题或 dims 组合，展示简单条形/表格：

- 哪些客户最依赖 MySQL 运维？（tech×customer）
- 哪些客户最近 K8s 需求增长最快？（近 90 天 domain=container 增量）
- 哪些客户故障处理占比最高？
- 哪些客户服务请求正在明显增加？

后四问在 `GET /api/analytics/cross?preset=...` 提供固定 preset，返回排序列表。深度自由分析与保存查询**不在本轮**。

### 画像洞察页（骨架）

`/insights`：跨客户列表——archetype、标签、**近 90 天服务量**、主要 domain、**top delta**。数据来自各客户 profile 聚合（`GET /api/analytics/customers` 扩展字段），不做独立洞察库。

### 前端信息架构（重构为主）

侧栏导航：

1. **总览** `/` — 服务向首页：待分类数、近 30 天服务量、活跃客户、主要领域
2. **客户列表** `/customers` — 画像字段列表（服务次数/活跃度/主要技术/客户特征）
3. **服务记录** `/timeline` — 录入与修正；分类选择/展示
4. **多维分析** `/analytics` — 骄架交叉与 preset
5. **画像洞察** `/insights` — 跨客户特征一览
6. **邀请码** `/invites`（admin）
7. **设置** `/settings`（admin）

客户详情 `/customers/:id`（**客户画像**主路径）：

```
顶栏：客户名 · 公司 · 操作（录入记录 / 服务行为 / 重算分类 / AI 洞察）
KPI：服务周期 | 服务次数 | 涉及技术 | 活跃度 | 待分类
客户标签 chips
技术领域画像（横条 + 点击滚到 behavior 对应域）
服务类型构成
运维特征（四维 0–1 指示）
近期趋势 / 画像变化（域对比）
AI 客户洞察卡片（可能/推测措辞）
折叠区：服务行为摘要、历史七维洞察、备注、版本时间线
```

子路由 `/customers/:id/behavior`：**服务行为**完整页（月度趋势 SVG/条形、类型构成、领域下钻 tech+actions、关联系统）。

录入弹层/表单字段：客户、标题、内容、时间、系统名、领域、服务类型、技术（chips/多选）；「自动识别」按钮调用分类；无分类保存时后端尝试 LLM，失败则提示必填。

### 与旧能力边界

| 旧能力 | 本轮处理 |
|---|---|
| 七维 Insight API/UI | API 保留；主路径 UI 降为画像页折叠「历史洞察」 |
| Note / 版本 PortraitVersion | API 保留；画像页折叠区可入口，不作为主 KPI |
| Event SUPERSEDES/void/rollback | 保留；分类字段随新版本 |
| 鉴权/邀请/设置 LLM | 保留；LLM 配置同时服务分类与行为洞察 |
| 总览旧统计卡 | 替换为服务向指标 |

### 前端页面验收路径

1. 登录 → 总览可见待分类/服务量
2. 管理员触发 seed（或手动建客户+分类记录）
3. 客户列表出现三类客户与特征标签
4. 打开 XX科技 → 画像 KPI/标签/领域条/特征/AI 或规则 archetype
5. 进入服务行为 → 月度趋势与 MySQL/K8s 下钻
6. 多维分析 preset 返回可排序客户
7. 录入一条「MySQL 慢查询排查」→ LLM 或手选分类后进入指标

### 测试边界

- shared：词表完整性、trait/label 规则纯函数、动作关键词匹配
- API：分类服务（mock LLM）、profile 聚合、behavior 月度桶、analytics 列表与 cross preset、seed 幂等、事件创建自动/手动分类
- 不强制：真实外部 LLM 端到端；生产 seed

### 配置

无新增必填 env。可选：`ALLOW_DEV_SEED`。沿用 `LLM_*` 与设置页运行时配置。

## [S3] Out of Scope

- 可视化管理端维护分类词表
- 自动后台分类队列 / 定时重算
- 自由拖拽多维 BI、保存的分析看板
- 独立洞察库与用户标注闭环
- 从 CMDB/聊天/附件自动抽取资产
- 多租户 ACL、客户级权限
- 旧七维数据迁移清洗（只保留展示）

## Tasks

- [ ] T1: shared 分类词表 + 指标/标签/动作规则纯函数 — acceptance: 导出 domain/serviceType/tech/action 词表；`computeTraits`/`labelArchetype`/`matchActionLabel`/`computeActivityLevel` 单测通过 (covers: S2)
- [ ] T2: Event 分类字段 + taxonomy API + 事件创建/分类接口 — acceptance: POST /api/events 可带分类或自动分类（LLM→规则）；`autoClassify=false` 无 domain 返回 needsClassification；POST classify；GET /api/taxonomy；rollback 继承分类字段 (covers: S2; depends: T1)
- [ ] T3: profile / behavior / analytics API — acceptance: GET profile 返回 summary/domains/types/techs/traits/trend/archetype；behavior 返回 monthly/domainDetail/systems；analytics/customers 含特征与近90天/delta；cross preset 可查询；未知 preset 400；POST /api/analytics/reclassify 与 /api/customers/:id/reclassify 均存在 (covers: S2; depends: T2)
- [ ] T4: AI 行为洞察 API + LLM prompt — acceptance: mock/规则返回 narrative/characteristics/archetype/caveats；无 Key 502（单测覆盖 LlmError）；不污染指标数据 (covers: S2; depends: T3)
- [ ] T5: MSP 种子数据 — acceptance: POST /api/dev/seed 生成 3 客户与已分类事件；occurredAt 跨 12–18 个月分布；同名客户跳过；production 无 ALLOW_DEV_SEED 时 403 (covers: S2; depends: T2)
- [ ] T6: 前端导航与服务记录录入（分类） — acceptance: 侧栏为新 IA；时间线可录领域/类型/技术；自动识别入口；列表/详情展示分类 (covers: S2; depends: T2)
- [ ] T7: 前端客户列表 + 客户画像页 — acceptance: 列表含服务次数/活跃度/主要技术/特征；画像页展示 KPI/标签/领域（可点进 behavior）/类型/特征/趋势/AI 洞察入口；旧七维折叠 (covers: S2; depends: T3 T4 T6)
- [ ] T8: 前端服务行为页 + 多维分析/画像洞察骨架 — acceptance: behavior 月度图与领域下钻（支持 query domain）；analytics preset 可用；insights 跨客户含近90天与 top delta (covers: S2; depends: T3 T7)
- [ ] T9: 总览服务化改造 — acceptance: 首页指标为待分类/近 30 天服务/活跃客户/主要领域，入口指向客户列表与录入 (covers: S2; depends: T3 T6)
- [ ] T10: 集成验证 — acceptance: typecheck；API 测试（含 mock 分类与 seed）；web build；必要冒烟 (covers: S1 S2; depends: T4 T5 T7 T8 T9)
