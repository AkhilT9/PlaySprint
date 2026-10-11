import { useEffect, useState } from 'react';

// Minimal hash router: "#/pay?to=rahul@facepay" -> { path: "/pay", query: {to: ...} }
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = (to, { replace = false } = {}) => {
  if (replace) location.replace(`#${to}`);
  else location.hash = to;
};
