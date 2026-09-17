import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';

export type SessionUser = {
  userId: string;
  role: 'admin' | 'member';
  email: string;
};

declare module 'fastify' {
  interface Session {
    userId?: string;
    role?: 'admin' | 'member';
    email?: string;
  }
}

export function getSessionUser(req: FastifyRequest): SessionUser | null {
  if (!req.session.userId || !req.session.email || !req.session.role) return null;
  return {
    userId: req.session.userId,
    role: req.session.role,
    email: req.session.email,
  };
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = getSessionUser(req);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = requireAuth(req, reply);
  if (!user) return null;
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'Admin only' });
    return null;
  }
  return user;
}

export { env };
