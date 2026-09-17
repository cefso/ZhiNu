import { withReadTx, withWriteTx } from '../neo4j.js';
import { env } from '../env.js';

export type AppSettings = {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  temperature: number;
};

const DEFAULTS = (): AppSettings => ({
  llmBaseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
  llmApiKey: env.LLM_API_KEY || '',
  llmModel: env.LLM_MODEL || 'gpt-4o-mini',
  temperature: 0.3,
});

/** Public view: API key masked */
export function maskKey(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await withReadTx(async (tx) => {
    const res = await tx.run(
      `MATCH (s:AppSettings {id: 'singleton'})
       RETURN s.llmBaseUrl AS llmBaseUrl, s.llmApiKey AS llmApiKey,
              s.llmModel AS llmModel, s.temperature AS temperature`,
    );
    const r = res.records[0];
    if (!r) return null;
    return {
      llmBaseUrl: (r.get('llmBaseUrl') as string) || DEFAULTS().llmBaseUrl,
      llmApiKey: (r.get('llmApiKey') as string) ?? '',
      llmModel: (r.get('llmModel') as string) || DEFAULTS().llmModel,
      temperature: Number(r.get('temperature') ?? 0.3),
    };
  });
  return stored ?? DEFAULTS();
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
  updatedBy: string,
): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = {
    llmBaseUrl: patch.llmBaseUrl ?? current.llmBaseUrl,
    llmApiKey: patch.llmApiKey !== undefined ? patch.llmApiKey : current.llmApiKey,
    llmModel: patch.llmModel ?? current.llmModel,
    temperature:
      patch.temperature !== undefined && Number.isFinite(patch.temperature)
        ? patch.temperature
        : current.temperature,
  };

  await withWriteTx(async (tx) => {
    await tx.run(
      `MERGE (s:AppSettings {id: 'singleton'})
       SET s.llmBaseUrl = $llmBaseUrl,
           s.llmApiKey = $llmApiKey,
           s.llmModel = $llmModel,
           s.temperature = $temperature,
           s.updatedAt = datetime(),
           s.updatedBy = $updatedBy`,
      { ...next, updatedBy },
    );
  });

  return next;
}

export async function testLlmConnection(settings?: AppSettings) {
  const cfg = settings ?? (await getAppSettings());
  if (!cfg.llmApiKey) {
    return { ok: false as const, error: '未配置 API Key' };
  }
  const url = `${cfg.llmBaseUrl.replace(/\/$/, '')}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.llmApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llmModel,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false as const, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { model?: string };
    return { ok: true as const, model: data.model ?? cfg.llmModel };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : '连接失败' };
  }
}
