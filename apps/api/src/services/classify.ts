import {
  normalizeDomain,
  normalizeServiceType,
  normalizeTech,
  SERVICE_DOMAINS,
  SERVICE_TYPES,
  type ServiceDomain,
  type ServiceType,
} from '@zhinu/shared';

export type ClassifyInput = {
  title: string;
  content?: string;
  systemNames?: string[];
};

export type ClassifyResult = {
  domain: ServiceDomain | 'other';
  serviceType?: ServiceType;
  techs: string[];
  confidence: number;
  source: 'llm' | 'rule' | 'human';
};

const RULE_MAP: { domain: ServiceDomain; serviceType?: ServiceType; techs: string[]; keywords: string[] }[] = [
  {
    domain: 'database',
    serviceType: 'incident',
    techs: ['MySQL'],
    keywords: ['mysql', '慢查询', '数据库', 'postgres', 'oracle', 'sql server', 'mongodb'],
  },
  {
    domain: 'cache',
    serviceType: 'change',
    techs: ['Redis'],
    keywords: ['redis', 'memcached', '缓存'],
  },
  {
    domain: 'container',
    techs: ['Kubernetes'],
    keywords: ['k8s', 'kubernetes', 'docker', 'pod', 'ingress', '容器', 'helm'],
  },
  {
    domain: 'web',
    techs: ['Nginx'],
    keywords: ['nginx', '502', '503', 'https', 'apache', '反向代理'],
  },
  {
    domain: 'server',
    techs: ['Linux'],
    keywords: ['服务器', '扩容', 'linux', 'windows server', 'vmware', '磁盘', '内存'],
  },
  {
    domain: 'app',
    techs: ['Java'],
    keywords: ['java', '发布', '部署', '应用', 'node', 'ci/cd', '上线'],
  },
  {
    domain: 'security',
    techs: [],
    keywords: ['安全', '加固', '漏洞', '等保', '堡垒机'],
  },
  {
    domain: 'network',
    techs: [],
    keywords: ['网络', '防火墙', 'vpn', '负载均衡'],
  },
  {
    domain: 'middleware',
    techs: [],
    keywords: ['kafka', 'rabbitmq', 'tomcat', '中间件'],
  },
];

function detectType(text: string): ServiceType | undefined {
  const t = text.toLowerCase();
  if (/(故障|宕机|不可用|报警|告警|502|503|down|incident)/.test(t)) return 'incident';
  if (/(变更|修改|扩容|升级|配置|发布|上线|deploy|变更)/.test(t)) return 'change';
  if (/(咨询|方案|评估|答疑)/.test(t)) return 'consult';
  if (/(项目|实施|迁移)/.test(t)) return 'project';
  if (/(巡检|例行|日常|监控)/.test(t)) return 'routine';
  return undefined;
}

export function classifyByRules(input: ClassifyInput): ClassifyResult {
  const text = `${input.title}\n${input.content ?? ''}\n${(input.systemNames ?? []).join(' ')}`.toLowerCase();
  const hits = RULE_MAP.filter((r) => r.keywords.some((k) => text.includes(k)));
  const primary = hits[0];
  const techs = new Set<string>();
  for (const h of hits) h.techs.forEach((t) => techs.add(t));
  (input.systemNames ?? []).forEach((n) => {
    const n2 = normalizeTech(n);
    if (n2) techs.add(n2);
  });
  const serviceType = detectType(text) ?? primary?.serviceType;
  return {
    domain: primary?.domain ?? 'other',
    serviceType,
    techs: [...techs],
    confidence: primary ? 0.55 : 0.2,
    source: 'rule',
  };
}

export function normalizeClassifyPayload(raw: {
  domain?: string;
  serviceType?: string;
  techs?: unknown;
  confidence?: number;
}): ClassifyResult {
  const domain = normalizeDomain(raw.domain) ?? 'other';
  const serviceType = normalizeServiceType(raw.serviceType) ?? undefined;
  const techs = Array.isArray(raw.techs)
    ? raw.techs.map((t) => normalizeTech(String(t))).filter(Boolean)
    : [];
  return {
    domain,
    serviceType,
    techs,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.7,
    source: 'llm',
  };
}

export function isValidDomain(v: string): v is ServiceDomain {
  return SERVICE_DOMAINS.some((d) => d.key === v);
}

export function isValidServiceType(v: string): v is ServiceType {
  return SERVICE_TYPES.some((t) => t.key === v);
}

export type LlmClassifyFn = (input: ClassifyInput) => Promise<ClassifyResult>;

/** Prefer LLM; fall back to rules when LLM unavailable/throws. */
export async function classifyServiceRecord(
  input: ClassifyInput,
  llmFn?: LlmClassifyFn,
): Promise<ClassifyResult> {
  if (llmFn) {
    try {
      const result = await llmFn(input);
      if (result && result.domain) {
        return {
          domain: isValidDomain(result.domain) ? result.domain : 'other',
          serviceType: result.serviceType && isValidServiceType(result.serviceType) ? result.serviceType : undefined,
          techs: (result.techs ?? []).map((t) => normalizeTech(String(t))).filter(Boolean),
          confidence: result.confidence ?? 0.7,
          source: result.source === 'human' ? 'human' : 'llm',
        };
      }
    } catch {
      // fall through to rules
    }
  }
  return classifyByRules(input);
}
