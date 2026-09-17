import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.js';
import {
  getAppSettings,
  maskKey,
  testLlmConnection,
  updateAppSettings,
} from '../services/settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const s = await getAppSettings();
    return {
      settings: {
        llmBaseUrl: s.llmBaseUrl,
        llmModel: s.llmModel,
        temperature: s.temperature,
        llmApiKeySet: Boolean(s.llmApiKey),
        llmApiKeyMasked: maskKey(s.llmApiKey),
      },
      editable: auth.role === 'admin',
    };
  });

  app.put('/settings', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const parsed = z
      .object({
        llmBaseUrl: z.string().url().optional().or(z.literal('')),
        llmModel: z.string().min(1).max(120).optional(),
        temperature: z.number().min(0).max(2).optional(),
        /** omit or null to keep; empty string clears */
        llmApiKey: z.string().max(400).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const patch = parsed.data;
    const next = await updateAppSettings(
      {
        ...(patch.llmBaseUrl !== undefined && patch.llmBaseUrl !== ''
          ? { llmBaseUrl: patch.llmBaseUrl }
          : {}),
        ...(patch.llmModel !== undefined ? { llmModel: patch.llmModel } : {}),
        ...(patch.temperature !== undefined ? { temperature: patch.temperature } : {}),
        ...(patch.llmApiKey !== undefined && patch.llmApiKey !== null
          ? { llmApiKey: patch.llmApiKey }
          : {}),
      },
      admin.userId,
    );
    return {
      settings: {
        llmBaseUrl: next.llmBaseUrl,
        llmModel: next.llmModel,
        temperature: next.temperature,
        llmApiKeySet: Boolean(next.llmApiKey),
        llmApiKeyMasked: maskKey(next.llmApiKey),
      },
    };
  });

  app.post('/settings/test-llm', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const result = await testLlmConnection();
    if (!result.ok) return reply.code(502).send(result);
    return result;
  });
}
