import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';

export default function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('admin@zhinu.local');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
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
    <div className="login-split">
      <aside className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <span className="brand-star" aria-hidden />
            织女
          </div>
          <h1>把工作记录，织成客户画像</h1>
          <p>
            录入日常服务记录 → LLM 提炼七维洞察 → 人工合并、置顶、写发版备注。
            历史只增不改，随时可回退。
          </p>
          <ul className="login-points">
            <li>不可变时间线 · 修正与回退</li>
            <li>洞察流只增 · 合并可撤销</li>
            <li>实体备注卡 · 版本可回退</li>
          </ul>
        </div>
        <div className="login-foot">本地 / 内网部署 · Neo4j 图数据</div>
      </aside>

      <main className="login-panel">
        <div className="login-card card">
          <h2>{mode === 'login' ? '登录织女' : '邀请注册'}</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            {mode === 'login' ? '使用团队账号进入工作台' : '填写管理员提供的邀请码'}
          </p>
          {error ? <p className="error">{error}</p> : null}
          {notice ? <p className="muted small">{notice}</p> : null}
          <form className="stack-form" onSubmit={submit}>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            {mode === 'register' ? (
              <label>
                邀请码
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                />
              </label>
            ) : null}
            <button type="submit" className="btn login-submit">
              {mode === 'login' ? '进入工作台' : '注册并进入'}
            </button>
          </form>
          <div className="login-alt">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setNotice('');
              }}
            >
              {mode === 'login' ? '用邀请码注册' : '已有账号，去登录'}
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={async () => {
                try {
                  const r = await api<{ seededAdmin?: string }>('/api/auth/bootstrap', {
                    method: 'POST',
                  });
                  if (r.seededAdmin) setEmail(r.seededAdmin);
                  setNotice('已初始化管理员，请用 .env 中的 ADMIN_PASSWORD 登录');
                  setMode('login');
                } catch (err) {
                  setError(err instanceof Error ? err.message : '初始化失败');
                }
              }}
            >
              初始化管理员
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
