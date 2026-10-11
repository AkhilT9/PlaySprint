import { useEffect, useState } from 'react';
import { Logo, useApp } from '../App.jsx';
import FaceScanner from '../components/FaceScanner.jsx';
import TxnRow from '../components/TxnRow.jsx';
import { api, initials, rupees } from '../lib/api.js';
import { navigate } from '../lib/router.js';

export default function Home() {
  const { me, refresh, logout } = useApp();
  const [contacts, setContacts] = useState([]);
  const [balance, setBalance] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState('');
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const user = me.user;
  const txns = me.transactions;

  useEffect(() => {
    refresh();
    api('/contacts').then(setContacts).catch(() => {});
    const t = setInterval(refresh, 5000); // pick up incoming payments
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (balance == null) return;
    const t = setTimeout(() => setBalance(null), 20000);
    return () => clearTimeout(t);
  }, [balance]);

  const faceTxns = txns.filter((t) => t.direction === 'out' && t.latencyMs && t.method.startsWith('face'));
  const avg = faceTxns.length ? faceTxns.reduce((s, t) => s + t.latencyMs, 0) / faceTxns.length / 1000 : null;

  const people = contacts.filter((c) => c.type !== 'merchant');
  const merchants = contacts.filter((c) => c.type === 'merchant');

  const copy = () => {
    navigator.clipboard?.writeText(user.upiId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (checking) {
    return (
      <div className="screen">
        <FaceScanner
          title="Check balance"
          subtitle="Like entering your UPI PIN, but with your face"
          onComplete={async (scan) => {
            try {
              const r = await api('/face/verify', scan);
              setBalance(r.balance);
            } catch (e) {
              setCheckErr(e.message);
            }
            setChecking(false);
          }}
          onCancel={() => setChecking(false)}
        />
      </div>
    );
  }

  return (
    <div className="screen home">
      <header className="home-head">
        <Logo />
        <button className="avatar" onClick={() => setMenu((m) => !m)} aria-label="Menu">
          {initials(user.name)}
        </button>
        {menu && (
          <div className="menu" onClick={() => setMenu(false)}>
            <div className="menu-user">
              <b>{user.name}</b>
              <small>+91 {user.phone}</small>
            </div>
            <button onClick={() => navigate('/enroll')}>🔄 Re-scan face</button>
            <button onClick={async () => { await api('/demo/topup', {}); refresh(); setBalance(null); }}>💰 Add ₹5,000 demo money</button>
            <button onClick={() => navigate('/terminal')}>🏪 Merchant terminal</button>
            <button onClick={logout}>↩ Log out</button>
          </div>
        )}
      </header>

      <section className="balance-card">
        <div className="bc-top">
          <div>
            <small>Hi {user.name.split(' ')[0]} 👋</small>
            <button className="upi-chip" onClick={copy}>{copied ? 'Copied!' : user.upiId} ⧉</button>
          </div>
          <span className="shield">🛡️ Face secured</span>
        </div>
        <div className="bc-balance">
          {balance != null ? (
            <>
              <small>Wallet balance</small>
              <strong>{rupees(balance)}</strong>
            </>
          ) : (
            <button className="reveal" onClick={() => { setCheckErr(''); setChecking(true); }}>
              <span>🙂</span> Check balance with Face
            </button>
          )}
          {checkErr && <p className="error-text light">{checkErr}</p>}
        </div>
      </section>

      {!user.hasFace && (
        <button className="banner" onClick={() => navigate('/enroll')}>⚠️ Finish setting up FacePay. Scan your face →</button>
      )}

      <section className="actions">
        <Action icon="⌗" label="Scan & Pay" onClick={() => navigate('/scan')} />
        <Action icon="@" label="Pay UPI ID" onClick={() => navigate('/pay')} />
        <Action icon="▦" label="My QR" onClick={() => navigate('/qr')} />
        <Action icon="↻" label="History" onClick={() => navigate('/history')} />
      </section>

      {avg != null && (
        <div className="stat-strip">
          ⚡ Avg FacePay checkout <b>{avg.toFixed(1)}s</b> · {faceTxns.length} PIN-free payment{faceTxns.length > 1 ? 's' : ''}
        </div>
      )}

      <section>
        <h3 className="section-title">People</h3>
        <div className="people">
          {people.map((c) => (
            <button key={c.upiId} className="person" onClick={() => navigate(`/pay?to=${encodeURIComponent(c.upiId)}`)}>
              <span className="avatar" style={{ background: colorFor(c.name) }}>{initials(c.name)}</span>
              <small>{c.name.split(' ')[0]}</small>
            </button>
          ))}
        </div>
      </section>

      {merchants.length > 0 && (
        <section>
          <h3 className="section-title">Businesses</h3>
          <div className="people">
            {merchants.map((c) => (
              <button key={c.upiId} className="person" onClick={() => navigate(`/pay?to=${encodeURIComponent(c.upiId)}`)}>
                <span className="avatar square">☕</span>
                <small>{c.name}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-row">
          <h3 className="section-title">Recent activity</h3>
          {txns.length > 0 && <button className="link" onClick={() => navigate('/history')}>See all</button>}
        </div>
        <div className="card list">
          {txns.length === 0 && <p className="muted center pad">No payments yet. Pay someone to see the magic ✨</p>}
          {txns.slice(0, 5).map((t) => <TxnRow key={t.id} t={t} />)}
        </div>
      </section>
    </div>
  );
}

function Action({ icon, label, onClick }) {
  return (
    <button className="action" onClick={onClick}>
      <span className="action-icon">{icon}</span>
      <small>{label}</small>
    </button>
  );
}

const PALETTE = ['#6d4aff', '#ff7a59', '#12b886', '#228be6', '#e64980', '#f59f00', '#15aabf'];
export function colorFor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
