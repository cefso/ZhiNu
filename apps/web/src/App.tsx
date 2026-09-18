import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import CustomersPage from './pages/Customers';
import PortraitPage from './pages/Portrait';
import BehaviorPage from './pages/Behavior';
import TimelinePage from './pages/Timeline';
import AnalyticsPage from './pages/Analytics';
import InsightsPage from './pages/Insights';
import InvitesPage from './pages/Invites';
import SettingsPage from './pages/Settings';
import './styles.css';

export type Me = {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'member';
  };
};

const NAV = [
  { to: '/', label: '总览', match: (p: string) => p === '/' },
  {
    to: '/customers',
    label: '客户列表',
    match: (p: string) => p === '/customers' || p.startsWith('/customers/'),
  },
  { to: '/timeline', label: '服务记录', match: (p: string) => p.startsWith('/timeline') },
  { to: '/analytics', label: '多维分析', match: (p: string) => p.startsWith('/analytics') },
  { to: '/insights', label: '画像洞察', match: (p: string) => p.startsWith('/insights') },
  {
    to: '/invites',
    label: '邀请码',
    match: (p: string) => p.startsWith('/invites'),
    adminOnly: true,
  },
  {
    to: '/settings',
    label: '设置',
    match: (p: string) => p.startsWith('/settings'),
    adminOnly: true,
  },
];

function Shell({
  children,
  me,
  onLogout,
}: {
  children: React.ReactNode;
  me: Me | null;
  onLogout: () => void;
}) {
  const { pathname } = useLocation();
  if (pathname === '/login') {
    return <div className="login-root">{children}</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="logo">
          <span className="brand-star" aria-hidden />
          织女
        </Link>
        <nav className="side-nav">
          {NAV.filter((n) => !n.adminOnly || me?.user.role === 'admin').map((n) => (
            <Link key={n.to} to={n.to} className={n.match(pathname) ? 'on' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="side-user">
          {me ? (
            <>
              <span title={me.user.email}>{me.user.email}</span>
              <button type="button" className="side-logout" onClick={onLogout}>
                退出
              </button>
            </>
          ) : (
            <Link to="/login">登录</Link>
          )}
        </div>
      </aside>
      <div className="app-main">{children}</div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="page-loading">织女加载中…</div>;
  }

  return (
    <Shell
      me={me}
      onLogout={async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        setMe(null);
        navigate('/login');
      }}
    >
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              onLogin={(m) => {
                setMe(m);
                navigate('/');
              }}
            />
          }
        />
        <Route path="/" element={me ? <OverviewPage /> : <Navigate to="/login" replace />} />
        <Route
          path="/customers"
          element={me ? <CustomersPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/customers/:id"
          element={me ? <PortraitPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/customers/:id/behavior"
          element={me ? <BehaviorPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/timeline"
          element={me ? <TimelinePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/analytics"
          element={me ? <AnalyticsPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/insights"
          element={me ? <InsightsPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/invites"
          element={
            me?.user.role === 'admin' ? <InvitesPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/settings"
          element={me ? <SettingsPage /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </Shell>
  );
}
