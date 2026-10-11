const TOKEN_KEY = 'facepay.token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Network error');
    this.status = status;
    this.data = data || {};
  }
}

export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

export async function api(path, body, method) {
  const token = getToken();
  let res;
  if (STANDALONE) {
    // GitHub Pages build: no server, the API runs in the browser.
    const { localApi } = await import('./localApi.js');
    const r = await localApi(path, body, method || (body ? 'POST' : 'GET'));
    res = { ok: r.ok, status: r.status, json: async () => r.data };
  } else try {
    res = await fetch(`/api${path}`, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach FacePay server' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'Please log in again') {
      setToken(null);
      location.hash = '#/';
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

export const rupees = (n) =>
  `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Little success chime + haptic, for that "payment done" feeling.
export function celebrate() {
  try {
    navigator.vibrate?.([40, 30, 80]);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
  } catch {
    /* no audio, no problem */
  }
}
