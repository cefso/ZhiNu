import { randomUUID } from 'node:crypto';
import { withReadTx, withWriteTx } from '../neo4j.js';

export type PortraitDimensionKey =
  | 'profile'
  | 'business'
  | 'systems'
  | 'service'
  | 'communication'
  | 'risk'
  | 'notes';

export const DIMENSION_KEYS: PortraitDimensionKey[] = [
  'profile',
  'business',
  'systems',
  'service',
  'communication',
  'risk',
  'notes',
];

export type SnapshotInsight = {
  id: string;
  title: string;
  body: string;
  source: string;
  pinned: boolean;
  eventIds: string[];
};

export type PortraitSnapshot = {
  customer: { id: string; name: string; company?: string };
  dimensions: Record<
    PortraitDimensionKey,
    { insights: SnapshotInsight[] }
  >;
  systems: { id: string; name: string }[];
  contacts: { id: string; name: string; title?: string }[];
  notes: {
    id: string;
    title: string;
    body: string;
    kind: string;
    targetType: string;
    targetId: string;
    currentVersion: number;
  }[];
  eventCount: number;
};

export type VersionReason =
  | 'init'
  | 'llm'
  | 'insight'
  | 'note'
  | 'event'
  | 'restore';

function emptyDimensions(): PortraitSnapshot['dimensions'] {
  const d = {} as PortraitSnapshot['dimensions'];
  for (const k of DIMENSION_KEYS) d[k] = { insights: [] };
  return d;
}

export async function buildPortraitSnapshot(customerId: string): Promise<PortraitSnapshot | null> {
  return withReadTx(async (tx) => {
    const cust = await tx.run(
      `MATCH (c:Customer {id: $id}) RETURN c.name AS name, c.company AS company`,
      { id: customerId },
    );
    if (!cust.records[0]) return null;
    const name = cust.records[0].get('name') as string;
    const company = (cust.records[0].get('company') as string | null) ?? undefined;

    const systemsRes = await tx.run(
      `MATCH (c:Customer {id: $id})-[:HAS_SYSTEM]->(s:System)
       RETURN s.id AS id, s.name AS name ORDER BY s.name`,
      { id: customerId },
    );
    const contactsRes = await tx.run(
      `MATCH (c:Customer {id: $id})-[:HAS_CONTACT]->(ct:Contact)
       RETURN ct.id AS id, ct.name AS name, ct.title AS title ORDER BY ct.name`,
      { id: customerId },
    );
    const insightsRes = await tx.run(
      `MATCH (i:Insight {customerId: $id, status: 'active'})
       OPTIONAL MATCH (i)-[:SUPPORTED_BY]->(e:Event)
       WITH i, collect(DISTINCT e.id) AS eventIds
       ORDER BY i.pinned DESC, i.createdAt
       RETURN i.id AS id, i.dimension AS dimension, i.title AS title, i.body AS body,
              i.source AS source, i.pinned AS pinned, eventIds`,
      { id: customerId },
    );
    const notesRes = await tx.run(
      `MATCH (n:Note {customerId: $id})
       OPTIONAL MATCH (n)-[:ON]->(target)
       MATCH (n)-[:HAS_VERSION]->(v:NoteVersion {version: n.currentVersion})
       RETURN n.id AS id, n.kind AS kind, n.currentVersion AS currentVersion,
              v.title AS title, v.body AS body,
              labels(target)[0] AS targetType, target.id AS targetId`,
      { id: customerId },
    );
    const eventsRes = await tx.run(
      `MATCH (e:Event {customerId: $id, status: 'active'}) RETURN count(e) AS c`,
      { id: customerId },
    );

    const dimensions = emptyDimensions();
    for (const r of insightsRes.records) {
      const dim = r.get('dimension') as PortraitDimensionKey;
      if (!dimensions[dim]) continue;
      dimensions[dim].insights.push({
        id: r.get('id') as string,
        title: r.get('title') as string,
        body: r.get('body') as string,
        source: r.get('source') as string,
        pinned: Boolean(r.get('pinned')),
        eventIds: (r.get('eventIds') as string[]).filter(Boolean),
      });
    }

    return {
      customer: { id: customerId, name, company },
      dimensions,
      systems: systemsRes.records.map((r) => ({
        id: r.get('id') as string,
        name: r.get('name') as string,
      })),
      contacts: contactsRes.records.map((r) => ({
        id: r.get('id') as string,
        name: r.get('name') as string,
        title: (r.get('title') as string | null) ?? undefined,
      })),
      notes: notesRes.records.map((r) => ({
        id: r.get('id') as string,
        title: r.get('title') as string,
        body: r.get('body') as string,
        kind: r.get('kind') as string,
        targetType: (r.get('targetType') as string | null) ?? 'Customer',
        targetId: (r.get('targetId') as string | null) ?? customerId,
        currentVersion: Number(r.get('currentVersion') ?? 1),
      })),
      eventCount: Number(eventsRes.records[0]?.get('c') ?? 0),
    };
  });
}

export async function createPortraitVersion(opts: {
  customerId: string;
  message: string;
  reason: VersionReason;
  createdBy: string;
  /** 若提供则不从库内重建，直接使用（恢复历史版本） */
  snapshot?: PortraitSnapshot;
}): Promise<{ number: number; id: string } | null> {
  const snapshot = opts.snapshot ?? (await buildPortraitSnapshot(opts.customerId));
  if (!snapshot) return null;

  return withWriteTx(async (tx) => {
    await tx.run(
      `MERGE (c:Customer {id: $customerId})
       MERGE (c)-[:HAS_PORTRAIT]->(p:Portrait {customerId: $customerId})`,
      { customerId: opts.customerId },
    );
    const head = await tx.run(
      `MATCH (p:Portrait {customerId: $customerId})
       OPTIONAL MATCH (p)-[:HEAD]->(h:PortraitVersion)
       RETURN h.number AS n`,
      { customerId: opts.customerId },
    );
    const parentNumber = head.records[0]?.get('n');
    const number = parentNumber == null ? 1 : Number(parentNumber) + 1;
    const id = randomUUID();

    await tx.run(
      `MATCH (p:Portrait {customerId: $customerId})
       CREATE (v:PortraitVersion {
         id: $id,
         customerId: $customerId,
         number: $number,
         message: $message,
         reason: $reason,
         parentNumber: $parentNumber,
         snapshot: $snapshot,
         createdAt: datetime(),
         createdBy: $createdBy
       })
       MERGE (p)-[:HAS_VERSION]->(v)
       WITH p, v
       OPTIONAL MATCH (p)-[old:HEAD]->()
       DELETE old
       MERGE (p)-[:HEAD]->(v)
       SET p.currentVersionId = $id,
           p.currentVersion = $number,
           p.lastRecomputedAt = CASE WHEN $reason = 'llm' THEN datetime() ELSE p.lastRecomputedAt END,
           p.lastEventCount = CASE WHEN $reason IN ['event','llm','restore'] THEN $eventCount ELSE p.lastEventCount END`,
      {
        customerId: opts.customerId,
        id,
        number,
        message: opts.message,
        reason: opts.reason,
        parentNumber: parentNumber == null ? null : Number(parentNumber),
        snapshot: JSON.stringify(snapshot),
        createdBy: opts.createdBy,
        eventCount: snapshot.eventCount,
      },
    );

    return { number, id };
  });
}

export async function listPortraitVersions(customerId: string) {
  return withReadTx(async (tx) => {
    const res = await tx.run(
      `MATCH (p:Portrait {customerId: $customerId})-[:HAS_VERSION]->(v:PortraitVersion)
       OPTIONAL MATCH (p)-[:HEAD]->(h:PortraitVersion)
       RETURN v.id AS id, v.number AS number, v.message AS message, v.reason AS reason,
              v.parentNumber AS parentNumber, v.createdAt AS createdAt, v.createdBy AS createdBy,
              CASE WHEN h.id = v.id THEN true ELSE false END AS isHead
       ORDER BY v.number DESC`,
      { customerId },
    );
    return res.records.map((r) => ({
      id: r.get('id') as string,
      number: Number(r.get('number')),
      message: r.get('message') as string,
      reason: r.get('reason') as string,
      parentNumber: r.get('parentNumber') == null ? null : Number(r.get('parentNumber')),
      createdAt: String(r.get('createdAt') ?? ''),
      createdBy: (r.get('createdBy') as string) ?? '',
      isHead: Boolean(r.get('isHead')),
    }));
  });
}

export async function getPortraitVersion(customerId: string, number: number) {
  return withReadTx(async (tx) => {
    const res = await tx.run(
      `MATCH (v:PortraitVersion {customerId: $customerId, number: $number})
       RETURN v.id AS id, v.number AS number, v.message AS message, v.reason AS reason,
              v.parentNumber AS parentNumber, v.createdAt AS createdAt, v.createdBy AS createdBy,
              v.snapshot AS snapshot`,
      { customerId, number },
    );
    const r = res.records[0];
    if (!r) return null;
    return {
      id: r.get('id') as string,
      number: Number(r.get('number')),
      message: r.get('message') as string,
      reason: r.get('reason') as string,
      parentNumber: r.get('parentNumber') == null ? null : Number(r.get('parentNumber')),
      createdAt: String(r.get('createdAt') ?? ''),
      createdBy: (r.get('createdBy') as string) ?? '',
      snapshot: JSON.parse(r.get('snapshot') as string) as PortraitSnapshot,
    };
  });
}

export type SnapshotDiff = {
  dimensions: {
    key: PortraitDimensionKey;
    added: string[];
    removed: string[];
    changed: string[];
  }[];
  systemsAdded: string[];
  systemsRemoved: string[];
  notesAdded: string[];
  notesChanged: string[];
  notesRemoved: string[];
  eventCount: { from: number; to: number };
};

function insightKey(i: SnapshotInsight) {
  return `${i.title}::${i.body}`;
}

/** Apply a historical snapshot onto the live graph (used by restore). */
export async function applyPortraitSnapshot(
  customerId: string,
  snapshot: PortraitSnapshot,
  createdBy: string,
) {
  await withWriteTx(async (tx) => {
    await tx.run(
      `MATCH (i:Insight {customerId: $id, status: 'active'})
       SET i.status = 'retired'`,
      { id: customerId },
    );

    for (const key of DIMENSION_KEYS) {
      for (const ins of snapshot.dimensions[key]?.insights ?? []) {
        await tx.run(
          `CREATE (i:Insight {
            id: randomUUID(),
            customerId: $customerId,
            dimension: $dimension,
            title: $title,
            body: $body,
            source: 'human',
            status: 'active',
            pinned: $pinned,
            restoredFromInsightId: $oldId,
            createdAt: datetime(),
            createdBy: $createdBy
          })
          WITH i
          MATCH (c:Customer {id: $customerId})
          MERGE (i)-[:ABOUT]->(c)`,
          {
            customerId,
            dimension: key,
            title: ins.title,
            body: ins.body,
            pinned: ins.pinned,
            oldId: ins.id,
            createdBy,
          },
        );
      }
    }

    for (const sys of snapshot.systems) {
      await tx.run(
        `MERGE (s:System {name: $name})
         ON CREATE SET s.id = coalesce($id, randomUUID())
         WITH s
         MATCH (c:Customer {id: $customerId})
         MERGE (c)-[:HAS_SYSTEM]->(s)`,
        { name: sys.name, id: sys.id, customerId },
      );
    }
    for (const ct of snapshot.contacts) {
      await tx.run(
        `MERGE (c:Contact {name: $name})
         ON CREATE SET c.id = coalesce($id, randomUUID())
         SET c.title = coalesce($title, c.title)
         WITH c
         MATCH (cu:Customer {id: $customerId})
         MERGE (cu)-[:HAS_CONTACT]->(c)`,
        { name: ct.name, id: ct.id, title: ct.title ?? null, customerId },
      );
    }

    for (const note of snapshot.notes) {
      const exists = await tx.run(`MATCH (n:Note {id: $id}) RETURN n LIMIT 1`, { id: note.id });
      if (exists.records.length === 0) {
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
            version: 1, title: $title, body: $body, createdAt: datetime(), createdBy: $createdBy
          })
          MERGE (n)-[:HAS_VERSION]->(v)
          WITH n
          MATCH (cu:Customer {id: $customerId})
          MERGE (n)-[:ON_CUSTOMER]->(cu)`,
          {
            id: note.id,
            customerId,
            kind: note.kind,
            title: note.title,
            body: note.body,
            createdBy,
          },
        );
      } else {
        await tx.run(
          `MATCH (n:Note {id: $id})
           OPTIONAL MATCH (n)-[:HAS_VERSION]->(v:NoteVersion)
           WITH n, coalesce(max(v.version), 0) AS maxV
           CREATE (nv:NoteVersion {
             version: maxV + 1,
             title: $title,
             body: $body,
             createdAt: datetime(),
             createdBy: $createdBy
           })
           MERGE (n)-[:HAS_VERSION]->(nv)
           SET n.currentVersion = maxV + 1`,
          { id: note.id, title: note.title, body: note.body, createdBy },
        );
      }
    }
  });
}

export function diffSnapshots(from: PortraitSnapshot, to: PortraitSnapshot): SnapshotDiff {
  const dimensions = DIMENSION_KEYS.map((key) => {
    const a = from.dimensions[key]?.insights ?? [];
    const b = to.dimensions[key]?.insights ?? [];
    const mapA = new Map(a.map((i) => [i.id, insightKey(i)]));
    const mapB = new Map(b.map((i) => [i.id, insightKey(i)]));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const [id, k] of mapB) {
      if (!mapA.has(id)) added.push(k);
      else if (mapA.get(id) !== k) changed.push(k);
    }
    for (const [id, k] of mapA) {
      if (!mapB.has(id)) removed.push(k);
    }
    return { key, added, removed, changed };
  });

  const sysA = new Map(from.systems.map((s) => [s.id, s.name]));
  const sysB = new Map(to.systems.map((s) => [s.id, s.name]));
  const systemsAdded = [...sysB.entries()].filter(([id]) => !sysA.has(id)).map(([, n]) => n);
  const systemsRemoved = [...sysA.entries()].filter(([id]) => !sysB.has(id)).map(([, n]) => n);

  const noteA = new Map(
    from.notes.map((n) => [n.id, `${n.title}::${n.body}`]),
  );
  const noteB = new Map(to.notes.map((n) => [n.id, `${n.title}::${n.body}`]));
  const notesAdded = [...noteB.entries()].filter(([id]) => !noteA.has(id)).map(([, v]) => v);
  const notesRemoved = [...noteA.entries()].filter(([id]) => !noteB.has(id)).map(([, v]) => v);
  const notesChanged: string[] = [];
  for (const [id, v] of noteB) {
    const prev = noteA.get(id);
    if (prev && prev !== v) notesChanged.push(v);
  }

  return {
    dimensions,
    systemsAdded,
    systemsRemoved,
    notesAdded,
    notesChanged,
    notesRemoved,
    eventCount: { from: from.eventCount, to: to.eventCount },
  };
}
