const DEFAULT_SESSION_SECRET = 'zhinu-dev-session-secret-change-in-prod-32+';
const DEFAULT_NEO4J_PASSWORD = process.env.NODE_ENV === 'test' ? '' : 'zhinu-dev-password';

/** @fastify/session requires secret length >= 32 */
export function normalizeSessionSecret(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value.length >= 32) return value;
  if (value.length === 0) return DEFAULT_SESSION_SECRET;
  return value.padEnd(32, '·zhinu·session·pad');
}

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  SESSION_SECRET: normalizeSessionSecret(process.env.SESSION_SECRET),
  NEO4J_URI: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  NEO4J_USER: process.env.NEO4J_USER ?? 'neo4j',
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD ?? DEFAULT_NEO4J_PASSWORD,
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  LLM_API_KEY: process.env.LLM_API_KEY ?? '',
  LLM_MODEL: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@zhinu.local',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'change-me-admin',
};
