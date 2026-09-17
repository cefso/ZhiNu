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

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>客户</h1>
          <p className="muted">点开客户进入侧栏工作台画像</p>
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

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}

      <div className="list">
        {(data?.customers ?? []).map((c) => (
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
        {!loading && (data?.customers ?? []).length === 0 ? (
          <p className="muted">还没有客户，先创建一个。</p>
        ) : null}
      </div>
    </div>
  );
}
