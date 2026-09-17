import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type Stats = {
  customers: number;
  events: number;
  insights: number;
  systems: number;
  needRecompute: number;
  recentCustomers: {
    id: string;
    name: string;
    company?: string;
    eventCount: number;
    lastEventAt?: string;
  }[];
};

export default function OverviewPage() {
  const { data, error, loading, reload } = useAsync(() => api<Stats>('/api/stats'), []);

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>总览</h1>
          <p className="muted">工作记录织成客户画像 · 今日从这里开始</p>
        </div>
        <div className="row">
          <Link to="/customers" className="btn">
            管理客户
          </Link>
          <Link to="/timeline" className="btn ghost">
            录入记录
          </Link>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="overview-grid">
        <div className="card stat-card">
          <b>{loading ? '—' : data?.customers ?? 0}</b>
          <span>客户</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.events ?? 0}</b>
          <span>有效工作记录</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.insights ?? 0}</b>
          <span>活跃洞察</span>
        </div>
        <div className="card stat-card">
          <b>{loading ? '—' : data?.systems ?? 0}</b>
          <span>业务系统</span>
        </div>
        <div className={`card stat-card ${data?.needRecompute ? 'warn' : ''}`}>
          <b>{loading ? '—' : data?.needRecompute ?? 0}</b>
          <span>待重算客户</span>
        </div>
      </div>

      <section className="card">
        <div className="row space-between" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>最近客户</h2>
          <button type="button" className="btn ghost sm" onClick={reload}>
            刷新
          </button>
        </div>
        {(data?.recentCustomers ?? []).length === 0 && !loading ? (
          <p className="muted">
            还没有客户。去 <Link to="/customers">客户管理</Link> 创建第一个。
          </p>
        ) : (
          <div className="list">
            {(data?.recentCustomers ?? []).map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="list-item card">
                <div>
                  <strong>{c.name}</strong>
                  {c.company ? <span className="muted"> · {c.company}</span> : null}
                </div>
                <div className="muted small">
                  记录 {c.eventCount}
                  {c.lastEventAt ? ` · 最近 ${String(c.lastEventAt).slice(0, 10)}` : ''}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card muted" style={{ fontSize: '0.88rem' }}>
        建议路径：客户管理建客户 → 时间线写工作记录 → 打开画像点「LLM 重算」→ 人工合并/备注。
      </section>
    </div>
  );
}
