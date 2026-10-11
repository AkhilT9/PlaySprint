import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';
import { loadModels } from './lib/face.js';
import { navigate, useRoute } from './lib/router.js';
import Welcome from './screens/Welcome.jsx';
import Register from './screens/Register.jsx';
import Login from './screens/Login.jsx';
import Enroll from './screens/Enroll.jsx';
import Home from './screens/Home.jsx';
import Pay from './screens/Pay.jsx';
import Scan from './screens/Scan.jsx';
import MyQR from './screens/MyQR.jsx';
import History from './screens/History.jsx';
import Terminal from './screens/Terminal.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const PRIVATE = { '/home': Home, '/enroll': Enroll, '/pay': Pay, '/scan': Scan, '/qr': MyQR, '/history': History };
const PUBLIC = { '/': Welcome, '/register': Register, '/login': Login, '/terminal': Terminal };

export default function App() {
  const { path, query } = useRoute();
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setBooting(false);
      return null;
    }
    try {
      const data = await api('/me');
      setMe(data);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally {
      setBooting(false);
    }
  }, []);

  const login = useCallback(
    async (token) => {
      setToken(token);
      return refresh();
    },
    [refresh]
  );

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    navigate('/', { replace: true });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Warm up the face models in the background so scanning feels instant.
  useEffect(() => {
    if (me || path === '/terminal') {
      const t = setTimeout(() => loadModels().catch(() => {}), 400);
      return () => clearTimeout(t);
    }
  }, [me, path]);

  const authed = Boolean(getToken());
  useEffect(() => {
    if (booting) return;
    if (PRIVATE[path] && !authed) navigate('/', { replace: true });
    if ((path === '/' || path === '/login' || path === '/register') && authed && me) {
      navigate(me.user.hasFace ? '/home' : '/enroll', { replace: true });
    }
  }, [path, authed, me, booting]);

  if (booting) {
    return (
      <div className="app splash">
        <Logo big />
      </div>
    );
  }

  const Screen = PRIVATE[path] || PUBLIC[path] || Welcome;
  if (PRIVATE[path] && !me) {
    return (
      <div className="app splash">
        <Logo big />
        <p className="muted">Can't reach the FacePay server.</p>
        <button className="btn" onClick={refresh}>Retry</button>
        <button className="btn ghost" onClick={logout}>Log out</button>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={{ me, refresh, login, logout, query }}>
      <div className={`app ${path === '/terminal' ? 'kiosk' : ''}`}>
        <Screen key={path} />
      </div>
    </AppCtx.Provider>
  );
}

export function Logo({ big }) {
  return (
    <div className={`logo ${big ? 'big' : ''}`}>
      <span className="logo-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 11V7a3 3 0 0 1 3-3h4M21 4h4a3 3 0 0 1 3 3v4M28 21v4a3 3 0 0 1-3 3h-4M11 28H7a3 3 0 0 1-3-3v-4" />
          <circle cx="12" cy="13" r="1.4" className="fill" />
          <circle cx="20" cy="13" r="1.4" className="fill" />
          <path d="M11.5 19.5c2.6 2.3 6.4 2.3 9 0" />
        </svg>
      </span>
      <span className="logo-text">
        Face<b>Pay</b>
      </span>
    </div>
  );
}

export function TopBar({ title, back = '/home', right }) {
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => (history.length > 1 ? history.back() : navigate(back))} aria-label="Back">
        ←
      </button>
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
