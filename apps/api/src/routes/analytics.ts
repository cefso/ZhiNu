import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { withReadTx } from '../neo4j.js';
import { computeProfileMetrics, loadCustomerEvents } from '../services/metrics.js';
import { computeTraits, domainLabel, labelArchetype } from '@zhinu/shared';

export async function analyticsRoutes(app: FastifyInstance) {
  app.post('/reclassify', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { withReadTx, withWriteTx } = await import('../neo4j.js');
    const { classifyWithLlm } = await import('../llm.js');
    const pending = await withReadTx(async (tx) => {
      const res = await tx.run(
        `MATCH (e:Event {status: 'active'})
         WHERE e.domain IS NULL
         OPTIONAL MATCH (e)-[:MENTIONS]->(s:System)
         RETURN e.id AS id, e.title AS title, e.content AS content,
                collect(DISTINCT s.name) AS systemNames`,
      );
      return res.records.map((r) => ({
        id: r.get('id') as string,
        title: r.get('title') as string,
        content: (r.get('content') as string) ?? '',
        systemNames: (r.get('systemNames') as string[]).filter(Boolean),
      }));
    });
    let updated = 0;
    for (const e of pending) {
      const result = await classifyWithLlm({
        title: e.title,
        content: e.content,
        systemNames: e.systemNames,
      });
      await withWriteTx(async (tx) => {
        await tx.run(
          `MATCH (e:Event {id: $id})
           SET e.domain = $domain,
               e.serviceType = $serviceType,
               e.techs = $techs,
               e.classifiedAt = datetime(),
               e.classifySource = $source`,
          {
            id: e.id,
            domain: result.domain,
            serviceType: (result.serviceType ?? null) as string | null,
            techs: result.techs,
            source: result.source === 'llm' ? 'llm' : 'rule',
          },
        );
      });
      updated += 1;
    }
    return { pending: pending.length, updated, scope: 'all' };
  });

  app.get('/customers', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const customers = await withReadTx(async (tx) => {
      const res = await tx.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        RETURN c.id AS id, c.name AS name, c.company AS company,
               collect(DISTINCT e {.id, .occurredAt, .domain, .serviceType, .techs}) AS events
      `);
      return res.records.map((r) => {
        const id = r.get('id') as string;
        const name = r.get('name') as string;
        const company = (r.get('company') as string | null) ?? undefined;
        const raw = (r.get('events') as Record<string, unknown>[]).filter((e) => e && e.id);
        const events = raw.map((e) => ({
          id: String(e.id),
          title: '',
          occurredAt: String(e.occurredAt ?? ''),
          domain: (e.domain as string | null) ?? undefined,
          serviceType: (e.serviceType as string | null) ?? undefined,
          techs: (e.techs as string[] | null) ?? [],
          status: 'active',
        }));
        const metrics = computeProfileMetrics({ customer: { id, name, company }, events });
        const topTechs = metrics.techs.slice(0, 3).map((t) => t.name);
        const topDomains = metrics.domains.slice(0, 2).map((d) => d.label);
        return {
          id,
          name,
          company,
          serviceCount: metrics.summary.serviceCount,
          classifiedCount: metrics.summary.classifiedCount,
          pendingClassify: metrics.summary.pendingClassify,
          activityLevel: metrics.summary.activityLevel,
          topTechs,
          topDomains,
          labels: metrics.traits.labels,
          lastServiceAt: metrics.summary.lastServiceAt,
          archetype: metrics.archetype.title,
          recent90Count: metrics.trend.current.total,
          topDeltaDomain: metrics.trend.deltas[0]?.domain ?? null,
          topDeltaPct: metrics.trend.deltas[0]?.changePct ?? null,
        };
      });
    });

    customers.sort((a, b) => b.serviceCount - a.serviceCount || a.name.localeCompare(b.name));
    return { customers };
  });

  app.get('/cross', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const query = z
      .object({
        dims: z.string().optional(),
        preset: z.string().optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query' });
    const { dims, preset } = query.data;

    if (preset) {
      const result = await handlePreset(preset);
      if ('httpError' in result) {
        return reply.code(400).send(result.httpError);
      }
      return result;
    }

    if (!dims) return reply.code(400).send({ error: 'dims or preset required' });
    const [a, b] = dims.split(',').map((s) => s.trim());
    const groupA = new Set(['domain', 'serviceType', 'tech']);
    const groupB = new Set(['customer', 'month']);
    if (!a || !b) {
      return reply.code(400).send({ error: 'Unsupported dims. Use domain|serviceType|tech × customer|month' });
    }
    const ok =
      (groupA.has(a) && groupB.has(b)) || (groupB.has(a) && groupA.has(b));
    if (!ok) {
      return reply
        .code(400)
        .send({ error: 'Unsupported dims. Use domain|serviceType|tech × customer|month' });
    }

    const rows = await withReadTx(async (tx) => {
      const res = await tx.run(`
        MATCH (e:Event {status: 'active'})
        WHERE e.domain IS NOT NULL
        MATCH (e)-[:ABOUT]->(c:Customer)
        RETURN e.domain AS domain, e.serviceType AS serviceType, e.techs AS techs,
               e.occurredAt AS occurredAt, c.id AS customerId, c.name AS customerName
      `);
      return res.records.map((r) => ({
        domain: r.get('domain') as string,
        serviceType: (r.get('serviceType') as string | null) ?? 'unknown',
        techs: (r.get('techs') as string[] | null) ?? [],
        occurredAt: String(r.get('occurredAt') ?? ''),
        customerId: r.get('customerId') as string,
        customerName: r.get('customerName') as string,
      }));
    });

    const acc = new Map<string, { keys: Record<string, string>; count: number }>();
    for (const e of rows) {
      const keyVals: Record<string, string[]> = {
        domain: [e.domain],
        serviceType: [e.serviceType],
        tech: e.techs.length ? e.techs : ['(none)'],
        customer: [e.customerName],
        month: [e.occurredAt.slice(0, 7)],
      };
      for (const va of keyVals[a] ?? []) {
        for (const vb of keyVals[b] ?? []) {
          const key = `${a}=${va}|${b}=${vb}`;
          const cur = acc.get(key) ?? { keys: { [a]: va, [b]: vb }, count: 0 };
          cur.count += 1;
          acc.set(key, cur);
        }
      }
    }

    return {
      dims: [a, b],
      rows: [...acc.values()].sort((x, y) => y.count - x.count).slice(0, 100),
    };
  });
}

async function handlePreset(preset: string) {
  const profiles = await loadAllProfiles();
  switch (preset) {
    case 'mysql_dependency': {
      const rows = profiles
        .map((p) => ({
          customer: p.customer.name,
          customerId: p.customer.id,
          count: p.techs.find((t) => t.name === 'MySQL')?.count ?? 0,
        }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count);
      return { preset, question: '哪些客户最依赖 MySQL 运维？', rows };
    }
    case 'k8s_growth': {
      const rows = profiles
        .map((p) => {
          const cur = Number(p.trend.current.byDomain.container ?? 0);
          const prev = Number(p.trend.previous.byDomain.container ?? 0);
          return {
            customer: p.customer.name,
            customerId: p.customer.id,
            current: cur,
            previous: prev,
            changePct: prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100),
          };
        })
        .filter((r) => r.current > 0 || r.previous > 0)
        .sort((a, b) => b.changePct - a.changePct || b.current - a.current);
      return { preset, question: '哪些客户最近 K8s 需求增长最快？', rows };
    }
    case 'fault_ratio': {
      const rows = profiles
        .map((p) => ({
          customer: p.customer.name,
          customerId: p.customer.id,
          faultShare: p.traits.faultDependency,
          serviceCount: p.summary.serviceCount,
        }))
        .filter((r) => r.serviceCount > 0)
        .sort((a, b) => b.faultShare - a.faultShare);
      return { preset, question: '哪些客户故障处理占比最高？', rows };
    }
    case 'volume_growth': {
      const rows = profiles
        .map((p) => ({
          customer: p.customer.name,
          customerId: p.customer.id,
          current: p.trend.current.total,
          previous: p.trend.previous.total,
          changePct:
            p.trend.previous.total === 0
              ? p.trend.current.total > 0
                ? 100
                : 0
              : Math.round(
                  ((p.trend.current.total - p.trend.previous.total) / p.trend.previous.total) * 100,
                ),
        }))
        .sort((a, b) => b.changePct - a.changePct);
      return { preset, question: '哪些客户服务请求正在明显增加？', rows };
    }
    default:
      return {
        httpError: {
          error: 'Unknown preset',
          available: ['mysql_dependency', 'k8s_growth', 'fault_ratio', 'volume_growth'],
        },
      } as const;
  }
}

async function loadAllProfiles() {
  const ids = await withReadTx(async (tx) => {
    const res = await tx.run(`MATCH (c:Customer) RETURN c.id AS id`);
    return res.records.map((r) => r.get('id') as string);
  });
  const profiles = [];
  for (const id of ids) {
    const loaded = await loadCustomerEvents(id);
    if (!loaded.customer) continue;
    const customer = loaded.customer;
    profiles.push(computeProfileMetrics({ customer, events: loaded.events }));
  }
  return profiles;
}

export async function profileRoutePayload(customerId: string) {
  const loaded = await loadCustomerEvents(customerId);
  if (!loaded.customer) return null;
  const customer = loaded.customer;
  const profile = computeProfileMetrics({ customer, events: loaded.events });
  const behaviorMonthly = await monthlyLite(loaded.events);
  return {
    ...profile,
    behaviorSummary: { monthly: behaviorMonthly },
    systems: topSystems(loaded.events),
  };
}

function topSystems(events: { systemNames?: string[] }[]) {
  const acc: Record<string, number> = {};
  for (const e of events) {
    for (const s of e.systemNames ?? []) {
      if (s) acc[s] = (acc[s] ?? 0) + 1;
    }
  }
  return Object.entries(acc)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function monthlyLite(events: { occurredAt: string; status: string; domain?: string }[]) {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.status !== 'active' || !e.domain) continue;
    const month = String(e.occurredAt).slice(0, 7);
    map.set(month, (map.get(month) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}

// re-export helpers used by customer profile page labels
export { computeTraits, labelArchetype, domainLabel };
