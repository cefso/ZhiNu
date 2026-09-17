import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './pages/Login';
import CustomersPage from './pages/Customers';
import PortraitPage from './pages/Portrait';
import TimelinePage from './pages/Timeline';
import InvitesPage from './pages/Invites';
import './styles.css';

export type Me = {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'member';
  };
};

function Shell({
  children,
  me,
  onLogout,
}: {
  children: React.ReactNode;
  me: Me | null;
  onLogout: () => void;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">织女</div>
        <nav>
          <Link to="/">客户</Link>
          <Link to="/timeline">时间线</Link>
          {me?.user.role === 'admin' ? <Link to="/invites">邀请码</Link> : null}
        </nav>
        <div className="auth">
          {me ? (
            <>
              <span className="muted-on-dark">{me.user.email}</span>
              <button type="button" className="ghost" onClick={onLogout}>
                退出
              </button>
            </>
          ) : (
            <Link to="/login">登录</Link>
          )}
        </div>
      </header>
      <main>{children}</main>
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
        <Route path="/" element={me ? <CustomersPage /> : <Navigate to="/login" replace />} />
        <Route
          path="/customers/:id"
          element={me ? <PortraitPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/timeline"
          element={me ? <TimelinePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/invites"
          element={
            me?.user.role === 'admin' ? <InvitesPage /> : <Navigate to="/" replace />
          }
        />
      </Routes>
    </Shell>
  );
}
