const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
};

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  SESSION_SECRET: required('SESSION_SECRET'),
  NEO4J_URI: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  NEO4J_USER: process.env.NEO4J_USER ?? 'neo4j',
  NEO4J_PASSWORD: required('NEO4J_PASSWORD'),
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  LLM_API_KEY: process.env.LLM_API_KEY ?? '',
  LLM_MODEL: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@zhinu.local',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'change-me-admin',
};
