import { withSession } from './neo4j.js';

type SessionCb = (err: unknown, session?: unknown) => void;
type VoidCb = (err?: unknown) => void;

/**
 * express-session style store backed by Neo4j.
 * Callback API required by @fastify/session; survives API restarts.
 */
export class Neo4jSessionStore {
  private prefix: string;

  constructor(prefix = 'sess:') {
    this.prefix = prefix;
  }

  get(sid: string, cb: SessionCb): void {
    withSession(async (session) => {
      const res = await session.run(
        `MATCH (s:HttpSession {sid: $sid})
         WHERE s.expiresAt > datetime()
         RETURN s.data AS data`,
        { sid: `${this.prefix}${sid}` },
      );
      const data = res.records[0]?.get('data') as string | null;
      if (!data) return null;
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
      .then((session) => cb(null, session ?? undefined))
      .catch((err) => cb(err));
  }

  set(sid: string, session: any, cb?: VoidCb): void {
    const json = JSON.stringify(session);
    const cookie = session?.cookie ?? {};
    const maxAgeMs =
      typeof cookie.maxAge === 'number' && cookie.maxAge > 0
        ? cookie.maxAge
        : cookie.expires
          ? new Date(cookie.expires).getTime() - Date.now()
          : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + Math.max(maxAgeMs, 60_000)).toISOString();

    withSession(async (ns) => {
      await ns.run(
        `MERGE (s:HttpSession {sid: $sid})
         SET s.data = $data,
             s.expiresAt = datetime($expiresAt),
             s.updatedAt = datetime()`,
        { sid: `${this.prefix}${sid}`, data: json, expiresAt },
      );
    })
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  destroy(sid: string, cb?: VoidCb): void {
    withSession(async (ns) => {
      await ns.run(`MATCH (s:HttpSession {sid: $sid}) DELETE s`, {
        sid: `${this.prefix}${sid}`,
      });
    })
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  touch(sid: string, session: any, cb?: VoidCb): void {
    this.set(sid, session, cb);
  }

  async pruneExpired(): Promise<number> {
    return withSession(async (ns) => {
      const res = await ns.run(
        `MATCH (s:HttpSession) WHERE s.expiresAt <= datetime()
         WITH s LIMIT 500
         DELETE s
         RETURN count(*) AS c`,
      );
      return Number(res.records[0]?.get('c') ?? 0);
    });
  }
}
