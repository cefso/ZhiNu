export type ServiceDomain =
  | 'database'
  | 'container'
  | 'cache'
  | 'server'
  | 'middleware'
  | 'network'
  | 'security'
  | 'web'
  | 'app'
  | 'other';

export type ServiceType = 'incident' | 'routine' | 'change' | 'consult' | 'project';

export type ClassifySource = 'llm' | 'human' | 'seed' | 'rule';

export type ActivityLevel = 'none' | 'low' | 'medium' | 'high';

export const SERVICE_DOMAINS: { key: ServiceDomain; label: string; techs: string[] }[] = [
  {
    key: 'database',
    label: '数据库',
    techs: ['MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', 'MongoDB'],
  },
  { key: 'container', label: '容器 / K8s', techs: ['Kubernetes', 'Docker', 'Helm'] },
  { key: 'cache', label: '缓存', techs: ['Redis', 'Memcached'] },
  { key: 'server', label: '服务器', techs: ['Linux', 'Windows Server', 'VMware'] },
  { key: 'middleware', label: '中间件', techs: ['Kafka', 'RabbitMQ', 'Tomcat', 'Nginx'] },
  { key: 'network', label: '网络', techs: ['防火墙', 'VPN', '负载均衡'] },
  { key: 'security', label: '安全', techs: ['等保', '漏洞修复', '堡垒机'] },
  { key: 'web', label: 'Web 服务', techs: ['Nginx', 'Apache', 'HTTPS'] },
  { key: 'app', label: '应用发布', techs: ['Java', 'Node', 'CI/CD'] },
  { key: 'other', label: '其他', techs: [] },
];

export const SERVICE_TYPES: { key: ServiceType; label: string }[] = [
  { key: 'incident', label: '故障处理' },
  { key: 'routine', label: '日常运维' },
  { key: 'change', label: '变更实施' },
  { key: 'consult', label: '咨询支持' },
  { key: 'project', label: '项目实施' },
];

export const TECH_DICTIONARY: { name: string; domain: ServiceDomain }[] = [
  { name: 'MySQL', domain: 'database' },
  { name: 'PostgreSQL', domain: 'database' },
  { name: 'Oracle', domain: 'database' },
  { name: 'SQL Server', domain: 'database' },
  { name: 'MongoDB', domain: 'database' },
  { name: 'Redis', domain: 'cache' },
  { name: 'Memcached', domain: 'cache' },
  { name: 'Kubernetes', domain: 'container' },
  { name: 'Docker', domain: 'container' },
  { name: 'Helm', domain: 'container' },
  { name: 'Linux', domain: 'server' },
  { name: 'Windows Server', domain: 'server' },
  { name: 'VMware', domain: 'server' },
  { name: 'Kafka', domain: 'middleware' },
  { name: 'RabbitMQ', domain: 'middleware' },
  { name: 'Tomcat', domain: 'middleware' },
  { name: 'Nginx', domain: 'web' },
  { name: 'Apache', domain: 'web' },
  { name: 'HTTPS', domain: 'web' },
  { name: 'Java', domain: 'app' },
  { name: 'Node', domain: 'app' },
  { name: 'CI/CD', domain: 'app' },
  { name: '防火墙', domain: 'network' },
  { name: 'VPN', domain: 'network' },
  { name: '负载均衡', domain: 'network' },
  { name: '等保', domain: 'security' },
  { name: '漏洞修复', domain: 'security' },
  { name: '堡垒机', domain: 'security' },
];

export const ACTION_KEYWORDS: { label: string; keywords: string[] }[] = [
  { label: '慢查询优化', keywords: ['慢查询', 'slow query', 'slowquery', '性能优化', 'optimize'] },
  { label: '故障处理', keywords: ['故障', '宕机', '不可用', '502', '503', 'down', 'incident', '报警', '告警'] },
  { label: '扩容', keywords: ['扩容', 'scale', '扩容节点', '增加节点', '加机器'] },
  { label: '版本升级', keywords: ['升级', 'upgrade', '版本升级'] },
  { label: '备份恢复', keywords: ['备份', '恢复', 'backup', 'restore', '还原'] },
  { label: '参数调整', keywords: ['参数', '调优', '参数调整'] },
  { label: '配置变更', keywords: ['配置修改', 'nginx配置', 'ingress配置', 'yaml'] },
  { label: '安全加固', keywords: ['安全', '加固', '漏洞', '等保', '基线'] },
  { label: '部署发布', keywords: ['部署', '发布', '上线', 'deploy'] },
  { label: '巡检', keywords: ['巡检', '检查', '健康检查'] },
  { label: '咨询支持', keywords: ['咨询', '方案', '评估', '答疑'] },
];

export type TraitProfile = {
  serviceFrequency: number;
  faultDependency: number;
  changeActivity: number;
  consultDependency: number;
  labels: string[];
};

export type DomainShare = { key: ServiceDomain; label: string; count: number; share: number };
export type TypeShare = { key: ServiceType; label: string; count: number; share: number };
export type TechCount = { name: string; count: number; domain?: ServiceDomain };

export function domainLabel(key: string): string {
  return SERVICE_DOMAINS.find((d) => d.key === key)?.label ?? key;
}

export function serviceTypeLabel(key: string): string {
  return SERVICE_TYPES.find((t) => t.key === key)?.label ?? key;
}

export function normalizeDomain(raw: string | null | undefined): ServiceDomain | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  const hit = SERVICE_DOMAINS.find((d) => d.key === v || d.label === raw);
  return hit ? hit.key : null;
}

export function normalizeServiceType(raw: string | null | undefined): ServiceType | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  const hit = SERVICE_TYPES.find((t) => t.key === v || t.label === raw);
  return hit ? hit.key : null;
}

const TECH_ALIASES: Record<string, string> = {
  k8s: 'Kubernetes',
  kubernetes: 'Kubernetes',
  docker: 'Docker',
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
  mongodb: 'MongoDB',
  redis: 'Redis',
  nginx: 'Nginx',
  'sql server': 'SQL Server',
  mssql: 'SQL Server',
  'windows server': 'Windows Server',
  'ci/cd': 'CI/CD',
  cicd: 'CI/CD',
};

export function normalizeTech(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  if (TECH_ALIASES[lower]) return TECH_ALIASES[lower];
  const exact = TECH_DICTIONARY.find((d) => d.name.toLowerCase() === lower);
  return exact?.name ?? t;
}

export function techDomain(name: string): ServiceDomain | undefined {
  return TECH_DICTIONARY.find((d) => d.name.toLowerCase() === name.toLowerCase())?.domain;
}

export function matchActionLabel(title: string, content = ''): string | null {
  const text = `${title}\n${content}`.toLowerCase();
  for (const rule of ACTION_KEYWORDS) {
    if (rule.keywords.some((k) => text.includes(k.toLowerCase()))) return rule.label;
  }
  return null;
}

export function buildShares<T extends string>(
  counts: Partial<Record<T, number>> | Record<string, number>,
  labels: Partial<Record<T, string>> | Record<string, string>,
): { key: T | string; label: string; count: number; share: number }[] {
  const entries = Object.entries(counts as Record<string, number | undefined>);
  const total = entries.reduce((n, [, v]) => n + (Number(v) || 0), 0);
  return entries
    .map(([key, value]) => {
      const count = Number(value || 0);
      const label = (labels as Record<string, string | undefined>)[key] ?? key;
      return { key, label, count, share: total > 0 ? count / total : 0 };
    })
    .sort((a, b) => b.count - a.count);
}

export function computeActivityLevel(monthlyAvg: number, recent90Count: number): ActivityLevel {
  if (recent90Count <= 0 && monthlyAvg <= 0) return 'none';
  // Spec: 近 90 天月均 high≥20 / medium≥6（月均≈近90天次数/3），并用全周期月均兜底
  const monthlyAvg90 = recent90Count / 3;
  const peak = Math.max(monthlyAvg90, monthlyAvg);
  if (peak >= 20) return 'high';
  if (peak >= 6) return 'medium';
  return 'low';
}

export function computeTraits(input: {
  serviceCount: number;
  spanMonths: number;
  typeCounts: Partial<Record<ServiceType, number>>;
  domainCounts: Partial<Record<ServiceDomain, number>>;
  classifiedCount?: number;
}): TraitProfile {
  const classified = input.classifiedCount ?? input.serviceCount;
  const months = Math.max(input.spanMonths, 1);
  const monthlyAvg = input.serviceCount / months;
  const serviceFrequency = Math.min(1, monthlyAvg / 15);
  const faultDependency = classified > 0 ? (input.typeCounts.incident ?? 0) / classified : 0;
  const changeActivity = classified > 0 ? (input.typeCounts.change ?? 0) / classified : 0;
  const consultDependency = classified > 0 ? (input.typeCounts.consult ?? 0) / classified : 0;

  const labels: string[] = [];
  if (monthlyAvg >= 12) labels.push('高频运维型');
  else if (monthlyAvg >= 4) labels.push('稳定服务型');
  else if (input.serviceCount > 0) labels.push('低频客户');

  if (faultDependency >= 0.35) labels.push('故障驱动');
  if (changeActivity >= 0.25) labels.push('高频变更');
  if (consultDependency >= 0.2) labels.push('咨询依赖');

  const domainEntries = Object.entries(input.domainCounts) as [ServiceDomain, number][];
  const topDomain = domainEntries.sort((a, b) => b[1] - a[1])[0];
  if (topDomain && classified > 0 && topDomain[1] / classified >= 0.3) {
    labels.push(`${domainLabel(topDomain[0])}重度`);
  }

  return {
    serviceFrequency: round2(serviceFrequency),
    faultDependency: round2(faultDependency),
    changeActivity: round2(changeActivity),
    consultDependency: round2(consultDependency),
    labels,
  };
}

export function labelArchetype(input: {
  labels: string[];
  domainCounts: Partial<Record<ServiceDomain, number>>;
  traits: TraitProfile;
}): { title: string; summary: string; source: 'rule' } {
  const { labels, domainCounts, traits } = input;
  const domains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const top = domains[0]?.[0];
  const highFreq = traits.serviceFrequency >= 0.6 || labels.includes('高频运维型');
  const fault = traits.faultDependency >= 0.35 || labels.includes('故障驱动');

  let title = '一般服务依赖型客户';
  if (highFreq && fault && top === 'database') title = '数据库依赖型客户';
  else if (highFreq && fault && top === 'container') title = '容器化运维需求客户';
  else if (highFreq && fault) title = '高频故障响应型客户';
  else if (highFreq && traits.changeActivity >= 0.25) title = '高频变更实施型客户';
  else if (traits.changeActivity >= 0.25 && top === 'server') title = '传统服务器变更型客户';
  else if (traits.consultDependency >= 0.25 && !highFreq) title = '咨询与方案依赖型客户';
  else if (top === 'database' && fault) title = '数据库运维依赖型客户';
  else if (top === 'container') title = '容器化技术型客户';
  else if (traits.serviceFrequency < 0.25) title = '低频稳定型客户';

  const summary =
    `基于服务行为推断：标签 ${labels.slice(0, 4).join('、') || '暂无'}；` +
    `主要领域 ${top ? domainLabel(top) : '未分类'}。` +
    `该结论由服务记录聚合规则生成，可能与客户自述情况存在差异。`;

  return { title, summary, source: 'rule' };
}

export function computeTrendDelta(
  current: Partial<Record<ServiceDomain, number>>,
  previous: Partial<Record<ServiceDomain, number>>,
): { domain: ServiceDomain; current: number; previous: number; changePct: number }[] {
  const keys = new Set<ServiceDomain>([
    ...(Object.keys(current) as ServiceDomain[]),
    ...(Object.keys(previous) as ServiceDomain[]),
  ]);
  const rows: { domain: ServiceDomain; current: number; previous: number; changePct: number }[] = [];
  for (const domain of keys) {
    const cur = Number(current[domain] ?? 0);
    const prev = Number(previous[domain] ?? 0);
    if (cur === 0 && prev === 0) continue;
    const changePct = prev === 0 ? 100 : round2(((cur - prev) / prev) * 100);
    rows.push({ domain, current: cur, previous: prev, changePct });
  }
  return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || b.current - a.current);
}

export function taxonomyPayload() {
  const domainLabels = Object.fromEntries(SERVICE_DOMAINS.map((d) => [d.key, d.label])) as Record<
    ServiceDomain,
    string
  >;
  const typeLabels = Object.fromEntries(SERVICE_TYPES.map((t) => [t.key, t.label])) as Record<
    ServiceType,
    string
  >;
  return {
    domains: SERVICE_DOMAINS,
    serviceTypes: SERVICE_TYPES,
    techs: TECH_DICTIONARY,
    actionKeywords: ACTION_KEYWORDS,
    domainLabels,
    typeLabels,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
