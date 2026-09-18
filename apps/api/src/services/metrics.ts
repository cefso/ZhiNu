import {
  buildShares,
  computeActivityLevel,
  computeTraits,
  computeTrendDelta,
  domainLabel,
  labelArchetype,
  matchActionLabel,
  serviceTypeLabel,
  techDomain,
  type ServiceDomain,
  type ServiceType,
  type TraitProfile,
} from '@zhinu/shared';
import { withReadTx } from '../neo4j.js';

export type ClassifiedEvent = {
  id: string;
  title: string;
  content?: string;
  occurredAt: string;
  domain?: string;
  serviceType?: string;
  techs?: string[];
  status: string;
  systemNames?: string[];
};

export type MetricsInput = {
  customer: { id: string; name: string; company?: string };
  events: ClassifiedEvent[];
};

const DAY = 24 * 60 * 60 * 1000;

function parseDate(v: string): number {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : Date.parse(`${v}T00:00:00Z`);
}

function monthKey(iso: string): string {
  const d = new Date(parseDate(iso));
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function computeProfileMetrics(input: MetricsInput, now = Date.now()) {
  const events = input.events.filter((e) => e.status === 'active');
  const classified = events.filter((e) => e.domain);
  const pendingClassify = events.length - classified.length;

  const times = events.map((e) => parseDate(e.occurredAt)).filter((t) => Number.isFinite(t));
  const first = times.length ? Math.min(...times) : undefined;
  const last = times.length ? Math.max(...times) : undefined;
  const spanMonths = first && last ? Math.max(1, Math.ceil((last - first) / (30 * DAY))) : events.length > 0 ? 1 : 0;

  const domainCounts: Partial<Record<ServiceDomain, number>> = {};
  const typeCounts: Partial<Record<ServiceType, number>> = {};
  const techCounts: Record<string, number> = {};

  for (const e of classified) {
    const d = e.domain as ServiceDomain;
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    if (e.serviceType) {
      typeCounts[e.serviceType as ServiceType] = (typeCounts[e.serviceType as ServiceType] ?? 0) + 1;
    }
    for (const tech of e.techs ?? []) {
      if (!tech) continue;
      techCounts[tech] = (techCounts[tech] ?? 0) + 1;
    }
  }

  const windowStart = now - 90 * DAY;
  const prevStart = now - 180 * DAY;
  const currentEvents = classified.filter((e) => {
    const t = parseDate(e.occurredAt);
    return t >= windowStart && t <= now;
  });
  const previousEvents = classified.filter((e) => {
    const t = parseDate(e.occurredAt);
    return t >= prevStart && t < windowStart;
  });
  const byDomain = (list: ClassifiedEvent[]) => {
    const acc: Partial<Record<ServiceDomain, number>> = {};
    for (const e of list) {
      const d = e.domain as ServiceDomain;
      acc[d] = (acc[d] ?? 0) + 1;
    }
    return acc;
  };
  const currentBy = byDomain(currentEvents);
  const previousBy = byDomain(previousEvents);
  const monthlyAvg = spanMonths > 0 ? events.length / spanMonths : 0;
  const activityLevel = computeActivityLevel(monthlyAvg, currentEvents.length);

  const domainLabels = Object.fromEntries(
    Object.keys(domainCounts).map((k) => [k, domainLabel(k)]),
  ) as Record<string, string>;
  const typeLabels = Object.fromEntries(
    Object.keys(typeCounts).map((k) => [k, serviceTypeLabel(k)]),
  ) as Record<string, string>;

  const domains = buildShares(domainCounts as Record<string, number>, domainLabels).map((r) => ({
    ...r,
    key: r.key as string,
  }));
  const serviceTypes = buildShares(typeCounts as Record<string, number>, typeLabels).map((r) => ({
    ...r,
    key: r.key as string,
  }));
  const techs = Object.entries(techCounts)
    .map(([name, count]) => ({ name, count, domain: techDomain(name) }))
    .sort((a, b) => b.count - a.count);

  const traits: TraitProfile = computeTraits({
    serviceCount: events.length,
    spanMonths,
    typeCounts,
    domainCounts,
    classifiedCount: classified.length,
  });
  const archetype = labelArchetype({ labels: traits.labels, domainCounts, traits });

  return {
    customer: input.customer,
    summary: {
      serviceCount: events.length,
      classifiedCount: classified.length,
      pendingClassify,
      spanMonths,
      firstServiceAt: first ? new Date(first).toISOString() : undefined,
      lastServiceAt: last ? new Date(last).toISOString() : undefined,
      activityLevel,
    },
    domains,
    serviceTypes,
    techs,
    traits,
    trend: {
      windowDays: 90,
      current: { total: currentEvents.length, byDomain: currentBy as Record<string, number> },
      previous: { total: previousEvents.length, byDomain: previousBy as Record<string, number> },
      deltas: computeTrendDelta(currentBy, previousBy).map((d) => ({
        ...d,
        domain: d.domain as string,
      })),
    },
    archetype,
  };
}

export function computeBehavior(input: MetricsInput, now = Date.now()) {
  const events = input.events.filter((e) => e.status === 'active' && e.domain);
  const monthlyMap = new Map<
    string,
    { month: string; total: number; byType: Record<string, number>; byDomain: Record<string, number> }
  >();

  for (const e of events) {
    const month = monthKey(e.occurredAt);
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { month, total: 0, byType: {}, byDomain: {} });
    }
    const row = monthlyMap.get(month)!;
    row.total += 1;
    if (e.serviceType) row.byType[e.serviceType] = (row.byType[e.serviceType] ?? 0) + 1;
    if (e.domain) row.byDomain[e.domain] = (row.byDomain[e.domain] ?? 0) + 1;
  }

  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-18);

  const domainCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const domainDetail: Record<
    string,
    { count: number; techs: { name: string; count: number }[]; actions: { label: string; count: number }[] }
  > = {};
  const systemCounts: Record<string, number> = {};

  for (const e of events) {
    const d = e.domain!;
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    if (!domainDetail[d]) domainDetail[d] = { count: 0, techs: [], actions: [] };
    domainDetail[d].count += 1;
    if (e.serviceType) typeCounts[e.serviceType] = (typeCounts[e.serviceType] ?? 0) + 1;
    const techLocal: Record<string, number> = {};
    for (const t of e.techs ?? []) {
      if (!t) continue;
      domainDetail[d].techs.push({ name: t, count: 1 });
      techLocal[t] = (techLocal[t] ?? 0) + 1;
    }
    // aggregate techs/actions later
    const action = matchActionLabel(e.title, e.content ?? '');
    if (action) domainDetail[d].actions.push({ label: action, count: 1 });
    for (const s of e.systemNames ?? []) {
      if (s) systemCounts[s] = (systemCounts[s] ?? 0) + 1;
    }
  }

  for (const [d, detail] of Object.entries(domainDetail)) {
    const techAgg: Record<string, number> = {};
    for (const t of detail.techs) techAgg[t.name] = (techAgg[t.name] ?? 0) + t.count;
    const actAgg: Record<string, number> = {};
    for (const a of detail.actions) actAgg[a.label] = (actAgg[a.label] ?? 0) + a.count;
    domainDetail[d] = {
      count: detail.count,
      techs: Object.entries(techAgg)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      actions: Object.entries(actAgg)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  const typeLabels = Object.fromEntries(
    Object.keys(typeCounts).map((k) => [k, serviceTypeLabel(k)]),
  ) as Record<string, string>;
  const domainLabels = Object.fromEntries(
    Object.keys(domainCounts).map((k) => [k, domainLabel(k)]),
  ) as Record<string, string>;

  return {
    monthly,
    serviceTypes: buildShares(typeCounts, typeLabels).map((r) => ({ ...r, key: r.key as string })),
    domains: buildShares(domainCounts, domainLabels).map((r) => ({ ...r, key: r.key as string })),
    domainDetail,
    systems: Object.entries(systemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    period: {
      from: monthly[0] ? `${monthly[0].month}-01` : undefined,
      to: monthly.length ? `${monthly[monthly.length - 1].month}-01` : undefined,
    },
    now,
  };
}

export async function loadCustomerEvents(customerId: string): Promise<{
  customer: { id: string; name: string; company?: string } | null;
  events: ClassifiedEvent[];
}> {
  return withReadTx(async (tx) => {
    const cRes = await tx.run(
      `MATCH (c:Customer {id: $id}) RETURN c.id AS id, c.name AS name, c.company AS company`,
      { id: customerId },
    );
    const cRec = cRes.records[0];
    if (!cRec) return { customer: null, events: [] };
    const eRes = await tx.run(
      `MATCH (e:Event {customerId: $id, status: 'active'})
       OPTIONAL MATCH (e)-[:MENTIONS]->(s:System)
       RETURN e {
         .id, .title, .content, .occurredAt, .domain, .serviceType, .techs, .status
       } AS event,
       collect(DISTINCT s.name) AS systemNames
       ORDER BY event.occurredAt`,
      { id: customerId },
    );
    return {
      customer: {
        id: cRec.get('id') as string,
        name: cRec.get('name') as string,
        company: (cRec.get('company') as string | null) ?? undefined,
      },
      events: eRes.records.map((r) => {
        const ev = r.get('event') as Record<string, unknown>;
        return {
          id: ev.id as string,
          title: (ev.title as string) ?? '',
          content: (ev.content as string) ?? '',
          occurredAt: String(ev.occurredAt ?? ''),
          domain: (ev.domain as string | null) ?? undefined,
          serviceType: (ev.serviceType as string | null) ?? undefined,
          techs: (ev.techs as string[] | null) ?? [],
          status: (ev.status as string) ?? 'active',
          systemNames: (r.get('systemNames') as string[]).filter(Boolean),
        };
      }),
    };
  });
}
