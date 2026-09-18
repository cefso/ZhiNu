import { getAppSettings, type AppSettings } from './services/settings.js';
import {
  classifyByRules,
  normalizeClassifyPayload,
  type ClassifyInput,
  type ClassifyResult,
} from './services/classify.js';
import {
  SERVICE_DOMAINS,
  SERVICE_TYPES,
  type CustomerProfile,
  type ServiceInsight,
} from '@zhinu/shared';

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

function buildClassifyPrompt(input: ClassifyInput): string {
  const domainKeys = SERVICE_DOMAINS.map((d) => d.key).join('|');
  const typeKeys = SERVICE_TYPES.map((t) => t.key).join('|');
  return `你是 MSP 服务记录分类助手。根据标题与内容分类一条运维服务记录。只输出 JSON。

标题：${input.title}
内容：${input.content ?? ''}
关联系统：${(input.systemNames ?? []).join('、') || '无'}

可选 domain：${domainKeys}
可选 serviceType：${typeKeys}
techs：技术标签数组，使用规范名（如 MySQL、Kubernetes、Nginx）

输出：
{"domain":"...","serviceType":"...","techs":["..."],"confidence":0.0-1.0}

domain 必须是上述枚举之一；不确定时用 other。`;
}

function buildServiceInsightPrompt(profile: CustomerProfile, recentTitles: string[]): string {
  const company = profile.customer.company ? `（${profile.customer.company}）` : '';
  const domainLine = profile.domains
    .map((d) => `${d.label} ${d.count}次(${Math.round(d.share * 100)}%)`)
    .join('；');
  const typeLine = profile.serviceTypes.map((d) => `${d.label} ${d.count}次`).join('；');
  const techLine = profile.techs
    .slice(0, 8)
    .map((t) => `${t.name}(${t.count})`)
    .join('、');
  const deltaLine = profile.trend.deltas
    .map((d) => `${d.domain} ${d.previous}→${d.current} (${d.changePct}%)`)
    .join('；');
  const titleLine = recentTitles.map((t) => `- ${t}`).join('\n');
  return `你是 MSP 客户运维画像助手。根据服务行为指标写客户洞察。只输出 JSON。

客户：${profile.customer.name}${company}

服务概况：
- 总服务次数：${profile.summary.serviceCount}
- 已分类：${profile.summary.classifiedCount}
- 服务周期（月）：${profile.summary.spanMonths}
- 活跃度：${profile.summary.activityLevel}

领域构成：${domainLine}
服务类型：${typeLine}
技术 Top：${techLine}
特征指标：频率${profile.traits.serviceFrequency}、故障依赖${profile.traits.faultDependency}、变更活跃${profile.traits.changeActivity}、咨询依赖${profile.traits.consultDependency}
规则标签：${profile.traits.labels.join('、')}
近90天服务：${profile.trend.current.total}，前90天：${profile.trend.previous.total}
领域变化：${deltaLine}

近期服务标题示例：
${titleLine}

输出 JSON：
{
  "narrative": ["2-4段中文，每段一两句话"],
  "characteristics": ["3-6条客户特征"],
  "archetype": "客户画像标题",
  "caveats": ["说明这是从服务行为推断"]
}

措辞要求：使用「可能」「推测」「较高」「显示」等推断语气，不要把推断写成客户申报事实。`;
}

async function callLlm(cfg: AppSettings, prompt: string): Promise<unknown> {
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
        { role: 'system', content: '你只输出合法 JSON 对象。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('LLM empty response');
  try {
    return JSON.parse(content);
  } catch {
    throw new LlmError('LLM returned non-JSON');
  }
}

export async function recomputeWithLlm(
  input: LlmInput,
  config?: AppSettings,
): Promise<LlmRecomputeResult> {
  const cfg = config ?? (await getAppSettings());
  const parsed = (await callLlm(cfg, buildPrompt(input))) as LlmRecomputeResult;

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
    systems: (parsed.systems ?? [])
      .filter((s) => s?.name)
      .map((s) => ({
        name: String(s.name),
        note: s.note ? String(s.note) : undefined,
      })),
    contacts: (parsed.contacts ?? [])
      .filter((c) => c?.name)
      .map((c) => ({
        name: String(c.name),
        title: c.title ? String(c.title) : undefined,
      })),
  };
}

export async function classifyWithLlm(
  input: ClassifyInput,
  config?: AppSettings,
): Promise<ClassifyResult> {
  const cfg = config ?? (await getAppSettings());
  if (!cfg.llmApiKey) {
    return classifyByRules(input);
  }
  try {
    const parsed = (await callLlm(cfg, buildClassifyPrompt(input))) as {
      domain?: string;
      serviceType?: string;
      techs?: unknown;
      confidence?: number;
    };
    return normalizeClassifyPayload(parsed);
  } catch {
    // Offline / bad key / non-JSON: fall back to deterministic keyword rules
    return classifyByRules(input);
  }
}

export async function serviceInsightsWithLlm(
  profile: CustomerProfile,
  recentTitles: string[],
  config?: AppSettings,
): Promise<ServiceInsight> {
  const cfg = config ?? (await getAppSettings());
  if (!cfg.llmApiKey) {
    throw new LlmError('未配置 LLM API Key（请在设置页配置）');
  }
  const parsed = (await callLlm(cfg, buildServiceInsightPrompt(profile, recentTitles))) as {
    narrative?: unknown;
    characteristics?: unknown;
    archetype?: unknown;
    caveats?: unknown;
  };
  const narrative = Array.isArray(parsed.narrative) ? parsed.narrative.map(String) : [];
  const characteristics = Array.isArray(parsed.characteristics) ? parsed.characteristics.map(String) : [];
  const caveats = Array.isArray(parsed.caveats) && parsed.caveats.length
    ? parsed.caveats.map(String)
    : ['画像由服务行为推断，非客户申报事实'];
  return {
    narrative,
    characteristics,
    archetype: String(parsed.archetype ?? profile.archetype.title),
    caveats,
    generatedAt: new Date().toISOString(),
    source: 'llm',
  };
}

export function ruleServiceInsights(profile: CustomerProfile): ServiceInsight {
  const topDomain = profile.domains[0];
  const trend = profile.trend.deltas[0];
  const narrative: string[] = [
    `该客户累计服务 ${profile.summary.serviceCount} 次，服务周期约 ${profile.summary.spanMonths} 个月，活跃度为 ${profile.summary.activityLevel}。`,
    topDomain
      ? `其中${topDomain.label}相关服务占比约 ${Math.round(topDomain.share * 100)}%，可能是最主要的服务领域。`
      : '当前分类数据较少，领域构成尚不清晰。',
    trend
      ? `近 90 天与前 90 天相比，${domainLabelSafe(trend.domain)} 变化 ${trend.changePct}%（${trend.previous}→${trend.current}），可能反映客户侧相关需求变化。`
      : '近期与前期服务量对比暂无显著领域变化。',
  ];
  return {
    narrative,
    characteristics: profile.traits.labels,
    archetype: profile.archetype.title,
    caveats: ['画像由服务行为推断，非客户申报事实', '当前为规则推导结果，未调用 LLM'],
    generatedAt: new Date().toISOString(),
    source: 'rule',
  };
}

function domainLabelSafe(key: string): string {
  return SERVICE_DOMAINS.find((d) => d.key === key)?.label ?? key;
}

export class LlmError extends Error {}
