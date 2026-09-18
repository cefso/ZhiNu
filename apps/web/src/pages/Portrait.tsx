import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';
import { PORTRAIT_DIMENSIONS } from '@zhinu/shared';

type Profile = {
  customer: { id: string; name: string; company?: string };
  summary: {
    serviceCount: number;
    classifiedCount: number;
    pendingClassify: number;
    spanMonths: number;
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
  archetype: { title: string; summary: string; source: string };
  behaviorSummary?: { monthly: { month: string; total: number }[] };
  systems?: { name: string; count: number }[];
};

type ServiceInsights = {
  narrative: string[];
  characteristics: string[];
  archetype: string;
  caveats: string[];
  generatedAt: string;
  source: string;
};

type LegacyPortrait = {
  customer: { id: string; name: string; company?: string };
  buckets: {
    dimension: string;
    insights: { id: string; title: string; body: string }[];
    notes: { id: string; title: string; body: string }[];
  }[];
};

const ACTIVITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
};

function TraitBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="trait-row">
      <span className="trait-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill accent" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="bar-count">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function PortraitPage() {
  const { id } = useParams();
  const profileQ = useAsync(
    () => api<{ profile: Profile }>(`/api/customers/${id}/profile`),
    [id],
  );
  const insightsQ = useAsync(
    () => api<{ insights: ServiceInsights }>(`/api/customers/${id}/service-insights?mode=rule`),
    [id],
  );
  const legacyQ = useAsync(
    () => api<{ portrait: LegacyPortrait }>(`/api/customers/${id}`).catch(() => null),
    [id],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [llmInsights, setLlmInsights] = useState<ServiceInsights | null>(null);

  async function loadLlmInsights() {
    setBusy(true);
    setMsg('');
    try {
      const res = await api<{ insights: ServiceInsights }>(
        `/api/customers/${id}/service-insights`,
      );
      setLlmInsights(res.insights);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'AI 洞察生成失败');
    } finally {
      setBusy(false);
    }
  }

  async function reclassify() {
    setBusy(true);
    setMsg('');
    try {
      const res = await api<{ updated: number; pending: number }>(
        `/api/customers/${id}/reclassify`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setMsg(`已分类 ${res.updated} 条（原待分类 ${res.pending}）`);
      profileQ.reload();
      insightsQ.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '重分类失败');
    } finally {
      setBusy(false);
    }
  }

  if (profileQ.loading) return <div className="page-pad muted">加载客户画像…</div>;
  if (profileQ.error) return <div className="page-pad error">{profileQ.error}</div>;
  if (!profileQ.data) return null;
  const p = profileQ.data.profile;
  const insights = llmInsights ?? insightsQ.data?.insights;
  const maxDomain = p.domains[0]?.count ?? 1;
  const monthly = p.behaviorSummary?.monthly ?? [];
  const maxMonth = Math.max(1, ...monthly.map((m) => m.total));

  return (
    <div className="page-pad stack profile-page">
      <div className="page-head">
        <div>
          <div className="muted small">
            <Link to="/customers">客户列表</Link> / 客户画像
          </div>
          <h1>
            {p.customer.name}
            {p.customer.company ? <span className="muted"> · {p.customer.company}</span> : null}
          </h1>
          <p className="muted">这个客户，我们到底了解多少？——由服务行为推导</p>
        </div>
        <div className="row wrap">
          <Link className="btn ghost" to={`/customers/${id}/behavior`}>
            服务行为
          </Link>
          <Link className="btn ghost" to={`/timeline?customerId=${id}`}>
            录入记录
          </Link>
          <button type="button" className="btn ghost" onClick={reclassify} disabled={busy}>
            重算分类
          </button>
          <button type="button" className="btn" onClick={loadLlmInsights} disabled={busy}>
            AI 洞察
          </button>
        </div>
      </div>

      {msg ? <p className="muted small">{msg}</p> : null}

      <div className="kpi-row">
        <div className="card stat-card">
          <b>{p.summary.spanMonths}</b>
          <span>服务周期（月）</span>
        </div>
        <div className="card stat-card">
          <b>{p.summary.serviceCount}</b>
          <span>服务次数</span>
        </div>
        <div className="card stat-card">
          <b>{p.techs.length}</b>
          <span>涉及技术</span>
        </div>
        <div className="card stat-card">
          <b>{ACTIVITY_LABEL[p.summary.activityLevel] ?? p.summary.activityLevel}</b>
          <span>活跃度</span>
        </div>
        <div className={`card stat-card ${p.summary.pendingClassify ? 'warn' : ''}`}>
          <b>{p.summary.pendingClassify}</b>
          <span>待分类</span>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>客户标签</h2>
        <div className="chip-row">
          {p.traits.labels.length ? (
            p.traits.labels.map((l) => (
              <span key={l} className="chip accent">
                {l}
              </span>
            ))
          ) : (
            <span className="muted">暂无标签，请先录入分类后的服务记录</span>
          )}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          规则画像：<strong>{p.archetype.title}</strong> · {p.archetype.summary}
        </p>
      </section>

      <div className="profile-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>技术领域画像</h2>
          <div className="bar-list">
            {p.domains.map((d) => (
              <div key={d.key} className="bar-row">
                <span className="bar-label">{d.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.max(6, (d.count / maxDomain) * 100)}%` }}
                  />
                </div>
                <span className="bar-count">
                  {d.count} · {Math.round(d.share * 100)}%
                </span>
              </div>
            ))}
            {!p.domains.length ? <p className="muted">暂无已分类数据</p> : null}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>服务类型</h2>
          <div className="bar-list">
            {p.serviceTypes.map((d) => (
              <div key={d.key} className="bar-row">
                <span className="bar-label">{d.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill soft"
                    style={{
                      width: `${Math.max(6, d.share * 100)}%`,
                    }}
                  />
                </div>
                <span className="bar-count">
                  {d.count} · {Math.round(d.share * 100)}%
                </span>
              </div>
            ))}
            {!p.serviceTypes.length ? <p className="muted">暂无</p> : null}
          </div>
        </section>
      </div>

      <div className="profile-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>运维特征</h2>
          <TraitBar label="服务频率" value={p.traits.serviceFrequency} />
          <TraitBar label="故障依赖" value={p.traits.faultDependency} />
          <TraitBar label="变更活跃" value={p.traits.changeActivity} />
          <TraitBar label="咨询依赖" value={p.traits.consultDependency} />
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>近期趋势 / 画像变化</h2>
          <p className="muted small">
            近 {p.trend.windowDays} 天 <strong>{p.trend.current.total}</strong> 次 · 前一窗口{' '}
            <strong>{p.trend.previous.total}</strong> 次
          </p>
          <div className="bar-list">
            {p.trend.deltas.slice(0, 6).map((d) => (
              <div key={d.domain} className="bar-row">
                <span className="bar-label">{d.domain}</span>
                <div className="delta-pills">
                  <span className="chip">
                    {d.previous} → {d.current}
                  </span>
                  <span className={`chip ${d.changePct >= 0 ? 'accent' : ''}`}>
                    {d.changePct >= 0 ? '↑' : '↓'} {Math.abs(d.changePct)}%
                  </span>
                </div>
              </div>
            ))}
            {!p.trend.deltas.length ? <p className="muted">暂无对比数据</p> : null}
          </div>
          {monthly.length ? (
            <div className="spark-row" aria-label="月度服务次数">
              {monthly.map((m) => (
                <div key={m.month} className="spark-col" title={`${m.month}: ${m.total}`}>
                  <div
                    className="spark-bar"
                    style={{ height: `${Math.max(8, (m.total / maxMonth) * 72)}px` }}
                  />
                  <span>{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <section className="card insight-card">
        <h2 style={{ marginTop: 0 }}>AI 客户洞察</h2>
        {insights ? (
          <>
            <div className="chip-row" style={{ marginBottom: '0.75rem' }}>
              <span className="chip accent">{insights.archetype}</span>
              <span className="chip">{insights.source === 'llm' ? 'LLM' : '规则推导'}</span>
            </div>
            {(insights.narrative.length ? insights.narrative : [p.archetype.summary]).map((n, i) => (
              <p key={i}>{n}</p>
            ))}
            <h3>客户特征</h3>
            <ul className="insight-list">
              {(insights.characteristics.length ? insights.characteristics : p.traits.labels).map(
                (c) => (
                  <li key={c}>{c}</li>
                ),
              )}
            </ul>
            <p className="muted small caveats">
              {insights.caveats.join(' · ')}
              {insights.generatedAt ? ` · ${insights.generatedAt.slice(0, 19).replace('T', ' ')}` : ''}
            </p>
          </>
        ) : (
          <p className="muted">点击右上角「AI 洞察」生成行为推断；无 LLM Key 时展示规则结果。</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>技术偏好 Top</h2>
        <div className="chip-row">
          {p.techs.slice(0, 12).map((t) => (
            <span key={t.name} className="chip">
              {t.name} <em>{t.count}</em>
            </span>
          ))}
          {!p.techs.length ? <span className="muted">暂无</span> : null}
        </div>
        {p.systems?.length ? (
          <div style={{ marginTop: '0.75rem' }} className="chip-row">
            {p.systems.map((s) => (
              <span key={s.name} className="chip">
                系统 · {s.name} ({s.count})
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <details className="card legacy-box">
        <summary>历史七维洞察 / 备注（降级入口）</summary>
        <p className="muted small">
          旧版叙述式洞察与备注仍保留，不再作为画像主路径。需要时可在此查看或到时间线维护工作记录。
        </p>
        {(legacyQ.data?.portrait?.buckets ?? []).map((b) => {
          const dim = PORTRAIT_DIMENSIONS.find((d) => d.key === b.dimension);
          if (!b.insights.length && !b.notes.length) return null;
          return (
            <div key={b.dimension} style={{ marginBottom: '0.75rem' }}>
              <h3>{dim?.label ?? b.dimension}</h3>
              {b.insights.map((i) => (
                <div key={i.id} className="list-item">
                  <strong>{i.title}</strong>
                  <div className="muted small">{i.body}</div>
                </div>
              ))}
              {b.notes.map((n) => (
                <div key={n.id} className="list-item">
                  <strong>备注 · {n.title}</strong>
                  <div className="muted small">{n.body}</div>
                </div>
              ))}
            </div>
          );
        })}
        {!legacyQ.data ? <p className="muted">加载中或暂无历史洞察。</p> : null}
      </details>
    </div>
  );
}
