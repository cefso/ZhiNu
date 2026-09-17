import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withReadTx, withWriteTx } from '../neo4j.js';
import { requireAuth } from '../auth.js';
import { snapshotAfter } from '../services/snapshotAfter.js';

const DIMENSIONS = z.enum([
  'profile',
  'business',
  'systems',
  'service',
  'communication',
  'risk',
  'notes',
]);

export async function insightRoutes(app: FastifyInstance) {
  app.post('/customers/:customerId/insights', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { customerId } = req.params as { customerId: string };
    const parsed = z
      .object({
        dimension: DIMENSIONS,
        title: z.string().min(1),
        body: z.string().min(1),
        eventIds: z.array(z.string()).default([]),
        mentionSystems: z.array(z.string()).default([]),
        mentionContacts: z.array(z.string()).default([]),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const id = randomUUID();
    const result = await withWriteTx(async (tx) => {
      const cust = await tx.run(`MATCH (c:Customer {id: $id}) RETURN c`, { id: customerId });
      if (cust.records.length === 0) return { notFound: true as const };

      await tx.run(
        `CREATE (i:Insight {
          id: $id,
          customerId: $customerId,
          dimension: $dimension,
          title: $title,
          body: $body,
          source: 'human',
          status: 'active',
          pinned: false,
          createdAt: datetime(),
          createdBy: $createdBy
        })
        WITH i
        MATCH (c:Customer {id: $customerId})
        MERGE (i)-[:ABOUT]->(c)`,
        {
          id,
          customerId,
          dimension: parsed.data.dimension,
          title: parsed.data.title,
          body: parsed.data.body,
          createdBy: auth.userId,
        },
      );

      for (const eventId of parsed.data.eventIds) {
        await tx.run(
          `MATCH (i:Insight {id: $insightId}), (e:Event {id: $eventId, customerId: $customerId})
           MERGE (i)-[:SUPPORTED_BY]->(e)`,
          { insightId: id, eventId, customerId },
        );
      }
      for (const name of parsed.data.mentionSystems) {
        await tx.run(
          `MERGE (s:System {name: $name})
           ON CREATE SET s.id = randomUUID()
           WITH s
           MATCH (i:Insight {id: $insightId})
           MATCH (c:Customer {id: $customerId})
           MERGE (i)-[:MENTIONS]->(s)
           MERGE (c)-[:HAS_SYSTEM]->(s)`,
          { name, insightId: id, customerId },
        );
      }
      for (const name of parsed.data.mentionContacts) {
        await tx.run(
          `MERGE (ct:Contact {name: $name})
           ON CREATE SET ct.id = randomUUID()
           WITH ct
           MATCH (i:Insight {id: $insightId})
           MATCH (c:Customer {id: $customerId})
           MERGE (i)-[:MENTIONS]->(ct)
           MERGE (c)-[:HAS_CONTACT]->(ct)`,
          { name, insightId: id, customerId },
        );
      }

      return { id };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Customer not found' });
    await snapshotAfter(customerId, `人工洞察：${parsed.data.title}`, 'insight', auth.userId);
    return { insight: { id, ...parsed.data, source: 'human', status: 'active', pinned: false } };
  });

  app.post('/insights/:id/merge', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        sourceInsightIds: z.array(z.string()).min(1),
        dimension: DIMENSIONS,
        title: z.string().min(1),
        body: z.string().min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const newId = randomUUID();
    const result = await withWriteTx(async (tx) => {
      const all = await tx.run(
        `MATCH (i:Insight) WHERE i.id IN $ids
         RETURN collect(DISTINCT i.customerId) AS customers,
                collect(i.id) AS found,
                collect(CASE WHEN i.status = 'active' THEN i.id ELSE null END) AS activeIds`,
        { ids: parsed.data.sourceInsightIds },
      );
      const customers = (all.records[0]?.get('customers') as string[]).filter(Boolean);
      const found = (all.records[0]?.get('found') as string[]) ?? [];
      const activeIds = (all.records[0]?.get('activeIds') as (string | null)[]).filter(
        Boolean,
      ) as string[];
      if (found.length !== parsed.data.sourceInsightIds.length || customers.length !== 1) {
        return { invalid: true as const };
      }
      if (activeIds.length !== parsed.data.sourceInsightIds.length) {
        return { notActive: true as const };
      }
      const customerId = customers[0];

      await tx.run(
        `CREATE (i:Insight {
          id: $id,
          customerId: $customerId,
          dimension: $dimension,
          title: $title,
          body: $body,
          source: 'human',
          status: 'active',
          pinned: false,
          createdAt: datetime(),
          createdBy: $createdBy
        })
        WITH i
        MATCH (c:Customer {id: $customerId})
        MERGE (i)-[:ABOUT]->(c)`,
        {
          id: newId,
          customerId,
          dimension: parsed.data.dimension,
          title: parsed.data.title,
          body: parsed.data.body,
          createdBy: auth.userId,
        },
      );

      await tx.run(
        `MATCH (i:Insight {id: $newId})
         MATCH (old:Insight) WHERE old.id IN $ids
         SET old.status = 'merged'
         MERGE (i)-[:MERGES]->(old)
         WITH i, old
         OPTIONAL MATCH (old)-[:SUPPORTED_BY]->(e:Event)
         FOREACH (_ IN CASE WHEN e IS NULL THEN [] ELSE [1] END |
           MERGE (i)-[:SUPPORTED_BY]->(e)
         )`,
        { newId, ids: parsed.data.sourceInsightIds },
      );

      return { customerId };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'No active source insight' });
    if ('invalid' in result) {
      return reply.code(400).send({ error: 'Source insights must share one customer' });
    }
    if ('notActive' in result) {
      return reply.code(400).send({ error: 'All source insights must be active' });
    }
    await snapshotAfter(result.customerId, `合并洞察：${parsed.data.title}`, 'insight', auth.userId);
    return {
      insight: { id: newId, ...parsed.data, source: 'human', status: 'active' },
      mergedFrom: parsed.data.sourceInsightIds,
    };
  });

  app.post('/insights/:id/unmerge', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const result = await withWriteTx(async (tx) => {
      const merged = await tx.run(
        `MATCH (i:Insight {id: $id, status: 'active'})
         MATCH (i)-[:MERGES]->(old:Insight {status: 'merged'})
         SET old.status = 'active', i.status = 'retired'
         RETURN collect(old.id) AS restored, collect(DISTINCT i.customerId)[0] AS customerId`,
        { id },
      );
      const restored = (merged.records[0]?.get('restored') as string[]) ?? [];
      if (restored.length === 0) return { notFound: true as const };
      return { restored, customerId: merged.records[0].get('customerId') as string };
    });
    if ('notFound' in result) {
      return reply.code(404).send({ error: 'Active merged insight not found' });
    }
    await snapshotAfter(result.customerId, `撤销合并`, 'insight', auth.userId);
    return { ok: true, restored: result.restored };
  });

  app.post('/insights/:id/retire', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const result = await withWriteTx(async (tx) => {
      const res = await tx.run(
        `MATCH (i:Insight {id: $id})
         SET i.status = 'retired'
         RETURN i.customerId AS customerId`,
        { id },
      );
      const rec = res.records[0];
      if (!rec) return null;
      return rec.get('customerId') as string;
    });
    if (!result) return reply.code(404).send({ error: 'Insight not found' });
    await snapshotAfter(result, `作废洞察`, 'insight', auth.userId);
    return { ok: true };
  });

  app.post('/insights/:id/pin', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ pinned: z.boolean().default(true) }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });
    const result = await withWriteTx(async (tx) => {
      const res = await tx.run(
        `MATCH (i:Insight {id: $id, status: 'active'})
         SET i.pinned = $pinned
         RETURN i.customerId AS customerId`,
        { id, pinned: parsed.data.pinned },
      );
      const rec = res.records[0];
      if (!rec) return null;
      return rec.get('customerId') as string;
    });
    if (!result) return reply.code(404).send({ error: 'Active insight not found' });
    await snapshotAfter(
      result,
      parsed.data.pinned ? `置顶洞察` : `取消置顶`,
      'insight',
      auth.userId,
    );
    return { ok: true, pinned: parsed.data.pinned };
  });
}

export async function noteRoutes(app: FastifyInstance) {
  app.post('/notes', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const parsed = z
      .object({
        customerId: z.string().min(1),
        targetType: z.enum(['Customer', 'System', 'Contact']),
        targetId: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
        kind: z.enum(['general', 'release', 'other']).default('general'),
        occurAt: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const id = randomUUID();
    const result = await withWriteTx(async (tx) => {
      const cust = await tx.run(`MATCH (c:Customer {id: $id}) RETURN c`, {
        id: parsed.data.customerId,
      });
      if (cust.records.length === 0) return { notFound: true as const };

      const targetCheck = await tx.run(
        `MATCH (t) WHERE t.id = $targetId AND $label IN labels(t) RETURN t`,
        { targetId: parsed.data.targetId, label: parsed.data.targetType },
      );
      if (targetCheck.records.length === 0) return { targetNotFound: true as const };

      await tx.run(
        `CREATE (n:Note {
          id: $id,
          customerId: $customerId,
          kind: $kind,
          currentVersion: 1,
          createdAt: datetime(),
          createdBy: $createdBy
        })
        CREATE (v:NoteVersion {
          version: 1,
          title: $title,
          body: $body,
          occurAt: $occurAt,
          createdAt: datetime(),
          createdBy: $createdBy
        })
        MERGE (n)-[:HAS_VERSION]->(v)
        WITH n
        MATCH (t) WHERE t.id = $targetId
        MERGE (n)-[:ON]->(t)
        WITH n
        MATCH (c:Customer {id: $customerId})
        MERGE (n)-[:ON_CUSTOMER]->(c)`,
        {
          id,
          customerId: parsed.data.customerId,
          kind: parsed.data.kind,
          title: parsed.data.title,
          body: parsed.data.body,
          occurAt: parsed.data.occurAt ?? null,
          createdBy: auth.userId,
          targetId: parsed.data.targetId,
        },
      );

      return { id };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Customer not found' });
    if ('targetNotFound' in result) return reply.code(404).send({ error: 'Note target not found' });
    await snapshotAfter(parsed.data.customerId, `写备注：${parsed.data.title}`, 'note', auth.userId);
    return { note: { id, ...parsed.data, currentVersion: 1 } };
  });

  app.get('/notes/:id/versions', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const result = await withReadTx(async (tx) => {
      const res = await tx.run(
        `MATCH (n:Note {id: $id})
         OPTIONAL MATCH (n)-[:HAS_VERSION]->(v:NoteVersion)
         RETURN n.currentVersion AS currentVersion,
                collect(v { .version, .title, .body, .occurAt, .createdAt, .createdBy }) AS versions`,
        { id },
      );
      const rec = res.records[0];
      if (!rec) return null;
      return {
        currentVersion: Number(rec.get('currentVersion') ?? 1),
        versions: (rec.get('versions') as any[]).filter((v) => v?.version != null),
      };
    });
    if (!result) return reply.code(404).send({ error: 'Note not found' });
    return result;
  });

  app.patch('/notes/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        title: z.string().min(1),
        body: z.string().min(1),
        occurAt: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const result = await withWriteTx(async (tx) => {
      const note = await tx.run(
        `MATCH (n:Note {id: $id})-[:HAS_VERSION]->(v:NoteVersion)
         RETURN n, max(v.version) AS maxVersion`,
        { id },
      );
      const rec = note.records[0];
      if (!rec) return { notFound: true as const };
      const next = Number(rec.get('maxVersion') ?? 0) + 1;
      await tx.run(
        `MATCH (n:Note {id: $id})
         CREATE (v:NoteVersion {
           version: $next,
           title: $title,
           body: $body,
           occurAt: $occurAt,
           createdAt: datetime(),
           createdBy: $createdBy
         })
         MERGE (n)-[:HAS_VERSION]->(v)
         SET n.currentVersion = $next`,
        {
          id,
          next,
          title: parsed.data.title,
          body: parsed.data.body,
          occurAt: parsed.data.occurAt ?? null,
          createdBy: auth.userId,
        },
      );
      return { currentVersion: next };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Note not found' });
    const noteOwner = await withReadTx(async (tx) => {
      const res = await tx.run(`MATCH (n:Note {id: $id}) RETURN n.customerId AS customerId`, {
        id,
      });
      return res.records[0]?.get('customerId') as string | undefined;
    });
    if (noteOwner) {
      await snapshotAfter(noteOwner, `编辑备注：${parsed.data.title}`, 'note', auth.userId);
    }
    return { ok: true, currentVersion: result.currentVersion };
  });

  app.post('/notes/:id/rollback', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ version: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const result = await withWriteTx(async (tx) => {
      const check = await tx.run(
        `MATCH (n:Note {id: $id})-[:HAS_VERSION]->(v:NoteVersion {version: $version})
         RETURN n.id AS id`,
        { id, version: parsed.data.version },
      );
      if (check.records.length === 0) return { notFound: true as const };
      await tx.run(`MATCH (n:Note {id: $id}) SET n.currentVersion = $version`, {
        id,
        version: parsed.data.version,
      });
      return { currentVersion: parsed.data.version };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Version not found' });
    return { ok: true, currentVersion: result.currentVersion };
  });

  app.delete('/notes/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const ok = await withWriteTx(async (tx) => {
      const res = await tx.run(
        `MATCH (n:Note {id: $id})
         OPTIONAL MATCH (n)-[:HAS_VERSION]->(v:NoteVersion)
         DETACH DELETE n, v
         RETURN count(*) AS c`,
        { id },
      );
      return Number(res.records[0]?.get('c') ?? 0) > 0;
    });
    if (!ok) return reply.code(404).send({ error: 'Note not found' });
    return { ok: true };
  });
}
