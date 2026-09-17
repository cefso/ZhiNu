import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  createPortraitVersion,
  diffSnapshots,
  getPortraitVersion,
  listPortraitVersions,
} from '../services/versions.js';

export async function versionRoutes(app: FastifyInstance) {
  app.get('/customers/:id/versions', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const versions = await listPortraitVersions(id);
    return { versions };
  });

  app.get('/customers/:id/versions/:number', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id, number } = req.params as { id: string; number: string };
    const version = await getPortraitVersion(id, Number(number));
    if (!version) return reply.code(404).send({ error: 'Version not found' });
    return { version };
  });

  app.get('/customers/:id/versions/:number/diff', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id, number } = req.params as { id: string; number: string };
    const q = z
      .object({ with: z.string().default('head') })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Invalid query' });

    const base = await getPortraitVersion(id, Number(number));
    if (!base) return reply.code(404).send({ error: 'Version not found' });

    let other = null as Awaited<ReturnType<typeof getPortraitVersion>>;
    let otherLabel = '';
    if (q.data.with === 'head') {
      const list = await listPortraitVersions(id);
      const headNum = list.find((v) => v.isHead)?.number;
      if (headNum == null) return reply.code(404).send({ error: 'No HEAD' });
      other = await getPortraitVersion(id, headNum);
      otherLabel = `HEAD v${headNum}`;
    } else if (q.data.with === 'parent') {
      if (base.parentNumber == null) {
        return reply.code(400).send({ error: 'No parent version' });
      }
      other = await getPortraitVersion(id, base.parentNumber);
      otherLabel = `parent v${base.parentNumber}`;
    } else {
      other = await getPortraitVersion(id, Number(q.data.with));
      otherLabel = `v${q.data.with}`;
    }
    if (!other) return reply.code(404).send({ error: 'Compare version not found' });

    const diff = diffSnapshots(base.snapshot, other.snapshot);
    return {
      from: { number: base.number, message: base.message },
      to: { number: other.number, message: other.message, label: otherLabel },
      diff,
    };
  });

  app.post('/customers/:id/versions/:number/restore', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id, number } = req.params as { id: string; number: string };
    const target = await getPortraitVersion(id, Number(number));
    if (!target) return reply.code(404).send({ error: 'Version not found' });

    const created = await createPortraitVersion({
      customerId: id,
      message: `恢复至 v${target.number}`,
      reason: 'restore',
      createdBy: auth.userId,
      snapshot: target.snapshot,
    });
    if (!created) return reply.code(404).send({ error: 'Customer not found' });
    return { version: created, restoredFrom: target.number };
  });
}
