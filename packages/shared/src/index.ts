export * from './taxonomy.js';

export type Role = 'admin' | 'member';

export type PortraitDimension =
  | 'profile'
  | 'business'
  | 'systems'
  | 'service'
  | 'communication'
  | 'risk'
  | 'notes';

export const PORTRAIT_DIMENSIONS: { key: PortraitDimension; label: string }[] = [
  { key: 'profile', label: '基础与组织关系' },
  { key: 'business', label: '业务背景与目标' },
  { key: 'systems', label: '系统与技术环境' },
  { key: 'service', label: '工作模式与服务历史' },
  { key: 'communication', label: '沟通与性格偏好' },
  { key: 'risk', label: '风险与情绪信号' },
  { key: 'notes', label: '开放备忘' },
];

export type EventStatus = 'active' | 'superseded' | 'voided';
export type InsightStatus = 'active' | 'merged' | 'retired';
export type InsightSource = 'llm' | 'human';
export type NoteKind = 'general' | 'release' | 'other';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Customer {
  id: string;
  name: string;
  company?: string;
  createdAt: string;
}

export interface WorkEvent {
  id: string;
  customerId: string;
  title: string;
  content: string;
  occurredAt: string;
  tags: string[];
  status: EventStatus;
  createdAt: string;
  createdBy: string;
  domain?: string;
  serviceType?: string;
  techs?: string[];
  classifiedAt?: string;
  classifySource?: string;
  supersedes?: string;
  supersededBy?: string;
}

export interface Insight {
  id: string;
  customerId: string;
  dimension: PortraitDimension;
  title: string;
  body: string;
  source: InsightSource;
  status: InsightStatus;
  pinned: boolean;
  createdAt: string;
  createdBy: string;
  eventIds?: string[];
  mergeTargetId?: string;
}

export interface EntityNote {
  id: string;
  targetType: 'Customer' | 'System' | 'Contact';
  targetId: string;
  title: string;
  body: string;
  kind: NoteKind;
  occurAt?: string;
  createdAt: string;
  createdBy: string;
}

export interface SystemEntity {
  id: string;
  name: string;
}

export interface ContactEntity {
  id: string;
  name: string;
  title?: string;
}

export interface PortraitDimensionBucket {
  dimension: PortraitDimension;
  insights: Insight[];
  systems: SystemEntity[];
  contacts: ContactEntity[];
  notes: EntityNote[];
}

export interface CustomerPortraitDetail {
  customer: Customer;
  pinned: Insight[];
  buckets: PortraitDimensionBucket[];
  lastRecomputedAt?: string;
  needsRecompute?: boolean;
}

export interface GraphNeighbor {
  kind: 'system' | 'contact' | 'event' | 'insight';
  id: string;
  label: string;
  relation: string;
}

export interface CustomerListRow {
  id: string;
  name: string;
  company?: string;
  serviceCount: number;
  classifiedCount: number;
  pendingClassify: number;
  activityLevel: string;
  topTechs: string[];
  topDomains: string[];
  labels: string[];
  lastServiceAt?: string;
  archetype?: string;
}

export interface CustomerProfile {
  customer: { id: string; name: string; company?: string };
  summary: {
    serviceCount: number;
    classifiedCount: number;
    pendingClassify: number;
    spanMonths: number;
    firstServiceAt?: string;
    lastServiceAt?: string;
    activityLevel: string;
  };
  domains: { key: string; label: string; count: number; share: number }[];
  serviceTypes: { key: string; label: string; count: number; share: number }[];
  techs: { name: string; count: number; domain?: string }[];
  traits: {
    serviceFrequency: number;
    faultDependency: number;
    changeActivity: number;
    consultDependency: number;
    labels: string[];
  };
  trend: {
    windowDays: number;
    current: { total: number; byDomain: Record<string, number> };
    previous: { total: number; byDomain: Record<string, number> };
    deltas: { domain: string; current: number; previous: number; changePct: number }[];
  };
  archetype: { title: string; summary: string; source: 'rule' | 'llm' };
  behaviorSummary?: {
    monthly: { month: string; total: number }[];
  };
  systems?: { name: string; count: number }[];
}

export interface ServiceInsight {
  narrative: string[];
  characteristics: string[];
  archetype: string;
  caveats: string[];
  generatedAt: string;
  source: 'llm' | 'rule';
}
