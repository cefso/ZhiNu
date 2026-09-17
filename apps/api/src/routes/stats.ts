import type { FastifyInstance } from 'fastify';
import { withReadTx } from '../neo4j.js';
import { requireAuth } from '../auth.js';

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
        OPTIONAL MATCH (i:Insight {status: 'active'})
        WITH customers, events, count(i) AS insights
        OPTIONAL MATCH (s:System)
        WITH customers, events, insights, count(s) AS systems
        OPTIONAL MATCH (p:Portrait)
        WITH customers, events, insights, systems, count(p) AS portraits
        RETURN customers, events, insights, systems, portraits
      `);
      const rec = counts.records[0];
      const recent = await tx.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        RETURN c.id AS id, c.name AS name, c.company AS company,
               count(e) AS eventCount,
               max(e.occurredAt) AS lastEventAt
        ORDER BY lastEventAt DESC, c.name
        LIMIT 8
      `);
      const needRecompute = await tx.run(`
        MATCH (p:Portrait), (c:Customer {id: p.customerId})
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        WITH p, c, count(e) AS eventCount
        WHERE p.lastEventCount IS NULL OR eventCount <> p.lastEventCount
        RETURN count(*) AS n
      `);

      return {
        customers: Number(rec?.get('customers') ?? 0),
        events: Number(rec?.get('events') ?? 0),
        insights: Number(rec?.get('insights') ?? 0),
        systems: Number(rec?.get('systems') ?? 0),
        needRecompute: Number(needRecompute.records[0]?.get('n') ?? 0),
        recentCustomers: recent.records.map((r) => ({
          id: r.get('id') as string,
          name: r.get('name') as string,
          company: (r.get('company') as string | null) ?? undefined,
          eventCount: Number(r.get('eventCount') ?? 0),
          lastEventAt: (r.get('lastEventAt') as string | null) ?? undefined,
        })),
      };
    });

    return stats;
  });
}
