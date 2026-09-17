import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { ensureSchema } from '../schema.js';
import { closeDriver, withSession } from '../neo4j.js';
import type { FastifyInstance } from 'fastify';

const skip = !process.env.NEO4J_PASSWORD;

let app: FastifyInstance;

async function loginAsAdmin(app: FastifyInstance) {
  await app.inject({ method: 'POST', url: '/api/auth/bootstrap' });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      email: process.env.ADMIN_EMAIL ?? 'admin@zhinu.local',
      password: process.env.ADMIN_PASSWORD ?? 'change-me-admin',
    },
  });
  assert.equal(login.statusCode, 200, login.body);
  const raw = login.cookies as Array<string | { name: string; value: string }>;
  const pairs = raw.map((c) =>
    typeof c === 'string' ? c : `${c.name}=${c.value}`,
  );
  assert.ok(pairs.length > 0, `no cookies: ${JSON.stringify(login.cookies)}`);
  return pairs.join('; ');
}

before(async () => {
  if (skip) return;
  app = await buildApp();
  await ensureSchema();
  await withSession(async (s) => {
    await s.run('MATCH (n) DETACH DELETE n');
  });
});

after(async () => {
  if (skip) return;
  await app.close();
  await closeDriver();
});

test('health', { skip }, async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
});

test('auth bootstrap login me', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, process.env.ADMIN_EMAIL ?? 'admin@zhinu.local');
});

test('unauthorized rejected', { skip }, async () => {
  const res = await app.inject({ method: 'GET', url: '/api/customers' });
  assert.equal(res.statusCode, 401);
});

test('customer + event + insight + note + versions', { skip }, async () => {
  const cookie = await loginAsAdmin(app);

  const created = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '张总', company: '示例科技' },
  });
  assert.equal(created.statusCode, 200, created.body);
  const customerId = created.json().customer.id as string;

  const event = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { cookie },
    payload: {
      customerId,
      title: 'CRM导出报错',
      content: '客户反馈导出超时，已定位为数据量过大。',
      occurredAt: '2026-09-16T10:00:00Z',
      systemNames: ['CRM'],
      tags: ['故障'],
    },
  });
  assert.equal(event.statusCode, 200, event.body);
  const eventId = event.json().event.id as string;

  const supersede = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/supersede`,
    headers: { cookie },
    payload: {
      title: 'CRM导出报错（更正）',
      content: '实际为权限配置错误，已修复。',
      occurredAt: '2026-09-16T11:00:00Z',
      systemNames: ['CRM'],
    },
  });
  assert.equal(supersede.statusCode, 200, supersede.body);
  const eventId2 = supersede.json().event.id as string;

  const rollback = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId2}/rollback`,
    headers: { cookie },
    payload: { versionEventId: eventId },
  });
  assert.equal(rollback.statusCode, 200, rollback.body);
  const eventId3 = rollback.json().event.id as string;

  const list = await app.inject({
    method: 'GET',
    url: `/api/events?customerId=${customerId}&status=active`,
    headers: { cookie },
  });
  assert.equal(list.statusCode, 200);
  const active = list.json().events as { id: string }[];
  assert.ok(active.some((e) => e.id === eventId3));
  assert.ok(!active.some((e) => e.id === eventId));

  const insight = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/insights`,
    headers: { cookie },
    payload: {
      dimension: 'service',
      title: '常见导出类问题',
      body: '历史多次反馈导出相关问题。',
      eventIds: [eventId3],
    },
  });
  assert.equal(insight.statusCode, 200, insight.body);

  const sysList = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}`,
    headers: { cookie },
  });
  assert.equal(sysList.statusCode, 200, sysList.body);
  const systems = sysList.json().portrait.systems as { id: string; name: string }[];
  assert.ok(systems.some((s) => s.name === 'CRM'));

  const note = await app.inject({
    method: 'POST',
    url: '/api/notes',
    headers: { cookie },
    payload: {
      customerId,
      targetType: 'System',
      targetId: systems.find((s) => s.name === 'CRM')!.id,
      title: 'CRM 3.2 发版',
      body: '窗口下周三，含导出优化。',
      kind: 'release',
      occurAt: '2026-09-24',
    },
  });
  assert.equal(note.statusCode, 200, note.body);
  const noteId = note.json().note.id as string;

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/notes/${noteId}`,
    headers: { cookie },
    payload: { title: 'CRM 3.2 发版', body: '窗口改到周四。' },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().currentVersion, 2);

  const rb = await app.inject({
    method: 'POST',
    url: `/api/notes/${noteId}/rollback`,
    headers: { cookie },
    payload: { version: 1 },
  });
  assert.equal(rb.statusCode, 200);
  assert.equal(rb.json().currentVersion, 1);

  const versions = await app.inject({
    method: 'GET',
    url: `/api/notes/${noteId}/versions`,
    headers: { cookie },
  });
  assert.equal(versions.statusCode, 200);
  assert.equal(versions.json().versions.length, 2);
});

test('insight merge and unmerge', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '李经理' },
  });
  const customerId = created.json().customer.id as string;

  const a = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/insights`,
    headers: { cookie },
    payload: { dimension: 'communication', title: '偏好微信', body: '短消息确认。' },
  });
  const b = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/insights`,
    headers: { cookie },
    payload: { dimension: 'communication', title: '工作时间外少打扰', body: '尽量工作日白天。' },
  });
  const idA = a.json().insight.id as string;
  const idB = b.json().insight.id as string;

  const merged = await app.inject({
    method: 'POST',
    url: `/api/insights/${idA}/merge`,
    headers: { cookie },
    payload: {
      sourceInsightIds: [idA, idB],
      dimension: 'communication',
      title: '沟通偏好汇总',
      body: '微信短确认，工作日白天。',
    },
  });
  assert.equal(merged.statusCode, 200, merged.body);
  const newId = merged.json().insight.id as string;

  const unmerge = await app.inject({
    method: 'POST',
    url: `/api/insights/${newId}/unmerge`,
    headers: { cookie },
  });
  assert.equal(unmerge.statusCode, 200, unmerge.body);
  const restored = unmerge.json().restored as string[];
  assert.ok(restored.includes(idA));
  assert.ok(restored.includes(idB));
});

test('invite not burned on duplicate email', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const invite = await app.inject({
    method: 'POST',
    url: '/api/invites',
    headers: { cookie },
    payload: { role: 'member' },
  });
  assert.equal(invite.statusCode, 200, invite.body);
  const code = invite.json().code as string;

  // create existing user via second invite
  const invite2 = await app.inject({
    method: 'POST',
    url: '/api/invites',
    headers: { cookie },
    payload: { role: 'member' },
  });
  const code2 = invite2.json().code as string;
  const email = `dup-${Date.now()}@example.com`;
  const reg1 = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password1', inviteCode: code2 },
  });
  assert.equal(reg1.statusCode, 200, reg1.body);

  const reg2 = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password2', inviteCode: code },
  });
  assert.equal(reg2.statusCode, 409, reg2.body);

  // original invite should still work for a new email
  const reg3 = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `ok-${Date.now()}@example.com`, password: 'password3', inviteCode: code },
  });
  assert.equal(reg3.statusCode, 200, reg3.body);
});

test('rollback rejects cross-customer version event', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const a = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '客户A' },
  });
  const b = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '客户B' },
  });
  const idA = a.json().customer.id as string;
  const idB = b.json().customer.id as string;

  const evA = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { cookie },
    payload: {
      customerId: idA,
      title: 'A事件',
      content: 'A内容',
      occurredAt: '2026-09-01T08:00:00Z',
    },
  });
  const evB = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { cookie },
    payload: {
      customerId: idB,
      title: 'B事件',
      content: 'B内容',
      occurredAt: '2026-09-01T09:00:00Z',
    },
  });
  const evAId = evA.json().event.id as string;
  const evBId = evB.json().event.id as string;

  const bad = await app.inject({
    method: 'POST',
    url: `/api/events/${evAId}/rollback`,
    headers: { cookie },
    payload: { versionEventId: evBId },
  });
  assert.equal(bad.statusCode, 400, bad.body);
});

test('recompute with stub LLM is append-only', { skip }, async () => {
  const cookie = await loginAsAdmin(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: { name: '王工' },
  });
  const customerId = created.json().customer.id as string;
  await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { cookie },
    payload: {
      customerId,
      title: 'OA审批慢',
      content: '审批流超时，已优化索引。',
      occurredAt: '2026-09-15T09:00:00Z',
      systemNames: ['OA'],
    },
  });

  const stubLlm = async () => ({
    insights: [
      {
        dimension: 'service',
        title: '关注审批性能',
        body: '客户在意审批链路性能。',
        eventIds: [] as string[],
        mentionSystems: ['OA'],
        mentionContacts: [] as string[],
      },
    ],
    systems: [{ name: 'OA' }],
    contacts: [] as { name: string; title?: string }[],
  });

  const { recomputeCustomerPortrait } = await import('../services/recompute.js');
  const result = await recomputeCustomerPortrait(customerId, stubLlm);
  assert.ok(result);
  assert.equal(result!.insightCount, 1);

  const detail = await app.inject({
    method: 'GET',
    url: `/api/customers/${customerId}`,
    headers: { cookie },
  });
  const buckets = detail.json().portrait.buckets as {
    dimension: string;
    insights: { title: string }[];
  }[];
  const service = buckets.find((b) => b.dimension === 'service');
  assert.ok(service?.insights.some((i) => i.title === '关注审批性能'));
});
