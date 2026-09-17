import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';

type CustomerRow = {
  id: string;
  name: string;
  company?: string;
  systemCount: number;
  eventCount: number;
  lastEventAt?: string;
};

export default function CustomersPage() {
  const { data, error, loading, reload } = useAsync(
    () => api<{ customers: CustomerRow[] }>('/api/customers'),
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
      c.name.toLowerCase().includes(s) || (c.company ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>客户管理</h1>
          <p className="muted">维护客户档案，点开进入画像工作台</p>
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
          <h2 style={{ margin: 0 }}>全部客户（{rows.length}）</h2>
          <input
            className="search-inline"
            placeholder="搜索姓名 / 公司"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">加载中…</p> : null}
        <div className="list">
          {rows.map((c) => (
            <Link key={c.id} to={`/customers/${c.id}`} className="list-item card">
              <div>
                <strong>{c.name}</strong>
                {c.company ? <span className="muted"> · {c.company}</span> : null}
              </div>
              <div className="muted small">
                系统 {c.systemCount} · 记录 {c.eventCount}
                {c.lastEventAt ? ` · 最近 ${String(c.lastEventAt).slice(0, 10)}` : ''}
              </div>
            </Link>
          ))}
          {!loading && rows.length === 0 ? (
            <p className="muted">{q ? '没有匹配的客户' : '还没有客户，先创建一个。'}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
