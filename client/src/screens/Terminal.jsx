import { useEffect, useState } from 'react';
import { Logo } from '../App.jsx';
import FaceScanner from '../components/FaceScanner.jsx';
import PinPad from '../components/PinPad.jsx';
import { api, celebrate, rupees } from '../lib/api.js';
import { navigate } from '../lib/router.js';

// Shop-counter "Smile to Pay" kiosk: the customer carries nothing, not even a phone.
export default function Terminal() {
  const [merchants, setMerchants] = useState([]);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState('amount');
  const [match, setMatch] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api('/merchants')
      .then((m) => {
        setMerchants(m);
        setMerchant(m[0]?.upiId || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (stage !== 'success') return;
    const t = setTimeout(reset, 7000);
    return () => clearTimeout(t);
  }, [stage]);

  function reset() {
    setAmount('');
    setMatch(null);
    setError('');
    setReceipt(null);
    setStage('amount');
  }

  const press = (k) => {
    setError('');
    if (k === '⌫') return setAmount((a) => a.slice(0, -1));
    setAmount((a) => (a + k).replace(/^0+/, '').slice(0, 4));
  };

  const identify = async (scan) => {
    setStage('identifying');
    try {
      const r = await api('/merchant/identify', { merchant, amount: Number(amount), ...scan });
      setMatch(r);
      setStage('confirm');
    } catch (e) {
      setError(e.message);
      setStage('notfound');
    }
  };

  const charge = async (last4) => {
    setBusy(true);
    try {
      const r = await api('/merchant/charge', { matchToken: match.matchToken, last4 });
      celebrate();
      setReceipt(r);
      setStage('success');
    } catch (e) {
      setError(e.message);
      setAttempt((a) => a + 1);
      if (e.status === 410 || e.status === 400) setStage('notfound');
    } finally {
      setBusy(false);
    }
  };

  const name = merchants.find((m) => m.upiId === merchant)?.name || 'Merchant';
  const amt = Number(amount);

  return (
    <div className="terminal">
      <header className="terminal-head">
        <Logo />
        <select value={merchant} onChange={(e) => setMerchant(e.target.value)}>
          {merchants.map((m) => <option key={m.upiId} value={m.upiId}>{m.name}</option>)}
        </select>
      </header>

      {stage === 'amount' && (
        <div className="terminal-body">
          <p className="muted">☕ {name} · Bill amount</p>
          <div className="terminal-amount">{amt ? rupees(amt) : '₹0'}</div>
          <div className="keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map((k) => (
              <button key={k} className="key" onClick={() => press(k)}>{k}</button>
            ))}
          </div>
          {amt > 2000 && <p className="error-text">Face terminal limit is ₹2,000</p>}
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg" disabled={!amt || amt > 2000 || !merchant} onClick={() => setStage('scan')}>
            🙂 Charge with Face
          </button>
          <button className="link" onClick={() => navigate('/')}>Exit terminal</button>
        </div>
      )}

      {stage === 'scan' && (
        <FaceScanner
          title={`Pay ${rupees(amt)} at ${name}`}
          subtitle="Customer: look at the camera"
          onComplete={identify}
          onCancel={reset}
        />
      )}

      {stage === 'identifying' && (
        <div className="verifying">
          <div className="spinner big" />
          <h2>Finding your FacePay account…</h2>
        </div>
      )}

      {stage === 'confirm' && match && (
        <div className="terminal-body">
          <div className="face-ok">✓ Recognised · {match.score}% match</div>
          <h2 className="center">Hi {match.maskedName}!</h2>
          <PinPad
            key={attempt}
            mask={false}
            title={`Pay ${rupees(amt)}`}
            hint={`Confirm the last 4 digits of your mobile number (${match.phoneHint})`}
            error={error}
            busy={busy}
            onComplete={charge}
          />
          <button className="btn ghost" onClick={reset}>Not me</button>
        </div>
      )}

      {stage === 'notfound' && (
        <div className="verifying">
          <div className="fail-badge">✕</div>
          <h2>{error || 'Face not recognised'}</h2>
          <button className="btn primary lg" onClick={() => { setError(''); setStage('scan'); }}>Scan again</button>
          <button className="btn ghost" onClick={reset}>Cancel</button>
        </div>
      )}

      {stage === 'success' && receipt && (
        <div className="success-screen paid">
          <div className="success-badge pop">✓</div>
          <h1 className="paid-amt">{rupees(receipt.amount)}</h1>
          <p>Received from <b>{receipt.payer}</b></p>
          <small className="muted mono">{receipt.txnId}</small>
          <button className="btn primary lg" onClick={reset}>Next customer</button>
        </div>
      )}
    </div>
  );
}
