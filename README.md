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
