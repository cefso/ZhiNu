import { getAppSettings, type AppSettings } from './services/settings.js';

export type LlmInsightDraft = {
  dimension: string;
  title: string;
  body: string;
  eventIds?: string[];
  mentionSystems?: string[];
  mentionContacts?: string[];
};

export type LlmRecomputeResult = {
  insights: LlmInsightDraft[];
  systems?: { name: string; note?: string }[];
  contacts?: { name: string; title?: string }[];
};

export type LlmInput = {
  customerName: string;
  company?: string;
  events: { id: string; title: string; content: string; occurredAt: string }[];
  existingInsights: { dimension: string; title: string; body: string }[];
  systems: { name: string }[];
  contacts: { name: string; title?: string }[];
  notes: { title: string; body: string }[];
};

const DIMENSIONS = [
  'profile',
  'business',
  'systems',
  'service',
  'communication',
  'risk',
  'notes',
] as const;

function buildPrompt(input: LlmInput): string {
  return `你是客户画像分析助手。根据工作记录提炼新的客户洞察。只输出 JSON。

客户：${input.customerName}${input.company ? `（${input.company}）` : ''}

已知系统：${input.systems.map((s) => s.name).join('、') || '无'}
已知联系人：${input.contacts.map((c) => `${c.name}${c.title ? `(${c.title})` : ''}`).join('、') || '无'}
已有备注摘要：
${input.notes.map((n) => `- ${n.title}: ${n.body}`).join('\n') || '无'}

已有洞察（避免简单重复，可补充或给出更新视角）：
${input.existingInsights.map((i) => `[${i.dimension}] ${i.title}: ${i.body}`).join('\n') || '无'}

有效工作记录：
${input.events.map((e) => `id=${e.id} | ${e.occurredAt} | ${e.title}\n${e.content}`).join('\n\n') || '无'}

请输出 JSON，结构：
{
  "insights": [
    {
      "dimension": "profile|business|systems|service|communication|risk|notes",
      "title": "简短标题",
      "body": "一两段中文结论",
      "eventIds": ["支持该结论的记录id"],
      "mentionSystems": ["系统名"],
      "mentionContacts": ["联系人名"]
    }
  ],
  "systems": [{"name": "CRM", "note": "可选"}],
  "contacts": [{"name": "张三", "title": "可选"}]
}

要求：
- dimension 必须属于上述七维
- 优先输出有信息增量的洞察，通常 1-6 条
- body 用中文，具体、可操作，不要空话
- 若记录很少，仍可输出保守洞察
- 不要输出 Markdown 代码块以外的内容`;
}

export async function recomputeWithLlm(
  input: LlmInput,
  config?: AppSettings,
): Promise<LlmRecomputeResult> {
  const cfg = config ?? (await getAppSettings());
  if (!cfg.llmApiKey) {
    throw new LlmError('未配置 LLM API Key（请在设置页配置）');
  }
  const url = `${cfg.llmBaseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.llmApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.llmModel,
      temperature: cfg.temperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你只输出合法 JSON 对象。',
        },
        {
          role: 'user',
          content: buildPrompt(input),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('LLM empty response');

  let parsed: LlmRecomputeResult;
  try {
    parsed = JSON.parse(content) as LlmRecomputeResult;
  } catch {
    throw new LlmError('LLM returned non-JSON');
  }

  const insights = (parsed.insights ?? [])
    .filter((i) => (DIMENSIONS as readonly string[]).includes(i.dimension))
    .map((i) => ({
      dimension: i.dimension,
      title: String(i.title ?? '').slice(0, 120),
      body: String(i.body ?? ''),
      eventIds: Array.isArray(i.eventIds) ? i.eventIds.filter(Boolean).map(String) : [],
      mentionSystems: Array.isArray(i.mentionSystems) ? i.mentionSystems.map(String) : [],
      mentionContacts: Array.isArray(i.mentionContacts) ? i.mentionContacts.map(String) : [],
    }))
    .filter((i) => i.title && i.body);

  return {
    insights,
    systems: (parsed.systems ?? []).filter((s) => s?.name).map((s) => ({
      name: String(s.name),
      note: s.note ? String(s.note) : undefined,
    })),
    contacts: (parsed.contacts ?? []).filter((c) => c?.name).map((c) => ({
      name: String(c.name),
      title: c.title ? String(c.title) : undefined,
    })),
  };
}

export class LlmError extends Error {}
