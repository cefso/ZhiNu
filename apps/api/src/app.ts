import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { env } from './env.js';
import { closeDriver } from './neo4j.js';
import { authRoutes, inviteRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { eventRoutes } from './routes/events.js';
import { insightRoutes, noteRoutes } from './routes/insights.js';
import { statsRoutes } from './routes/stats.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60,
    },
  });

  app.get('/api/health', async () => ({ ok: true, service: 'zhinu' }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(inviteRoutes, { prefix: '/api/invites' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(customerRoutes, { prefix: '/api/customers' });
  await app.register(eventRoutes, { prefix: '/api/events' });
  await app.register(insightRoutes, { prefix: '/api' });
  await app.register(noteRoutes, { prefix: '/api' });

  app.addHook('onClose', async () => {
    await closeDriver();
  });

  return app;
}
