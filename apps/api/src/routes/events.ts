import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import neo4jDriver from 'neo4j-driver';
import { withReadTx, withWriteTx } from '../neo4j.js';
import { requireAuth } from '../auth.js';
import { snapshotAfter } from '../services/snapshotAfter.js';

export async function eventRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const query = z
      .object({
        customerId: z.string().optional(),
        status: z.enum(['active', 'superseded', 'voided', 'all']).default('all'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query' });
    const { customerId, status, limit } = query.data;

    const events = await withReadTx(async (tx) => {
      const result = await tx.run(
        `
        MATCH (e:Event)
        WHERE ($customerId IS NULL OR e.customerId = $customerId)
          AND ($status = 'all' OR e.status = $status)
        OPTIONAL MATCH (e)<-[:SUPERSEDES]-(newer:Event)
        OPTIONAL MATCH (e)-[:SUPERSEDES]->(older:Event)
        OPTIONAL MATCH (e)-[:ABOUT]->(c:Customer)
        OPTIONAL MATCH (e)-[:MENTIONS]->(s:System)
        WITH e, older.id AS supersedes, newer.id AS supersededBy, c.name AS customerName,
             collect(DISTINCT s.name) AS systemNames
        ORDER BY e.occurredAt DESC, e.createdAt DESC
        LIMIT $limit
        RETURN e {
          .id, .customerId, .title, .content, .occurredAt, .tags, .status,
          .createdAt, .createdBy,
          .domain, .serviceType, .techs, .classifySource,
          supersedes: supersedes,
          supersededBy: supersededBy
        } AS event,
        customerName,
        systemNames
        `,
        { customerId: customerId ?? null, status, limit: neo4jInt(limit) },
      );
      return result.records.map((r) => {
        const ev = r.get('event') as Record<string, unknown>;
        return {
          ...ev,
          tags: (ev.tags as string[] | null) ?? [],
          techs: (ev.techs as string[] | null) ?? [],
          customerName: (r.get('customerName') as string | null) ?? undefined,
          systemNames: (r.get('systemNames') as string[]).filter(Boolean),
        };
      });
    });
    return { events };
  });

  app.post('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const parsed = z
      .object({
        customerId: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
        occurredAt: z.string().min(1),
        tags: z.array(z.string()).default([]),
        systemNames: z.array(z.string()).default([]),
        domain: z.string().optional(),
        serviceType: z.string().optional(),
        techs: z.array(z.string()).optional(),
        autoClassify: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const { classifyWithLlm } = await import('../llm.js');
    const { normalizeDomain, normalizeServiceType, normalizeTech } = await import('@zhinu/shared');
    let domain = normalizeDomain(parsed.data.domain);
    let serviceType = normalizeServiceType(parsed.data.serviceType);
    let techs = (parsed.data.techs ?? []).map((t) => normalizeTech(t)).filter(Boolean);
    let classifySource: 'human' | 'llm' | 'rule' | undefined;
    if (domain) {
      classifySource = 'human';
      if (!serviceType || !techs.length) {
        const fill = await classifyWithLlm({
          title: parsed.data.title,
          content: parsed.data.content,
          systemNames: parsed.data.systemNames,
        });
        serviceType = (serviceType ?? fill.serviceType ?? null) as
          | typeof serviceType
          | null;
        if (!techs.length) techs = fill.techs;
      }
    } else if (parsed.data.autoClassify === false) {
      return reply.code(400).send({
        error: 'needsClassification',
        needsClassification: true,
        message: '请提供 domain/serviceType/techs，或允许自动分类',
      });
    } else {
      const classified = await classifyWithLlm({
        title: parsed.data.title,
        content: parsed.data.content,
        systemNames: parsed.data.systemNames,
      });
      domain = classified.domain;
      serviceType = (serviceType ?? classified.serviceType ?? null) as typeof serviceType;
      techs = techs.length ? techs : classified.techs;
      classifySource = classified.source === 'llm' ? 'llm' : 'rule';
    }

    const id = randomUUID();
    const created = await withWriteTx(async (tx) => {
      const cust = await tx.run(`MATCH (c:Customer {id: $id}) RETURN c`, {
        id: parsed.data.customerId,
      });
      if (cust.records.length === 0) return { notFound: true as const };

      await tx.run(
        `CREATE (e:Event {
          id: $id,
          customerId: $customerId,
          title: $title,
          content: $content,
          occurredAt: $occurredAt,
          tags: $tags,
          status: 'active',
          domain: $domain,
          serviceType: $serviceType,
          techs: $techs,
          classifiedAt: datetime(),
          classifySource: $classifySource,
          createdAt: datetime(),
          createdBy: $createdBy
        })
        WITH e
        MATCH (c:Customer {id: $customerId})
        MERGE (e)-[:ABOUT]->(c)`,
        {
          id,
          customerId: parsed.data.customerId,
          title: parsed.data.title,
          content: parsed.data.content,
          occurredAt: parsed.data.occurredAt,
          tags: parsed.data.tags,
          domain,
          serviceType: (serviceType ?? null) as string | null,
          techs,
          classifySource: classifySource ?? null,
          createdBy: auth.userId,
        },
      );

      for (const name of parsed.data.systemNames) {
        const systemId = randomUUID();
        await tx.run(
          `MERGE (s:System {name: $name})
           ON CREATE SET s.id = $systemId
           WITH s
           MATCH (e:Event {id: $eventId})
           MATCH (c:Customer {id: $customerId})
           MERGE (e)-[:MENTIONS]->(s)
           MERGE (c)-[:HAS_SYSTEM]->(s)`,
          { name, systemId, eventId: id, customerId: parsed.data.customerId },
        );
      }

      return { id };
    });

    if ('notFound' in created) return reply.code(404).send({ error: 'Customer not found' });
    await snapshotAfter(
      parsed.data.customerId,
      `新增记录：${parsed.data.title}`,
      'event',
      auth.userId,
    );
    return {
      event: {
        id,
        ...parsed.data,
        domain,
        serviceType,
        techs,
        classifySource,
        status: 'active',
      },
      needsRecompute: true,
    };
  });

  app.post('/:id/classify', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        domain: z.string().optional(),
        serviceType: z.string().optional(),
        techs: z.array(z.string()).optional(),
        useLlm: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const { withReadTx: rtx, withWriteTx: wtx } = await import('../neo4j.js');
    const { classifyWithLlm } = await import('../llm.js');
    const { normalizeDomain, normalizeServiceType, normalizeTech } = await import('@zhinu/shared');

    const current = await rtx(async (tx) => {
      const res = await tx.run(
        `MATCH (e:Event {id: $id, status: 'active'})
         OPTIONAL MATCH (e)-[:MENTIONS]->(s:System)
         RETURN e.id AS id, e.title AS title, e.content AS content,
                collect(DISTINCT s.name) AS systemNames`,
        { id },
      );
      const rec = res.records[0];
      if (!rec) return null;
      return {
        id: rec.get('id') as string,
        title: rec.get('title') as string,
        content: (rec.get('content') as string) ?? '',
        systemNames: (rec.get('systemNames') as string[]).filter(Boolean),
      };
    });
    if (!current) return reply.code(404).send({ error: 'Event not found' });

    let domain = normalizeDomain(parsed.data.domain);
    let serviceType = normalizeServiceType(parsed.data.serviceType);
    let techs = (parsed.data.techs ?? []).map((t) => normalizeTech(t)).filter(Boolean);
    let source: string;
    if (domain) {
      source = 'human';
    } else if (parsed.data.useLlm !== false) {
      const classified = await classifyWithLlm({
        title: current.title,
        content: current.content,
        systemNames: current.systemNames,
      });
      domain = classified.domain;
      serviceType = (serviceType ?? classified.serviceType ?? null) as typeof serviceType;
      techs = techs.length ? techs : classified.techs;
      source = classified.source === 'llm' ? 'llm' : 'rule';
    } else {
      return reply.code(400).send({ error: 'domain required when useLlm=false' });
    }

    await wtx(async (tx) => {
      await tx.run(
        `MATCH (e:Event {id: $id})
         SET e.domain = $domain,
             e.serviceType = $serviceType,
             e.techs = $techs,
             e.classifiedAt = datetime(),
             e.classifySource = $source`,
        {
          id,
          domain,
          serviceType: (serviceType ?? null) as string | null,
          techs,
          source,
        },
      );
    });

    return {
      event: { id, domain, serviceType, techs, classifySource: source },
    };
  });

  app.post('/:id/supersede', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        title: z.string().min(1),
        content: z.string().min(1),
        occurredAt: z.string().min(1),
        tags: z.array(z.string()).default([]),
        systemNames: z.array(z.string()).default([]),
        domain: z.string().optional(),
        serviceType: z.string().optional(),
        techs: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const { classifyWithLlm } = await import('../llm.js');
    const { normalizeDomain, normalizeServiceType, normalizeTech } = await import('@zhinu/shared');
    let domain = normalizeDomain(parsed.data.domain);
    let serviceType = normalizeServiceType(parsed.data.serviceType);
    let techs = (parsed.data.techs ?? []).map((t) => normalizeTech(t)).filter(Boolean);
    let classifySource: string | undefined;
    if (domain) classifySource = 'human';
    else {
      const classified = await classifyWithLlm({
        title: parsed.data.title,
        content: parsed.data.content,
        systemNames: parsed.data.systemNames,
      });
      domain = classified.domain;
      serviceType = (serviceType ?? classified.serviceType ?? null) as typeof serviceType;
      techs = techs.length ? techs : classified.techs;
      classifySource = classified.source === 'llm' ? 'llm' : 'rule';
    }

    const newId = randomUUID();
    const result = await withWriteTx(async (tx) => {
      const old = await tx.run(
        `MATCH (e:Event {id: $id}) RETURN e.customerId AS customerId, e.status AS status`,
        { id },
      );
      const oldRec = old.records[0];
      if (!oldRec) return { notFound: true as const };
      if (oldRec.get('status') !== 'active') return { notActive: true as const };
      const customerId = oldRec.get('customerId') as string;

      await tx.run(
        `MATCH (old:Event {id: $id})
         MATCH (c:Customer {id: $customerId})
         CREATE (e:Event {
           id: $newId,
           customerId: $customerId,
           title: $title,
           content: $content,
           occurredAt: $occurredAt,
           tags: $tags,
           status: 'active',
           domain: $domain,
           serviceType: $serviceType,
           techs: $techs,
           classifiedAt: datetime(),
           classifySource: $classifySource,
           createdAt: datetime(),
           createdBy: $createdBy
         })
         MERGE (e)-[:SUPERSEDES]->(old)
         MERGE (e)-[:ABOUT]->(c)
         SET old.status = 'superseded'`,
        {
          id,
          newId,
          customerId,
          title: parsed.data.title,
          content: parsed.data.content,
          occurredAt: parsed.data.occurredAt,
          tags: parsed.data.tags,
          domain,
          serviceType: (serviceType ?? null) as string | null,
          techs,
          classifySource: classifySource ?? null,
          createdBy: auth.userId,
        },
      );

      for (const name of parsed.data.systemNames) {
        const systemId = randomUUID();
        await tx.run(
          `MERGE (s:System {name: $name})
           ON CREATE SET s.id = $systemId
           WITH s
           MATCH (e:Event {id: $eventId})
           MATCH (c:Customer {id: $customerId})
           MERGE (e)-[:MENTIONS]->(s)
           MERGE (c)-[:HAS_SYSTEM]->(s)`,
          { name, systemId, eventId: newId, customerId },
        );
      }

      return { id: newId, customerId };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Event not found' });
    if ('notActive' in result) {
      return reply.code(400).send({ error: 'Only active events can be superseded' });
    }
    await snapshotAfter(
      result.customerId,
      `修正记录：${parsed.data.title}`,
      'event',
      auth.userId,
    );
    return { event: { id: newId, supersedes: id, ...parsed.data }, needsRecompute: true };
  });

  app.post('/:id/void', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const result = await withWriteTx(async (tx) => {
      const res = await tx.run(
        `MATCH (e:Event {id: $id})
         SET e.status = 'voided'
         RETURN e.customerId AS customerId`,
        { id },
      );
      const rec = res.records[0];
      if (!rec) return null;
      return rec.get('customerId') as string;
    });
    if (!result) return reply.code(404).send({ error: 'Event not found' });
    await snapshotAfter(result, `作废记录`, 'event', auth.userId);
    return { ok: true, needsRecompute: true };
  });

  app.post('/:id/rollback', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    // id = current active event to supersede; body.versionEventId = historical version content source
    const parsed = z.object({ versionEventId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const newId = randomUUID();
    const result = await withWriteTx(async (tx) => {
      const current = await tx.run(
        `MATCH (e:Event {id: $id}) RETURN e.customerId AS customerId, e.status AS status`,
        { id },
      );
      const currentRec = current.records[0];
      if (!currentRec) return { notFound: true as const };
      if (currentRec.get('status') !== 'active') return { notActive: true as const };

      const version = await tx.run(
        `MATCH (v:Event {id: $versionId}) RETURN v.title AS title, v.content AS content, v.occurredAt AS occurredAt, v.tags AS tags, v.customerId AS customerId, v.domain AS domain, v.serviceType AS serviceType, v.techs AS techs`,
        { versionId: parsed.data.versionEventId },
      );
      const vRec = version.records[0];
      if (!vRec) return { versionNotFound: true as const };

      const customerId = currentRec.get('customerId') as string;
      const versionCustomerId = vRec.get('customerId') as string;
      if (versionCustomerId !== customerId) return { crossCustomer: true as const };
      const title = vRec.get('title') as string;
      const content = vRec.get('content') as string;
      const occurredAt = vRec.get('occurredAt') as string;
      const tags = (vRec.get('tags') as string[] | null) ?? [];
      const domain = (vRec.get('domain') as string | null) ?? null;
      const serviceType = (vRec.get('serviceType') as string | null) ?? null;
      const techs = (vRec.get('techs') as string[] | null) ?? [];

      await tx.run(
        `MATCH (old:Event {id: $id})
         MATCH (c:Customer {id: $customerId})
         CREATE (e:Event {
           id: $newId,
           customerId: $customerId,
           title: $title,
           content: $content,
           occurredAt: $occurredAt,
           tags: $tags,
           status: 'active',
           domain: $domain,
           serviceType: $serviceType,
           techs: $techs,
           classifiedAt: datetime(),
           classifySource: CASE WHEN $domain IS NULL THEN NULL ELSE 'human' END,
           createdAt: datetime(),
           createdBy: $createdBy,
           rollbackFrom: $versionId
         })
         MERGE (e)-[:SUPERSEDES]->(old)
         MERGE (e)-[:ABOUT]->(c)
         SET old.status = 'superseded'`,
        {
          id,
          newId,
          customerId,
          title,
          content,
          occurredAt,
          tags,
          domain,
          serviceType,
          techs,
          createdBy: auth.userId,
          versionId: parsed.data.versionEventId,
        },
      );

      return { id: newId, customerId };
    });

    if ('notFound' in result) return reply.code(404).send({ error: 'Event not found' });
    if ('notActive' in result) {
      return reply.code(400).send({ error: 'Only active events can be rolled back' });
    }
    if ('versionNotFound' in result) {
      return reply.code(404).send({ error: 'Version event not found' });
    }
    if ('crossCustomer' in result) {
      return reply.code(400).send({ error: 'Version event belongs to another customer' });
    }
    await snapshotAfter(
      result.customerId,
      `回退记录内容至历史版`,
      'event',
      auth.userId,
    );
    return {
      event: { id: newId, supersedes: id, restoredFrom: parsed.data.versionEventId },
      needsRecompute: true,
    };
  });
}

function neo4jInt(n: number) {
  return neo4jDriver.int(n);
}
