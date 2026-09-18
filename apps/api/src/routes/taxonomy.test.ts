import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KEYWORDS,
  SERVICE_DOMAINS,
  SERVICE_TYPES,
  taxonomyPayload,
  computeTraits,
  labelArchetype,
  matchActionLabel,
  computeActivityLevel,
  computeTrendDelta,
  normalizeDomain,
  normalizeServiceType,
  normalizeTech,
} from '@zhinu/shared';

test('taxonomy dictionary is complete', () => {
  const t = taxonomyPayload();
  assert.ok(t.domains.length >= 8);
  assert.ok(t.serviceTypes.length >= 5);
  assert.ok(t.techs.some((x) => x.name === 'MySQL'));
  assert.equal(t.domainLabels.database, '数据库');
  assert.equal(SERVICE_DOMAINS[0].key, 'database');
  assert.equal(SERVICE_TYPES[0].key, 'incident');
  assert.ok(ACTION_KEYWORDS.some((a) => a.label === '慢查询优化'));
});

test('normalize helpers', () => {
  assert.equal(normalizeDomain('Database'), 'database');
  assert.equal(normalizeDomain('数据库'), 'database');
  assert.equal(normalizeDomain('nope'), null);
  assert.equal(normalizeServiceType('故障处理'), 'incident');
  assert.equal(normalizeTech('mysql'), 'MySQL');
  assert.equal(normalizeTech('k8s'), 'Kubernetes');
  assert.equal(normalizeTech('sql'), 'sql');
});

test('computeActivityLevel uses monthly avg thresholds', () => {
  assert.equal(computeActivityLevel(0, 0), 'none');
  // 20 in 90d → monthlyAvg90≈6.67 → medium
  assert.equal(computeActivityLevel(0, 20), 'medium');
  // 60 in 90d → monthlyAvg90=20 → high
  assert.equal(computeActivityLevel(0, 60), 'high');
  assert.equal(computeActivityLevel(25, 10), 'high');
});

test('matchActionLabel finds keywords', () => {
  assert.equal(matchActionLabel('MySQL慢查询排查'), '慢查询优化');
  assert.equal(matchActionLabel('Redis扩容'), '扩容');
  assert.equal(matchActionLabel('普通事项', '无关键词'), null);
});

test('computeTraits and archetype rules', () => {
  const traits = computeTraits({
    serviceCount: 144,
    spanMonths: 12,
    typeCounts: { incident: 60, change: 40, consult: 10, routine: 20, project: 14 },
    domainCounts: { database: 70, container: 40, cache: 20, other: 14 },
    classifiedCount: 144,
  });
  assert.ok(traits.serviceFrequency > 0.5);
  assert.ok(traits.faultDependency >= 0.4);
  assert.ok(traits.labels.includes('高频运维型'));
  assert.ok(traits.labels.includes('故障驱动'));
  assert.ok(traits.labels.some((l) => l.includes('数据库')));

  const arch = labelArchetype({
    labels: traits.labels,
    domainCounts: { database: 70, container: 40 },
    traits,
  });
  assert.equal(arch.source, 'rule');
  assert.match(arch.title, /数据库|客户/);
});

test('activity levels and trend delta', () => {
  const deltas = computeTrendDelta({ container: 42, database: 76 }, { container: 18, database: 64 });
  assert.equal(deltas[0].domain, 'container');
  assert.ok(deltas[0].changePct > 100);
});
