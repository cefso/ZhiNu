import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withReadTx, withWriteTx } from '../neo4j.js';
import { requireAuth } from '../auth.js';
import { snapshotAfter } from '../services/snapshotAfter.js';
import type { PortraitDimension } from '@zhinu/shared';

const DIMENSIONS: PortraitDimension[] = [
  'profile',
  'business',
  'systems',
  'service',
  'communication',
  'risk',
  'notes',
];

export async function customerRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const rows = await withReadTx(async (tx) => {
      const result = await tx.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)-[:HAS_SYSTEM]->(s:System)
        OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
        RETURN c.id AS id, c.name AS name, c.company AS company,
               count(DISTINCT s) AS systemCount,
               count(DISTINCT e) AS eventCount,
               max(e.occurredAt) AS lastEventAt
        ORDER BY c.name
      `);
      return result.records.map((r) => ({
        id: r.get('id') as string,
        name: r.get('name') as string,
        company: (r.get('company') as string | null) ?? undefined,
        systemCount: Number(r.get('systemCount') ?? 0),
        eventCount: Number(r.get('eventCount') ?? 0),
        lastEventAt: (r.get('lastEventAt') as string | null) ?? undefined,
      }));
    });
    return { customers: rows };
  });

  app.post('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const parsed = z
      .object({
        name: z.string().min(1),
        company: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const id = randomUUID();
    await withWriteTx(async (tx) => {
      await tx.run(
        `CREATE (c:Customer {
          id: $id,
          name: $name,
          company: $company,
          createdAt: datetime(),
          createdBy: $createdBy
        })`,
        {
          id,
          name: parsed.data.name,
          company: parsed.data.company ?? null,
          createdBy: auth.userId,
        },
      );
    });
    await snapshotAfter(id, `创建客户 ${parsed.data.name}`, 'init', auth.userId);
    return {
      customer: {
        id,
        name: parsed.data.name,
        company: parsed.data.company,
      },
    };
  });

  app.get('/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };

    const detail = await withReadTx(async (tx) => {
      const customerRes = await tx.run(
        `MATCH (c:Customer {id: $id})
         OPTIONAL MATCH (c)-[:HAS_SYSTEM]->(s:System)
         OPTIONAL MATCH (c)-[:HAS_CONTACT]->(ct:Contact)
         RETURN c.id AS id, c.name AS name, c.company AS company,
                collect(DISTINCT s { .id, .name }) AS systems,
                collect(DISTINCT ct { .id, .name, .title }) AS contacts`,
        { id },
      );
      const cRec = customerRes.records[0];
      if (!cRec) return null;

      const pinnedRes = await tx.run(
        `MATCH (i:Insight {customerId: $id, status: 'active', pinned: true})
         OPTIONAL MATCH (i)-[:SUPPORTED_BY]->(e:Event)
         WITH i, collect(DISTINCT e.id) AS eventIds
         ORDER BY i.createdAt DESC
         RETURN i {
           .id, .customerId, .dimension, .title, .body, .source, .status, .pinned,
           .createdAt, .createdBy,
           eventIds: eventIds
         } AS insight`,
        { id },
      );

      const activeRes = await tx.run(
        `MATCH (i:Insight {customerId: $id, status: 'active'})
         OPTIONAL MATCH (i)-[:SUPPORTED_BY]->(e:Event)
         WITH i, collect(DISTINCT e.id) AS eventIds
         ORDER BY i.pinned DESC, i.createdAt DESC
         RETURN i {
           .id, .customerId, .dimension, .title, .body, .source, .status, .pinned,
           .createdAt, .createdBy,
           eventIds: eventIds
         } AS insight`,
        { id },
      );

      const historyRes = await tx.run(
        `MATCH (i:Insight {customerId: $id}) WHERE i.status IN ['merged','retired']
         OPTIONAL MATCH (i)-[:SUPPORTED_BY]->(e:Event)
         WITH i, collect(DISTINCT e.id) AS eventIds
         ORDER BY i.createdAt DESC
         RETURN i {
           .id, .customerId, .dimension, .title, .body, .source, .status, .pinned,
           .createdAt, .createdBy,
           eventIds: eventIds
         } AS insight
         LIMIT 50`,
        { id },
      );

      const notesRes = await tx.run(
        `MATCH (n:Note {customerId: $id})
         OPTIONAL MATCH (n)-[:ON]->(target)
         MATCH (n)-[:HAS_VERSION]->(v:NoteVersion {version: n.currentVersion})
         RETURN n {
           .id, .kind, .currentVersion, .createdAt, .createdBy,
           title: v.title, body: v.body, occurAt: v.occurAt,
           targetType: labels(target)[0], targetId: target.id
         } AS note
         ORDER BY n.createdAt DESC`,
        { id },
      );

      const insights = activeRes.records.map((r) => normalizeInsight(r.get('insight')));
      const history = historyRes.records.map((r) => normalizeInsight(r.get('insight')));
      const pinnedIds = new Set(
        pinnedRes.records.map((r) => (r.get('insight') as { id: string }).id),
      );

      const buckets = DIMENSIONS.map((dimension) => {
        const dimInsights = insights.filter((i) => i.dimension === dimension);
        const systems = (cRec.get('systems') as { id: string; name: string }[]).filter(Boolean);
        const contacts = (cRec.get('contacts') as { id: string; name: string; title?: string }[]).filter(Boolean);
        const notes = notesRes.records
          .map((r) => normalizeNote(r.get('note')))
          .filter((n) => noteFitsDimension(n, dimension));
        return {
          dimension,
          insights: dimInsights,
          systems: dimension === 'systems' ? systems : [],
          contacts: dimension === 'profile' ? contacts : [],
          notes,
        };
      });

      // systems also appear under business lightly - keep systems only in systems bucket
      const activeEvents = await tx.run(
        `MATCH (e:Event {customerId: $id, status: 'active'}) RETURN count(e) AS c`,
        { id },
      );
      const eventCount = Number(activeEvents.records[0]?.get('c') ?? 0);
      const portraitRes = await tx.run(
        `MATCH (p:Portrait {customerId: $id})
         RETURN p.lastEventCount AS lastEventCount, p.lastRecomputedAt AS lastRecomputedAt`,
        { id },
      );
      const lastEventCount = Number(portraitRes.records[0]?.get('lastEventCount') ?? -1);
      const lastRecomputedAt =
        (portraitRes.records[0]?.get('lastRecomputedAt') as string | null) ?? undefined;
      const needsRecompute =
        lastEventCount < 0 ? eventCount > 0 : eventCount !== lastEventCount;

      return {
        customer: {
          id: cRec.get('id') as string,
          name: cRec.get('name') as string,
          company: (cRec.get('company') as string | null) ?? undefined,
        },
        systems: (cRec.get('systems') as any[]).filter((s) => s?.id),
        contacts: (cRec.get('contacts') as any[]).filter((c) => c?.id),
        pinned: insights.filter((i) => pinnedIds.has(i.id)),
        buckets,
        history,
        lastRecomputedAt,
        needsRecompute,
      };
    });

    if (!detail) return reply.code(404).send({ error: 'Customer not found' });
    return { portrait: detail };
  });

  app.get('/:id/graph', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const neighbors = await withReadTx(async (tx) => {
      const result = await tx.run(
        `
        MATCH (c:Customer {id: $id})
        CALL {
          WITH c
          OPTIONAL MATCH (c)-[:HAS_SYSTEM]->(s:System)
          RETURN collect(DISTINCT s {.id, .name}) AS systems
        }
        CALL {
          WITH c
          OPTIONAL MATCH (c)-[:HAS_CONTACT]->(ct:Contact)
          RETURN collect(DISTINCT ct {.id, .name, .title}) AS contacts
        }
        CALL {
          WITH c
          OPTIONAL MATCH (c)<-[:ABOUT]-(e:Event {status: 'active'})
          RETURN collect(DISTINCT e {.id, .title}) AS events
        }
        CALL {
          WITH c
          OPTIONAL MATCH (c)<-[:ABOUT]-(i:Insight {status: 'active'})
          RETURN collect(DISTINCT i {.id, .title}) AS insights
        }
        RETURN systems, contacts, events, insights
        `,
        { id },
      );
      const rec = result.records[0];
      const items: {
        kind: 'system' | 'contact' | 'event' | 'insight';
        id: string;
        label: string;
        relation: string;
      }[] = [];
      if (!rec) return items;
      for (const s of rec.get('systems') as { id: string; name: string }[]) {
        if (s?.id) items.push({ kind: 'system', id: s.id, label: s.name, relation: 'HAS_SYSTEM' });
      }
      for (const ct of rec.get('contacts') as { id: string; name: string }[]) {
        if (ct?.id) items.push({ kind: 'contact', id: ct.id, label: ct.name, relation: 'HAS_CONTACT' });
      }
      for (const e of rec.get('events') as { id: string; title: string }[]) {
        if (e?.id) items.push({ kind: 'event', id: e.id, label: e.title, relation: 'ABOUT' });
      }
      for (const i of rec.get('insights') as { id: string; title: string }[]) {
        if (i?.id) items.push({ kind: 'insight', id: i.id, label: i.title, relation: 'ABOUT' });
      }
      return items;
    });
    return { neighbors };
  });

  app.post('/:id/recompute', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const { recomputeCustomerPortrait } = await import('../services/recompute.js');
    try {
      const result = await recomputeCustomerPortrait(id);
      if (result === null) return reply.code(404).send({ error: 'Customer not found' });
      return result;
    } catch (err) {
      req.log.error(err);
      const message = err instanceof Error ? err.message : 'Recompute failed';
      return reply.code(502).send({ error: message });
    }
  });
}

type RawInsight = Record<string, unknown>;

function normalizeInsight(raw: RawInsight) {
  const eventIds = raw.eventIds as string[] | null | undefined;
  return {
    id: String(raw.id),
    customerId: String(raw.customerId),
    dimension: String(raw.dimension) as PortraitDimension,
    title: String(raw.title),
    body: String(raw.body),
    source: String(raw.source) as 'llm' | 'human',
    status: String(raw.status) as 'active' | 'merged' | 'retired',
    pinned: Boolean(raw.pinned),
    createdAt: String(raw.createdAt ?? ''),
    createdBy: String(raw.createdBy ?? ''),
    eventIds: (eventIds ?? []).filter(Boolean),
  };
}

function normalizeNote(raw: RawInsight) {
  return {
    id: String(raw.id),
    kind: String(raw.kind ?? 'general') as 'general' | 'release' | 'other',
    currentVersion: Number(raw.currentVersion ?? 1),
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    occurAt: raw.occurAt ? String(raw.occurAt) : undefined,
    targetType: String(raw.targetType ?? 'Customer'),
    targetId: String(raw.targetId ?? ''),
    createdAt: String(raw.createdAt ?? ''),
    createdBy: String(raw.createdBy ?? ''),
  };
}

function noteFitsDimension(
  note: { kind: string; targetType: string },
  dimension: PortraitDimension,
) {
  if (dimension === 'notes') return true;
  if (dimension === 'systems' && (note.kind === 'release' || note.targetType === 'System')) return true;
  return false;
}
