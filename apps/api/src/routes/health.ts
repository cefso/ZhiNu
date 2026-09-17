import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, service: 'zhinu-api' }));
}
