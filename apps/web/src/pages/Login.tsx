import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';

export default function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('admin@zhinu.local');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'login') {
        const me = await api<Me>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        onLogin(me);
      } else {
        const me = await api<Me>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, inviteCode }),
        });
        onLogin(me);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '失败');
    }
  }

  return (
    <div className="card narrow">
      <h1>织女 · 登录</h1>
      <p className="muted">工作记录沉淀客户立体画像</p>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={submit}>
        <label>
          邮箱
          <input value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        {mode === 'register' ? (
          <label>
            邀请码
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
        ) : null}
        <div className="row">
          <button type="submit" className="btn">{mode === 'login' ? '登录' : '注册'}</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '用邀请码注册' : '去登录'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              const r = await api<{ seededAdmin?: string }>('/api/auth/bootstrap', {
                method: 'POST',
              });
              if (r.seededAdmin) setEmail(r.seededAdmin);
              setError('已尝试初始化管理员，请用 .env 中 ADMIN_PASSWORD 登录');
            }}
          >
            初始化管理员
          </button>
        </div>
      </form>
    </div>
  );
}
