import type { FastifyInstance } from 'fastify';
import { withReadTx } from '../neo4j.js';
import { requireAuth } from '../auth.js';
import { computeProfileMetrics } from '../services/metrics.js';
import { domainLabel } from '@zhinu/shared';

export async function statsRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const stats = await withReadTx(async (tx) => {
      const counts = await tx.run(`
        OPTIONAL MATCH (c:Customer)
        WITH count(c) AS customers
        OPTIONAL MATCH (e:Event {status: 'active'})
        WITH customers, count(e) AS events
        OPTIONAL MATCH (p:Event {status: 'active'})
        WHERE p.domain IS NULL
        WITH customers, events, count(p) AS pendingClassify
        OPTIONAL MATCH (e2:Event {status: 'active'})
        WHERE e2.domain IS NOT NULL
        WITH customers, events, pendingClassify, count(e2) AS classified
        RETURN customers, events, pendingClassify, classified
      `);
      const rec = counts.records[0];

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const recent30 = await tx.run(
        `MATCH (e:Event {status: 'active'})
         WHERE e.occurredAt >= $since
         RETURN count(e) AS n`,
        { since },
      );

      const activeCustomers = await tx.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        WITH c, count(e) AS n
        WHERE n > 0
        RETURN count(c) AS n
      `);

      const domainAgg = await tx.run(`
        MATCH (e:Event {status: 'active'})
        WHERE e.domain IS NOT NULL
        RETURN e.domain AS domain, count(*) AS n
        ORDER BY n DESC
        LIMIT 5
      `);

      const recent = await tx.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        RETURN c.id AS id, c.name AS name, c.company AS company,
               count(e) AS eventCount,
               max(e.occurredAt) AS lastEventAt
        ORDER BY lastEventAt DESC, c.name
        LIMIT 8
      `);

      const recentCustomers = [];
      for (const r of recent.records) {
        const id = r.get('id') as string;
        const name = r.get('name') as string;
        const company = (r.get('company') as string | null) ?? undefined;
        const eRes = await tx.run(
          `MATCH (e:Event {customerId: $id, status: 'active'})
           RETURN e {.id, .occurredAt, .domain, .serviceType, .techs} AS event`,
          { id },
        );
        const events = eRes.records.map((x) => {
          const ev = x.get('event') as Record<string, unknown>;
          return {
            id: String(ev.id),
            title: '',
            occurredAt: String(ev.occurredAt ?? ''),
            domain: (ev.domain as string | null) ?? undefined,
            serviceType: (ev.serviceType as string | null) ?? undefined,
            techs: (ev.techs as string[] | null) ?? [],
            status: 'active',
          };
        });
        const metrics = computeProfileMetrics({ customer: { id, name, company }, events });
        recentCustomers.push({
          id,
          name,
          company,
          eventCount: Number(r.get('eventCount') ?? 0),
          lastEventAt: (r.get('lastEventAt') as string | null) ?? undefined,
          activityLevel: metrics.summary.activityLevel,
          labels: metrics.traits.labels.slice(0, 3),
          topTechs: metrics.techs.slice(0, 3).map((t) => t.name),
        });
      }

      return {
        customers: Number(rec?.get('customers') ?? 0),
        events: Number(rec?.get('events') ?? 0),
        pendingClassify: Number(rec?.get('pendingClassify') ?? 0),
        classified: Number(rec?.get('classified') ?? 0),
        events30d: Number(recent30.records[0]?.get('n') ?? 0),
        activeCustomers: Number(activeCustomers.records[0]?.get('n') ?? 0),
        topDomains: domainAgg.records.map((r) => ({
          domain: r.get('domain') as string,
          label: domainLabel(r.get('domain') as string),
          count: Number(r.get('n') ?? 0),
        })),
        recentCustomers,
      };
    });

    return stats;
  });
}
