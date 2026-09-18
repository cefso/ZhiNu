import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type CustomerRow = {
  id: string;
  name: string;
  company?: string;
  serviceCount: number;
  recent90Count?: number;
  topDeltaDomain?: string | null;
  topDeltaPct?: number | null;
  activityLevel: string;
  topTechs: string[];
  topDomains: string[];
  labels: string[];
  archetype?: string;
};

const ACTIVITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
};

export default function InsightsPage() {
  const { data, error, loading } = useAsync(
    () => api<{ customers: CustomerRow[] }>('/api/analytics/customers'),
    [],
  );

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>画像洞察</h1>
          <p className="muted">所以这些客户到底是什么样？跨客户特征一览</p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}

      <div className="insight-grid">
        {(data?.customers ?? []).map((c) => (
          <Link key={c.id} to={`/customers/${c.id}`} className="card insight-tile">
            <div className="row space-between">
              <strong>{c.name}</strong>
              <span className={`badge ${c.activityLevel}`}>
                活跃 {ACTIVITY_LABEL[c.activityLevel] ?? c.activityLevel}
              </span>
            </div>
            {c.company ? <div className="muted small">{c.company}</div> : null}
            <div className="archetype-line">{c.archetype ?? '待积累服务记录'}</div>
            <div className="chip-row">
              {c.labels.slice(0, 4).map((l) => (
                <span key={l} className="chip accent">
                  {l}
                </span>
              ))}
            </div>
            <div className="muted small">
              服务 {c.serviceCount} 次
              {typeof c.recent90Count === 'number' ? ` · 近90天 ${c.recent90Count}` : ''}
              {c.topDeltaDomain
                ? ` · 变化 ${c.topDeltaDomain}${
                    typeof c.topDeltaPct === 'number'
                      ? ` ${c.topDeltaPct >= 0 ? '↑' : '↓'}${Math.abs(c.topDeltaPct)}%`
                      : ''
                  }`
                : ''}
              {c.topDomains.length ? ` · ${c.topDomains.join(' / ')}` : ''}
              {c.topTechs.length ? ` · ${c.topTechs.join(' / ')}` : ''}
            </div>
          </Link>
        ))}
      </div>

      {!loading && !(data?.customers ?? []).length ? (
        <p className="muted">
          暂无客户。可先 <Link to="/customers">创建客户</Link>，或在总览生成 MSP 演示数据。
        </p>
      ) : null}
    </div>
  );
}
