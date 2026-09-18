import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type Behavior = {
  monthly: {
    month: string;
    total: number;
    byType: Record<string, number>;
    byDomain: Record<string, number>;
  }[];
  serviceTypes: { key: string; label: string; count: number; share: number }[];
  domains: { key: string; label: string; count: number; share: number }[];
  domainDetail: Record<
    string,
    {
      count: number;
      techs: { name: string; count: number }[];
      actions: { label: string; count: number }[];
    }
  >;
  systems: { name: string; count: number }[];
  period?: { from?: string; to?: string };
};

export default function BehaviorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading } = useAsync(
    () => api<{ behavior: Behavior }>(`/api/customers/${id}/behavior`),
    [id],
  );
  const [domain, setDomain] = useState<string | null>(params.get('domain'));

  useEffect(() => {
    const d = params.get('domain');
    if (d) setDomain(d);
  }, [params]);

  if (loading) return <div className="page-pad muted">加载服务行为…</div>;
  if (error) return <div className="page-pad error">{error}</div>;
  if (!data) return null;
  const b = data.behavior;
  const maxMonth = Math.max(1, ...b.monthly.map((m) => m.total));
  const activeDomain = domain ?? b.domains[0]?.key ?? null;
  const detail = activeDomain ? b.domainDetail[activeDomain] : undefined;
  const domainLabel = b.domains.find((d) => d.key === activeDomain)?.label ?? activeDomain;

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <div className="muted small">
            <Link to={`/customers/${id}`}>客户画像</Link> / 服务行为
          </div>
          <h1>服务行为分析</h1>
          <p className="muted">我们给这个客户干了什么？</p>
        </div>
        <Link className="btn ghost" to={`/customers/${id}`}>
          返回画像
        </Link>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>月度服务趋势</h2>
        {b.monthly.length === 0 ? (
          <p className="muted">暂无已分类服务记录</p>
        ) : (
          <div className="chart-monthly">
            {b.monthly.map((m) => (
              <div key={m.month} className="chart-col" title={`${m.month}: ${m.total}`}>
                <div className="chart-stack">
                  {Object.entries(m.byType).map(([type, n]) => (
                    <div
                      key={type}
                      className={`chart-seg type-${type}`}
                      style={{ height: `${(n / maxMonth) * 140}px` }}
                      title={`${type}: ${n}`}
                    />
                  ))}
                  {Object.keys(m.byType).length === 0 ? (
                    <div
                      className="chart-seg type-other"
                      style={{ height: `${(m.total / maxMonth) * 140}px` }}
                    />
                  ) : null}
                </div>
                <div className="chart-total">{m.total}</div>
                <div className="chart-label">{m.month.slice(5)}月</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="profile-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>服务类型构成</h2>
          <div className="bar-list">
            {b.serviceTypes.map((t) => (
              <div key={t.key} className="bar-row">
                <span className="bar-label">{t.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(6, t.share * 100)}%` }} />
                </div>
                <span className="bar-count">
                  {t.count} · {Math.round(t.share * 100)}%
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>技术领域</h2>
          <div className="bar-list">
            {b.domains.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`bar-row as-button ${activeDomain === t.key ? 'on' : ''}`}
                onClick={() => setDomain(t.key)}
              >
                <span className="bar-label">{t.label}</span>
                <div className="bar-track">
                  <div
                    className={`bar-fill ${activeDomain === t.key ? '' : 'soft'}`}
                    style={{ width: `${Math.max(6, t.share * 100)}%` }}
                  />
                </div>
                <span className="bar-count">{t.count}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {activeDomain ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>领域下钻 · {domainLabel}</h2>
          <p className="muted small">相关服务 {detail?.count ?? 0} 次</p>
          <div className="profile-grid">
            <div>
              <h3>技术栈</h3>
              <div className="chip-row">
                {(detail?.techs ?? []).map((t) => (
                  <span key={t.name} className="chip">
                    {t.name} {t.count}
                  </span>
                ))}
                {!detail?.techs.length ? <span className="muted">暂无</span> : null}
              </div>
            </div>
            <div>
              <h3>主要服务内容</h3>
              <div className="bar-list">
                {(detail?.actions ?? []).map((a) => (
                  <div key={a.label} className="bar-row">
                    <span className="bar-label">{a.label}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill soft"
                        style={{
                          width: `${Math.max(
                            8,
                            (a.count / Math.max(1, detail?.actions[0]?.count ?? 1)) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="bar-count">{a.count}</span>
                  </div>
                ))}
                {!detail?.actions.length ? <span className="muted">暂无动作归纳</span> : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {b.systems.length ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>关联系统</h2>
          <div className="chip-row">
            {b.systems.map((s) => (
              <span key={s.name} className="chip">
                {s.name} · {s.count}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
