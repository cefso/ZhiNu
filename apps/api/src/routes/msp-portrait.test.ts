import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.js';
import { ensureSchema } from '../schema.js';
import { closeDriver, withSession } from '../neo4j.js';
import type { FastifyInstance } from 'fastify';

const skip = !process.env.NEO4J_PASSWORD;

let app!: FastifyInstance;
let cookie = '';

async function loginAsAdmin(app: FastifyInstance) {
  const email = process.env.ADMIN_EMAIL ?? 'admin@zhinu.local';
  const password = process.env.ADMIN_PASSWORD ?? 'zhinu-test-admin-pass';
  await app.inject({ method: 'POST', url: '/api/auth/bootstrap' });
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
  await withSession(async (s) => {
    await s.run('MATCH (n) DETACH DELETE n');
  });
  cookie = await loginAsAdmin(app);
});

after(async () => {
  if (app) await app.close();
  if (!skip) await closeDriver();
});

test('taxonomy endpoint', { skip }, async () => {
  const res = await app.inject({ method: 'GET', url: '/api/taxonomy', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.domains));
  assert.ok(body.domains.some((d: { key: string }) => d.key === 'database'));
});

test('event create auto-classifies via rules without llm key', { skip }, async () => {
  const cust = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '分类客户', company: '测试' },
  });
  assert.equal(cust.statusCode, 200);
  const customerId = cust.json().customer.id;

  const created = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { cookie },
    payload: {
      customerId,
      title: 'MySQL慢查询排查',
      content: '订单库慢查询导致超时',
      occurredAt: '2026-08-01',
      systemNames: ['订单系统'],
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const event = created.json().event;
  assert.equal(event.domain, 'database');
  assert.equal(event.serviceType, 'incident');
  assert.ok((event.techs ?? []).includes('MySQL'));

  const profile = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/profile`,
    headers: { cookie },
  });
  assert.equal(profile.statusCode, 200, profile.body);
  const p = profile.json().profile;
  assert.equal(p.summary.serviceCount, 1);
  assert.equal(p.summary.classifiedCount, 1);
  assert.ok(p.domains.some((d: { key: string }) => d.key === 'database'));

  const behavior = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/behavior`,
    headers: { cookie },
  });
  assert.equal(behavior.statusCode, 200);
  assert.ok(behavior.json().behavior.monthly.length >= 1);

  const insights = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}/service-insights?mode=rule`,
    headers: { cookie },
  });
  assert.equal(insights.statusCode, 200);
  assert.equal(insights.json().insights.source, 'rule');
  assert.ok(insights.json().insights.caveats.length > 0);
});

test('seed creates msp customers and analytics list', { skip }, async () => {
  const seed = await app.inject({
    method: 'POST',
    url: '/api/dev/seed',
    headers: { cookie },
    payload: {},
  });
  assert.equal(seed.statusCode, 200, seed.body);
  const body = seed.json();
  assert.ok(body.seeded.length >= 3);
  assert.ok(body.seeded.some((s: { customer: string }) => s.customer === 'XX科技'));

  const again = await app.inject({
    method: 'POST',
    url: '/api/dev/seed',
    headers: { cookie },
    payload: {},
  });
  assert.ok(again.json().skipped.includes('XX科技'));

  const list = await app.inject({
    method: 'GET',
    url: '/api/analytics/customers',
    headers: { cookie },
  });
  assert.equal(list.statusCode, 200);
  const customers = list.json().customers as {
    name: string;
    serviceCount: number;
    labels: string[];
    topTechs: string[];
  }[];
  const tech = customers.find((c) => c.name === 'XX科技');
  assert.ok(tech);
  assert.ok(tech.serviceCount >= 30);
  assert.ok(tech.topTechs.includes('MySQL'));
  assert.ok(tech.labels.length > 0);

  const cross = await app.inject({
    method: 'GET',
    url: '/api/analytics/cross?preset=mysql_dependency',
    headers: { cookie },
  });
  assert.equal(cross.statusCode, 200);
  const rows = cross.json().rows as { customer: string; count: number }[];
  assert.ok(rows.some((r) => r.customer === 'XX科技' && r.count > 0));

  const k8s = await app.inject({
    method: 'GET',
    url: '/api/analytics/cross?preset=k8s_growth',
    headers: { cookie },
  });
  assert.ok(Array.isArray(k8s.json().rows));
});
