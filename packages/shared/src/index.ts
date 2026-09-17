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
