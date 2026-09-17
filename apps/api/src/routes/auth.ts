import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withWriteTx, withReadTx } from '../neo4j.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { env } from '../env.js';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/bootstrap', async () => {
    return withWriteTx(async (tx) => {
      const existing = await tx.run(`MATCH (u:User) RETURN count(u) AS c`);
      const n = Number(existing.records[0]?.get('c') ?? 0);
      if (n > 0) return { bootstrapped: true };
      const hash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
      await tx.run(
        `CREATE (u:User {
          id: $id,
          email: $email,
          passwordHash: $hash,
          name: 'Admin',
          role: 'admin',
          createdAt: datetime()
        })`,
        { id: randomUUID(), email: env.ADMIN_EMAIL, hash },
      );
      return { bootstrapped: true, seededAdmin: env.ADMIN_EMAIL };
    });
  });

  app.post('/register', async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        inviteCode: z.string().min(1),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid body', details: body.error.flatten() });
    }
    const { email, password, inviteCode } = body.data;

    try {
      const user = await withWriteTx(async (tx) => {
        const invite = await tx.run(
          `MATCH (i:Invite {code: $code, used: false})
           RETURN i.role AS role`,
          { code: inviteCode },
        );
        const role = invite.records[0]?.get('role') as string | undefined;
        if (!role) return null;

        const dup = await tx.run(`MATCH (u:User {email: $email}) RETURN u LIMIT 1`, { email });
        if (dup.records.length > 0) return { conflict: true as const };

        const consumed = await tx.run(
          `MATCH (i:Invite {code: $code, used: false})
           SET i.used = true
           RETURN i.role AS role`,
          { code: inviteCode },
        );
        if (consumed.records.length === 0) return null;

        const id = randomUUID();
        const hash = await bcrypt.hash(password, 10);
        await tx.run(
          `CREATE (u:User {
            id: $id,
            email: $email,
            passwordHash: $hash,
            name: $name,
            role: $role,
            createdAt: datetime()
          })`,
          {
            id,
            email,
            hash,
            name: email.split('@')[0],
            role: role === 'admin' ? 'admin' : 'member',
          },
        );
        return { id, email, role: role === 'admin' ? ('admin' as const) : ('member' as const) };
      });

      if (!user) return reply.code(400).send({ error: 'Invalid invite code' });
      if ('conflict' in user) return reply.code(409).send({ error: 'Email already registered' });

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.email = user.email;
      return { user };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Register failed' });
    }
  });

  app.post('/login', async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body' });
    }
    const { email, password } = parsed.data;
    const record = await withReadTx(async (tx) => {
      const result = await tx.run(
        `MATCH (u:User {email: $email})
         RETURN u.id AS id, u.passwordHash AS passwordHash, u.role AS role, u.name AS name`,
        { email },
      );
      return result.records[0]
        ? {
            id: result.records[0].get('id') as string,
            passwordHash: result.records[0].get('passwordHash') as string,
            role: result.records[0].get('role') as 'admin' | 'member',
            name: result.records[0].get('name') as string,
          }
        : null;
    });

    if (!record) return reply.code(401).send({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, record.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'Invalid credentials' });

    req.session.userId = record.id;
    req.session.role = record.role;
    req.session.email = email;
    return { user: { id: record.id, email, role: record.role, name: record.name } };
  });

  app.post('/logout', async (req) => {
    await req.session.destroy();
    return { ok: true };
  });

  app.get('/me', async (req, reply) => {
    const user = requireAuth(req, reply);
    if (!user) return;
    return { user };
  });
}

export async function inviteRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const parsed = z
      .object({ role: z.enum(['admin', 'member']).default('member') })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const code = randomUUID().replace(/-/g, '').slice(0, 16);
    await withWriteTx(async (tx) => {
      await tx.run(
        `CREATE (i:Invite {
          code: $code,
          role: $role,
          used: false,
          createdBy: $createdBy,
          createdAt: datetime()
        })`,
        { code, role: parsed.data.role, createdBy: admin.userId },
      );
    });
    return { code, role: parsed.data.role };
  });
}
