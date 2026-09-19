import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type CustomerRow = {
  id: string;
  name: string;
  company?: string;
  serviceCount: number;
  pendingClassify: number;
  activityLevel: string;
  topTechs: string[];
  topDomains: string[];
  labels: string[];
  archetype?: string;
  lastServiceAt?: string;
};

const ACTIVITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
};

export default function CustomersPage() {
  const { data, error, loading, reload } = useAsync(
    () => api<{ customers: CustomerRow[] }>('/api/analytics/customers'),
    [],
  );
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const rows = (data?.customers ?? []).filter((c) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      c.name.toLowerCase().includes(s) ||
      (c.company ?? '').toLowerCase().includes(s) ||
      c.labels.join(' ').toLowerCase().includes(s) ||
      c.topTechs.join(' ').toLowerCase().includes(s)
    );
  });

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>客户列表</h1>
          <p className="muted">从服务行为看客户：次数、活跃度、主要技术与客户特征</p>
        </div>
      </div>

      <div className="card">
        <h2>新建客户</h2>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/api/customers', {
                method: 'POST',
                body: JSON.stringify({ name, company: company || undefined }),
              });
              setName('');
              setCompany('');
              reload();
            } catch (err) {
              alert(err instanceof Error ? err.message : '创建失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            placeholder="客户姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            placeholder="公司（可选）"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy}>
            创建
          </button>
        </form>
      </div>

      <div className="card">
        <div className="row space-between" style={{ marginBottom: '0.75rem' }}>
          <input
            placeholder="搜索客户 / 技术 / 特征"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <button type="button" className="btn ghost sm" onClick={reload}>
            刷新
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">加载中…</p> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>服务次数</th>
                <th>活跃度</th>
                <th>主要技术</th>
                <th>客户特征</th>
                <th>画像</th>
                <th>最近服务</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/customers/${c.id}`}>
                      <strong>{c.name}</strong>
                    </Link>
                    {c.company ? <div className="muted small">{c.company}</div> : null}
                  </td>
                  <td>
                    {c.serviceCount}
                    {c.pendingClassify ? (
                      <span className="muted small"> · 待分类 {c.pendingClassify}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${c.activityLevel}`}>{ACTIVITY_LABEL[c.activityLevel] ?? c.activityLevel}</span>
                  </td>
                  <td>
                    <div className="chip-row">
                      {(c.topTechs.length ? c.topTechs : ['—']).map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      {(c.labels.length ? c.labels : ['—']).map((t) => (
                        <span key={t} className="chip accent">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small muted">{c.archetype ?? '—'}</td>
                  <td className="small muted">
                    {c.lastServiceAt ? String(c.lastServiceAt).slice(0, 10) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
