import { useState } from 'react';
import { api } from '../api';

export default function InvitesPage() {
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  return (
    <div className="stack">
      <div className="page-head">
        <h1>邀请码</h1>
        <p className="muted">生成一次性邀请码，成员注册时填写</p>
      </div>
      <div className="card">
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              const r = await api<{ code: string }>('/api/invites', {
                method: 'POST',
                body: JSON.stringify({ role }),
              });
              setCodes((c) => [r.code, ...c]);
            } catch (err) {
              setError(err instanceof Error ? err.message : '生成失败');
            }
          }}
        >
          <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit">生成邀请码</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <ul className="insight-list">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
              <button
                type="button"
                className="ghost"
                onClick={() => navigator.clipboard.writeText(c)}
              >
                复制
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
