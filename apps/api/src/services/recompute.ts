import { randomUUID } from 'node:crypto';
import { withReadTx, withWriteTx } from '../neo4j.js';
import { recomputeWithLlm } from '../llm.js';

export async function recomputeCustomerPortrait(
  customerId: string,
  llmFn: typeof recomputeWithLlm = recomputeWithLlm,
) {
  const exists = await withReadTx(async (tx) => {
    const res = await tx.run(`MATCH (c:Customer {id: $id}) RETURN c.name AS name LIMIT 1`, {
      id: customerId,
    });
    return res.records[0]
      ? {
          name: res.records[0].get('name') as string,
        }
      : null;
  });
  if (!exists) return null;

  const input = await withReadTx(async (tx) => {
    const events = await tx.run(
      `MATCH (e:Event {customerId: $id, status: 'active'})
       RETURN e.id AS id, e.title AS title, e.content AS content, e.occurredAt AS occurredAt
       ORDER BY e.occurredAt DESC`,
      { id: customerId },
    );
    const insights = await tx.run(
      `MATCH (i:Insight {customerId: $id, status: 'active'})
       RETURN i.dimension AS dimension, i.title AS title, i.body AS body`,
      { id: customerId },
    );
    const systems = await tx.run(
      `MATCH (c:Customer {id: $id})-[:HAS_SYSTEM]->(s:System)
       RETURN s.name AS name`,
      { id: customerId },
    );
    const contacts = await tx.run(
      `MATCH (c:Customer {id: $id})-[:HAS_CONTACT]->(ct:Contact)
       RETURN ct.name AS name, ct.title AS title`,
      { id: customerId },
    );
    const notes = await tx.run(
      `MATCH (n:Note {customerId: $id})-[:HAS_VERSION]->(v:NoteVersion {version: n.currentVersion})
       RETURN v.title AS title, v.body AS body`,
      { id: customerId },
    );

    return {
      events: events.records.map((r) => ({
        id: r.get('id') as string,
        title: r.get('title') as string,
        content: r.get('content') as string,
        occurredAt: r.get('occurredAt') as string,
      })),
      existingInsights: insights.records.map((r) => ({
        dimension: r.get('dimension') as string,
        title: r.get('title') as string,
        body: r.get('body') as string,
      })),
      systems: systems.records.map((r) => ({ name: r.get('name') as string })),
      contacts: contacts.records.map((r) => ({
        name: r.get('name') as string,
        title: (r.get('title') as string | null) ?? undefined,
      })),
      notes: notes.records.map((r) => ({
        title: r.get('title') as string,
        body: r.get('body') as string,
      })),
    };
  });

  const llmResult = await llmFn({
    customerName: exists.name,
    events: input.events,
    existingInsights: input.existingInsights,
    systems: input.systems,
    contacts: input.contacts,
    notes: input.notes,
  });

  const llmRunId = randomUUID();
  const createdIds: string[] = [];

  await withWriteTx(async (tx) => {
    for (const draft of llmResult.insights) {
      const id = randomUUID();
      createdIds.push(id);
      await tx.run(
        `CREATE (i:Insight {
          id: $id,
          customerId: $customerId,
          dimension: $dimension,
          title: $title,
          body: $body,
          source: 'llm',
          status: 'active',
          pinned: false,
          llmRunId: $llmRunId,
          createdAt: datetime(),
          createdBy: 'system'
        })
        WITH i
        MATCH (c:Customer {id: $customerId})
        MERGE (i)-[:ABOUT]->(c)`,
        {
          id,
          customerId,
          dimension: draft.dimension,
          title: draft.title,
          body: draft.body,
          llmRunId,
        },
      );
      for (const eventId of draft.eventIds ?? []) {
        await tx.run(
          `MATCH (i:Insight {id: $insightId}), (e:Event {id: $eventId, customerId: $customerId})
           MERGE (i)-[:SUPPORTED_BY]->(e)`,
          { insightId: id, eventId, customerId },
        );
      }
      for (const name of draft.mentionSystems ?? []) {
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
      for (const name of draft.mentionContacts ?? []) {
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
    }

    for (const sys of llmResult.systems ?? []) {
      await tx.run(
        `MERGE (s:System {name: $name})
         ON CREATE SET s.id = randomUUID()
         WITH s
         MATCH (c:Customer {id: $customerId})
         MERGE (c)-[:HAS_SYSTEM]->(s)`,
        { name: sys.name, customerId },
      );
    }

    for (const contact of llmResult.contacts ?? []) {
      await tx.run(
        `MERGE (ct:Contact {name: $name})
         ON CREATE SET ct.id = randomUUID()
         SET ct.title = coalesce($title, ct.title)
         WITH ct
         MATCH (c:Customer {id: $customerId})
         MERGE (c)-[:HAS_CONTACT]->(ct)`,
        { name: contact.name, title: contact.title ?? null, customerId },
      );
    }

    await tx.run(
      `MERGE (p:Portrait {customerId: $customerId})
       SET p.lastRecomputedAt = datetime(),
           p.lastLlmRunId = $llmRunId,
           p.lastEventCount = $eventCount`,
      { customerId, llmRunId, eventCount: input.events.length },
    );
  });

  return {
    ok: true,
    llmRunId,
    createdInsightIds: createdIds,
    insightCount: createdIds.length,
  };
}
