import { useState } from 'react';
import { TopBar, useApp } from '../App.jsx';
import TxnRow from '../components/TxnRow.jsx';
import { rupees } from '../lib/api.js';

export default function History() {
  const { me } = useApp();
  const [tab, setTab] = useState('all');
  const txns = me.transactions.filter((t) => tab === 'all' || t.direction === tab);
  const spent = me.transactions.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount, 0);
  const got = me.transactions.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0);

  return (
    <div className="screen">
      <TopBar title="History" />
      <div className="totals">
        <div className="card"><small className="muted">Paid</small><b className="out">{rupees(spent)}</b></div>
        <div className="card"><small className="muted">Received</small><b className="in">{rupees(got)}</b></div>
      </div>
      <div className="tabs">
        {[['all', 'All'], ['out', 'Paid'], ['in', 'Received']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="card list">
        {txns.length === 0 && <p className="muted center pad">Nothing here yet</p>}
        {txns.map((t) => <TxnRow key={t.id} t={t} />)}
      </div>
    </div>
  );
}
