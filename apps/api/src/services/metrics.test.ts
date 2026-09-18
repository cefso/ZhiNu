import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByRules, classifyServiceRecord, normalizeClassifyPayload } from '../services/classify.js';
import { computeProfileMetrics, computeBehavior } from '../services/metrics.js';
import { ruleServiceInsights, serviceInsightsWithLlm, LlmError } from '../llm.js';
import { computeActivityLevel } from '@zhinu/shared';

test('classifyByRules detects mysql incident', () => {
  const r = classifyByRules({
    title: 'MySQL慢查询排查',
    content: '订单库 slow query 导致接口超时',
  });
  assert.equal(r.domain, 'database');
  assert.equal(r.serviceType, 'incident');
  assert.ok(r.techs.includes('MySQL'));
  assert.equal(r.source, 'rule');
});

test('classifyServiceRecord prefers mock llm then normalizes', async () => {
  const r = await classifyServiceRecord(
    { title: 'K8s扩容', content: '节点扩容' },
    async () => ({
      domain: 'container',
      serviceType: 'change',
      techs: ['kubernetes'],
      confidence: 0.9,
      source: 'llm',
    }),
  );
  assert.equal(r.domain, 'container');
  assert.equal(r.serviceType, 'change');
  assert.deepEqual(r.techs, ['Kubernetes']);
});

test('classifyServiceRecord falls back to rules when llm throws', async () => {
  const r = await classifyServiceRecord({ title: 'Redis扩容' }, async () => {
    throw new Error('llm down');
  });
  assert.equal(r.domain, 'cache');
  assert.ok(r.techs.includes('Redis'));
});

test('normalizeClassifyPayload maps invalid domain to other', () => {
  const r = normalizeClassifyPayload({ domain: 'nope', serviceType: '故障处理', techs: ['mysql'] });
  assert.equal(r.domain, 'other');
  assert.equal(r.serviceType, 'incident');
  assert.deepEqual(r.techs, ['MySQL']);
});

test('computeProfileMetrics aggregates seed-like events', () => {
  const now = Date.parse('2026-09-18T00:00:00Z');
  const events = [
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      title: 'MySQL慢查询',
      content: '慢查询',
      occurredAt: `2026-0${(i % 8) + 1}-1${(i % 9) + 1}`,
      domain: 'database',
      serviceType: i % 2 === 0 ? 'incident' : 'change',
      techs: ['MySQL'],
      status: 'active',
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `k${i}`,
      title: 'K8s配置',
      content: 'ingress',
      occurredAt: `2026-0${(i % 6) + 1}-10`,
      domain: 'container',
      serviceType: 'change',
      techs: ['Kubernetes'],
      status: 'active',
    })),
    {
      id: 'p1',
      title: '未分类',
      content: 'x',
      occurredAt: '2026-02-01',
      status: 'active',
    },
  ];
  const profile = computeProfileMetrics(
    { customer: { id: 'c1', name: 'XX科技', company: 'XX' }, events },
    now,
  );
  assert.equal(profile.summary.serviceCount, 31);
  assert.equal(profile.summary.classifiedCount, 30);
  assert.equal(profile.summary.pendingClassify, 1);
  assert.ok(profile.domains.find((d) => d.key === 'database')!.count >= 20);
  assert.ok(profile.techs.some((t) => t.name === 'MySQL'));
  assert.ok(profile.traits.labels.length > 0);
  assert.equal(profile.archetype.source, 'rule');
  assert.ok(profile.trend.current.total >= 0);

  const behavior = computeBehavior(
    { customer: { id: 'c1', name: 'XX科技' }, events },
    now,
  );
  assert.ok(behavior.monthly.length > 0);
  assert.ok(behavior.domainDetail.database);
  assert.ok(behavior.domainDetail.database.techs.some((t) => t.name === 'MySQL'));
});

test('ruleServiceInsights uses possible language', () => {
  const profile = computeProfileMetrics({
    customer: { id: 'c', name: 'X' },
    events: [
      {
        id: '1',
        title: 'MySQL故障',
        content: '',
        occurredAt: '2026-08-01',
        domain: 'database',
        serviceType: 'incident',
        techs: ['MySQL'],
        status: 'active',
      },
    ],
  });
  const insights = ruleServiceInsights(profile);
  assert.equal(insights.source, 'rule');
  assert.ok(insights.caveats.length > 0);
  assert.ok(insights.narrative.join('').includes('服务'));
});

test('serviceInsightsWithLlm throws without key', async () => {
  const profile = computeProfileMetrics({
    customer: { id: 'c', name: 'X' },
    events: [
      {
        id: '1',
        title: 'MySQL故障',
        content: '',
        occurredAt: '2026-08-01',
        domain: 'database',
        serviceType: 'incident',
        techs: ['MySQL'],
        status: 'active',
      },
    ],
  });
  await assert.rejects(
    () =>
      serviceInsightsWithLlm(profile, ['MySQL故障'], {
        llmBaseUrl: 'http://127.0.0.1:9',
        llmModel: 'test',
        temperature: 0,
        llmApiKey: '',
      } as never),
    (err: unknown) => err instanceof LlmError,
  );
});

test('activity level follows monthly-avg contract', () => {
  assert.equal(computeActivityLevel(0, 60), 'high');
  assert.equal(computeActivityLevel(0, 20), 'medium');
  assert.equal(computeActivityLevel(0, 3), 'low');
});
