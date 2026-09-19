# 织女 · 客户运维画像平台

把 MSP **服务记录**沉淀成客户**运维画像**：从「我们为客户做过什么」反推客户特征——技术领域、服务类型、故障/变更依赖、近期趋势与综合画像标签。

> 数据不是客户 CMDB，而是服务史：部署 Redis、排查 MySQL 慢查询、K8s 故障、Nginx 配置变更、安全加固……

## 产品能做什么

| 页面 | 回答的问题 |
|------|------------|
| **总览** | 近 30 天服务量、待分类、主要技术领域 |
| **客户列表** | 谁是活跃客户？主要技术与客户特征是什么？ |
| **客户画像** | 这个客户我们了解多少？标签 / 领域 / 运维特征 / 趋势 / AI 洞察 |
| **服务行为** | 我们给这个客户干了什么？月度趋势、类型构成、领域下钻 |
| **服务记录** | 录入与修正工作记录（结构化分类） |
| **多维分析** | 哪些客户最依赖 MySQL？谁的 K8s 需求涨得最快？ |
| **画像洞察** | 跨客户特征一览（archetype / 近 90 天 / top delta） |

画像结论来自服务行为聚合与推断（措辞用「可能 / 推测」），不是客户申报事实。

## 快速开始

```bash
# 1. 启动 Neo4j
docker compose up -d

# 2. 配置环境
cp .env.example .env
# 编辑 SESSION_SECRET / ADMIN_PASSWORD / LLM_*（LLM 可选）

# 3. 安装依赖
npm install

# 4. 启动
npm run dev:api   # :3001
npm run dev:web   # :5173
```

浏览器打开 http://localhost:5173 ，用 `.env` 里的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录（首次可调用 `POST /api/auth/bootstrap` 或页面「初始化管理员」）。

### 演示数据

登录后可在总览点 **「生成 MSP 演示数据」**，或：

```bash
curl -c /tmp/c.txt -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@zhinu.local","password":"<ADMIN_PASSWORD>"}'
curl -b /tmp/c.txt -X POST http://127.0.0.1:3001/api/dev/seed \
  -H 'Content-Type: application/json' -d '{}'
```

会写入三个已分类客户（同名跳过，幂等）：

| 客户 | 特征示意 |
|------|----------|
| XX科技 | 数据库 + K8s，故障/变更为主，近 90 天 K8s 配置增多 |
| XX集团 | Oracle + VMware，例行与变更 |
| XX制造 | Windows / SQL Server，故障与咨询 |

生产环境默认拒绝 seed；需显式 `ALLOW_DEV_SEED=true`。

## 服务记录如何变成画像

```
录入服务记录
  └─ 分类：领域 × 服务类型 × 技术
       LLM 优先 → 失败/无 Key 时规则词表兜底 → 也可手选
            │
            ▼
     Event { domain, serviceType, techs, classifySource }
            │
            ▼
   确定性指标聚合（不依赖 LLM 在线重算）
            │
     ┌──────┼──────────┐
     ▼      ▼          ▼
  客户列表  客户画像   服务行为 / 多维分析
                     │
                     ▼
              AI 行为洞察（推断语气）
```

**服务领域**：数据库 / 容器 K8s / 缓存 / 服务器 / 中间件 / 网络 / 安全 / Web / 应用发布 / 其他  

**服务类型**：故障处理 / 日常运维 / 变更实施 / 咨询支持 / 项目实施

**活跃度**（近 90 天月均 ≈ 次数/3，与全周期月均取峰值）：高 ≥ 20 · 中 ≥ 6 · 低

**创建事件时的分类行为**：

- body 带 `domain` → `classifySource=human`（缺类型/技术时会自动补全）
- 未带 domain → 自动分类（LLM 优先，规则兜底）
- `autoClassify: false` 且无 domain → `400 needsClassification`

旧版七维洞察 / 备注 / 画像版本 API 仍保留，UI 收在客户画像页折叠区。

## 主要 API（增量）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/taxonomy` | 领域 / 类型 / 技术词表 |
| POST | `/api/events` | 创建服务记录（可自动分类） |
| POST | `/api/events/:id/classify` | 单条分类 / 重分类 |
| GET | `/api/customers/:id/profile` | 客户服务画像指标 |
| GET | `/api/customers/:id/behavior` | 服务行为分析 |
| GET | `/api/customers/:id/service-insights` | AI 行为洞察（`?mode=rule` 规则版） |
| GET | `/api/analytics/customers` | 客户列表 + 特征字段 |
| GET | `/api/analytics/cross?preset=` | 预设多维问题 |
| POST | `/api/analytics/reclassify` | 全库未分类事件批量分类 |
| POST | `/api/customers/:id/reclassify` | 单客户批量分类 |
| POST | `/api/dev/seed` | MSP 演示种子（非生产） |

预设 `preset`：`mysql_dependency` · `k8s_growth` · `fault_ratio` · `volume_growth`

## 结构

- `apps/api` — Fastify + Neo4j + OpenAI 兼容 LLM
- `apps/web` — React + Vite（客户画像 / 服务行为 / 多维分析等）
- `packages/shared` — 分类词表、指标规则、共享类型
- `docs/compose/spec/msp-service-portrait.md` — 本轮功能规格
- `docs/compose/spec/user-portrait-platform.md` — 早期七维洞察平台规格
- `Dockerfile` / `Dockerfile.web` / `nginx.conf` — 生产镜像与反代
- `.github/workflows/` — CI / CD

## 核心概念

| 概念 | 含义 |
|------|------|
| Event | 不可变服务记录；带 `domain` / `serviceType` / `techs`；修正 = SUPERSEDES；回退继承分类字段 |
| classifySource | `llm` \| `rule` \| `human` \| `seed` |
| 指标 | 由已分类 active Event 确定性聚合（占比、特征、90 天趋势） |
| AI 行为洞察 | LLM 根据指标写推断文案；无 Key 时 502，前端可展示规则结果 |
| Insight / Note / PortraitVersion | 旧七维叙事与版本能力，API 保留，非主路径 |

## 配置

`.env` 常用项：

| 变量 | 说明 |
|------|------|
| `PORT` | API 端口，默认 3001 |
| `SESSION_SECRET` | 会话密钥（≥32 字符） |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | 图数据库 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首个管理员 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容 LLM（可选；也可在「设置」页运行时配置） |
| `ALLOW_DEV_SEED` | 生产环境是否允许 `/api/dev/seed` |

无 LLM Key 时：服务记录仍可自动分类（规则词表）；AI 行为洞察可用规则模式或在配置 Key 后生成。

## 测试

```bash
docker compose up -d
set -a && source .env && set +a
# 可选：export LLM_API_KEY=   # 强制走规则分类路径
npm test
```

本地等价检查：

```bash
npm ci
npm run typecheck
set -a && source .env && set +a && npm test
npm run build --workspace=@zhinu/web
```

## CI / CD

| 工作流 | 触发 | 内容 |
|--------|------|------|
| **CI** | `push` 到 `main` / `develop`、`v*` tag；对 `main` 的 PR | API 测试（Neo4j service）、Web typecheck+build、镜像构建试跑 |
| **CD** | CI 成功后（仅 `main` 或 `v*`） | 构建并推送 `api` / `web` 到 GHCR |

镜像：`ghcr.io/<owner>/<repo>/api`、`ghcr.io/<owner>/<repo>/web`。  
部署尚未启用；CD 目前只负责构建推送镜像。
