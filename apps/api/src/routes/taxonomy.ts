import type { FastifyInstance } from 'fastify';
import { taxonomyPayload } from '@zhinu/shared';
import { requireAuth } from '../auth.js';

export async function taxonomyRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return taxonomyPayload();
  });
}
