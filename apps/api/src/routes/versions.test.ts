import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.js';
import { ensureSchema } from '../schema.js';
import { closeDriver, withSession } from '../neo4j.js';
import type { FastifyInstance } from 'fastify';

const skip = !process.env.NEO4J_PASSWORD;

let app!: FastifyInstance;

async function loginAsAdmin(app: FastifyInstance) {
  const email = process.env.ADMIN_EMAIL ?? 'admin@zhinu.local';
  const password = process.env.ADMIN_PASSWORD ?? 'change-me-admin';
  await app.inject({ method: 'POST', url: '/api/auth/bootstrap' });
  // ensure password matches env (bootstrap only seeds empty graph)
  await withSession(async (s) => {
    const hash = await bcrypt.hash(password, 10);
    await s.run(
      `MERGE (u:User {email: $email})
       ON CREATE SET u.id = randomUUID(), u.name = 'Admin', u.role = 'admin', u.createdAt = datetime()
       SET u.passwordHash = $hash`,
      { email, hash },
    );
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const raw = login.cookies as Array<string | { name: string; value: string }>;
  return raw
    .map((c) => (typeof c === 'string' ? c : `${c.name}=${c.value}`))
    .join('; ');
}

before(async () => {
  if (skip) return;
  app = await buildApp();
  await ensureSchema();
});

after(async () => {
  if (app) await app.close();
  if (!skip) await closeDriver();
});

test('portrait versions snapshot, diff, restore', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: `版本客户-${Date.now()}` },
  });
  assert.equal(created.statusCode, 200, created.body);
  const customerId = created.json().customer.id as string;

  // v1 init from create
  const list1 = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/versions`,
    headers: { cookie },
  });
  assert.equal(list1.statusCode, 200, list1.body);
  const v1 = list1.json().versions as { number: number; isHead: boolean }[];
  assert.ok(v1.length >= 1);
  assert.ok(v1.some((v) => v.number === 1 && v.isHead));

  // add insight -> new version
  const ins = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/insights`,
    headers: { cookie },
    payload: {
      dimension: 'service',
      title: '关注导出',
      body: '曾反馈导出超时。',
    },
  });
  assert.equal(ins.statusCode, 200, ins.body);

  const list2 = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/versions`,
    headers: { cookie },
  });
  const v2 = list2.json().versions as { number: number; isHead: boolean; message: string }[];
  assert.ok(v2.length >= 2, `expect >=2 versions, got ${v2.length}`);
  const head = v2.find((v) => v.isHead);
  assert.ok(head);

  // view version 1 + diff vs head
  const detail = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/versions/1`,
    headers: { cookie },
  });
  assert.equal(detail.statusCode, 200, detail.body);

  const diff = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/versions/1/diff?with=head`,
    headers: { cookie },
  });
  assert.equal(diff.statusCode, 200, diff.body);
  assert.ok(diff.json().diff);

  // restore v1 -> new head with empty-ish insights from v1
  const restore = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/versions/1/restore`,
    headers: { cookie },
  });
  assert.equal(restore.statusCode, 200, restore.body);
  assert.equal(restore.json().restoredFrom, 1);

  const list3 = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/versions`,
    headers: { cookie },
  });
  const versions3 = list3.json().versions as { number: number; isHead: boolean }[];
  assert.ok(versions3.length >= 3);
  assert.ok(versions3.find((v) => v.isHead)!.number > head!.number);

  // live portrait should not have the insight after restore to empty v1
  const detailPortrait = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}`,
    headers: { cookie },
  });
  const buckets = detailPortrait.json().portrait.buckets as {
    insights: { title: string }[];
  }[];
  const totalInsights = buckets.reduce((n, b) => n + b.insights.length, 0);
  assert.equal(totalInsights, 0, 'restore to v1 should retire live insights');
});
