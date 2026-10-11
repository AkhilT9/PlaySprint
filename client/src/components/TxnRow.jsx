import { initials, rupees, timeAgo } from '../lib/api.js';
import { colorFor } from '../screens/Home.jsx';

const METHOD = {
  face: '🙂 Face',
  'face+pin': '🙂 Face + PIN',
  pin: '🔢 PIN fallback',
  'face-terminal': '🏪 Face terminal',
};

export default function TxnRow({ t }) {
  const name = t.counterparty?.name || 'Unknown';
  const out = t.direction === 'out';
  return (
    <div className="txn">
      <span className="avatar sm" style={{ background: colorFor(name) }}>
        {t.counterparty?.type === 'merchant' ? '☕' : initials(name)}
      </span>
      <div className="txn-main">
        <b>{out ? `Paid to ${name}` : `Received from ${name}`}</b>
        <small>
          {timeAgo(t.createdAt)} · {METHOD[t.method] || t.method}
          {t.matchScore != null && out ? ` · ${t.matchScore}% match` : ''}
          {t.note ? ` · ${t.note}` : ''}
        </small>
      </div>
      <span className={`txn-amt ${out ? 'out' : 'in'}`}>
        {out ? '−' : '+'}
        {rupees(t.amount)}
      </span>
    </div>
  );
}
