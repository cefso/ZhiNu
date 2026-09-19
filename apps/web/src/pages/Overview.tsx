import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type Stats = {
  customers: number;
  events: number;
  pendingClassify: number;
  classified: number;
  events30d: number;
  activeCustomers: number;
  topDomains: { domain: string; label: string; count: number }[];
  recentCustomers: {
    id: string;
    name: string;
    company?: string;
    eventCount: number;
    lastEventAt?: string;
    activityLevel?: string;
    labels?: string[];
    topTechs?: string[];
  }[];
};

const ACTIVITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
};

export default function OverviewPage() {
  const { data, error, loading, reload } = useAsync(() => api<Stats>('/api/stats'), []);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  async function runSeed() {
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await api<{ seeded: { customer: string }[]; skipped: string[] }>(
        '/api/dev/seed',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setSeedMsg(
        `已生成 ${res.seeded.length} 个演示客户${
          res.skipped.length ? `，跳过已存在：${res.skipped.join('、')}` : ''
        }`,
      );
      reload();
    } catch (err) {
      setSeedMsg(err instanceof Error ? err.message : '种子生成失败');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>总览</h1>
          <p className="muted">从「我们为客户做过什么」反推客户运维画像</p>
        </div>
        <div className="row">
          <Link to="/customers" className="btn">
            客户列表
          </Link>
          <Link to="/timeline" className="btn ghost">
            录入服务记录
          </Link>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="overview-grid">
        <div className="card stat-card">
          <b>{loading ? '—' : data?.events30d ?? 0}</b>
          <span>近 30 天服务</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.customers ?? 0}</b>
          <span>客户</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.activeCustomers ?? 0}</b>
          <span>有服务史客户</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.classified ?? 0}</b>
          <span>已分类记录</span>
        </div>
        <div className={`card stat-card ${data?.pendingClassify ? 'warn' : ''}`}>
          <b>{loading ? '—' : data?.pendingClassify ?? 0}</b>
          <span>待分类</span>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>主要技术领域</h2>
        {(data?.topDomains ?? []).length === 0 ? (
          <p className="muted">暂无已分类服务记录。</p>
        ) : (
          <div className="bar-list">
            {(data?.topDomains ?? []).map((d) => (
              <div key={d.domain} className="bar-row">
                <span className="bar-label">{d.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(
                        8,
                        (d.count / Math.max(1, data?.topDomains?.[0]?.count ?? 1)) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <span className="bar-count">{d.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row space-between" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>最近客户</h2>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={runSeed} disabled={seeding}>
              {seeding ? '生成中…' : '生成 MSP 演示数据'}
            </button>
            <button type="button" className="btn ghost sm" onClick={reload}>
              刷新
            </button>
          </div>
        </div>
        {seedMsg ? <p className="muted small">{seedMsg}</p> : null}
        {(data?.recentCustomers ?? []).length === 0 && !loading ? (
          <p className="muted">
            还没有客户服务记录。去 <Link to="/customers">客户列表</Link> 创建客户，或点击「生成 MSP
            演示数据」。
          </p>
        ) : (
          <div className="list">
            {(data?.recentCustomers ?? []).map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="list-item card">
                <div>
                  <strong>{c.name}</strong>
                  {c.company ? <span className="muted"> · {c.company}</span> : null}
                  <div className="chip-row" style={{ marginTop: '0.35rem' }}>
                    {(c.labels ?? []).map((l) => (
                      <span key={l} className="chip">
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="muted small">
                  服务 {c.eventCount} · 活跃 {ACTIVITY_LABEL[c.activityLevel ?? 'none'] ?? c.activityLevel}
                  {c.topTechs?.length ? ` · ${c.topTechs.join('/')}` : ''}
                  {c.lastEventAt ? ` · 最近 ${String(c.lastEventAt).slice(0, 10)}` : ''}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card muted" style={{ fontSize: '0.88rem' }}>
        建议路径：服务记录（分类领域/类型/技术）→ 客户画像看特征 → 服务行为下钻 → 多维分析交叉问题。
      </section>
    </div>
  );
}
