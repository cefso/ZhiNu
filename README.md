# 织女 · 客户画像平台

把日常**工作记录**沉淀成客户的**立体画像**：七维洞察流（只增不改）、实体备注卡（可版本回退）、时间线修正/回退、LLM 手动重算。

## 快速开始

```bash
# 1. 启动 Neo4j
docker compose up -d

# 2. 配置环境
cp .env.example .env
# 编辑 SESSION_SECRET / ADMIN_PASSWORD / LLM_*

# 3. 安装依赖
npm install

# 4. 启动
npm run dev:api   # :3001
npm run dev:web   # :5173
```

浏览器打开 http://localhost:5173 ，点「初始化管理员」，用 `.env` 里的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。

## 结构

- `apps/api` — Fastify + Neo4j + OpenAI 兼容 LLM
- `apps/web` — React + Vite
- `packages/shared` — 共享类型与七维定义
- `Dockerfile` / `Dockerfile.web` — API / 前端生产镜像
- `nginx.conf` — 前端容器内反代 `/api`
- `.github/workflows/ci.yml` / `cd.yml` — CI / CD
- `docs/compose/spec/user-portrait-platform.md` — 功能规格

## 核心概念

| 概念 | 含义 |
|------|------|
| Event | 不可变工作记录；修正=新事件 SUPERSEDES 旧事件；可回退历史内容 |
| Insight | 画像最小单位；LLM 只增；人工可合并/作废/置顶；unmerge 可撤销合并 |
| Note + NoteVersion | 实体备注卡（如系统发版详情）；每次编辑追加版本，可回退 |
| 七维 | 基础组织 / 业务目标 / 系统环境 / 服务史 / 沟通偏好 / 风险情绪 / 开放备忘 |

## 测试

```bash
docker compose up -d
set -a && source .env && set +a
npm test
```

## CI / CD

GitHub Actions 工作流在 `.github/workflows/`：

| 工作流 | 触发 | 内容 |
|--------|------|------|
| **CI** | `push` 到 `main` / `develop`、`v*` tag；对 `main` 的 PR | 路径过滤后分别跑 API 测试（Neo4j service）、Web typecheck+build、Docker 镜像构建试跑 |
| **CD** | CI 成功后（仅 `main` 或 `v*` 分支） | 构建并推送 `api` / `web` 镜像到 GHCR |

本地等价检查：

```bash
# API
npm ci
npm run typecheck --workspace=@zhinu/api
# 需 Neo4j（见上）
npm test

# Web
npm run typecheck --workspace=@zhinu/web
npm run build --workspace=@zhinu/web

# 镜像
docker build -t zhinu/api:test -f Dockerfile .
docker build -t zhinu/web:test -f Dockerfile.web .
```

镜像命名：`ghcr.io/<owner>/<repo>/api`、`ghcr.io/<owner>/<repo>/web`。  
`main` 推送与版本 tag（如 `v0.1.0`）会打上 short SHA、`latest`，tag 另带版本号。

部署尚未启用；CD 目前只负责构建推送镜像。仓库 Packages 首次推送可能需要在 GitHub 上允许 Actions 写 package。
