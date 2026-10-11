import { useEffect, useRef, useState } from 'react';
import { TopBar, useApp } from '../App.jsx';
import FaceScanner from '../components/FaceScanner.jsx';
import PinPad from '../components/PinPad.jsx';
import { api, celebrate, initials, rupees } from '../lib/api.js';
import { CHALLENGE_INFO } from '../lib/face.js';
import { navigate } from '../lib/router.js';
import { colorFor } from './Home.jsx';

const FACE_ONLY_LIMIT = 2000;

export default function Pay() {
  const { query, refresh } = useApp();
  const [upi, setUpi] = useState(query.to || '');
  const [payee, setPayee] = useState(null);
  const [amount, setAmount] = useState(query.amount || '');
  const [note, setNote] = useState(query.note || '');
  const [stage, setStage] = useState(query.to ? 'resolving' : 'id');
  const [intent, setIntent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [pinKey, setPinKey] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [faceScore, setFaceScore] = useState(null);
  const [result, setResult] = useState(null);
  const started = useRef(0);

  const resolve = async (id) => {
    setError('');
    setBusy(true);
    try {
      setPayee(await api(`/resolve?upi=${encodeURIComponent(id.trim())}`));
      setStage('amount');
    } catch (e) {
      setError(e.message);
      setStage('id');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (query.to) resolve(query.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError('');
    setBusy(true);
    started.current = performance.now();
    try {
      const it = await api('/pay/intent', { to: payee.upiId, amount: Number(amount), note });
      setIntent(it);
      setFallback(false);
      setFaceScore(null);
      setStage('scan');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const done = (res) => {
    celebrate();
    setResult({ ...res, seconds: (performance.now() - started.current) / 1000 });
    setStage('success');
    refresh();
  };

  const onFace = async (scan) => {
    setStage('verifying');
    try {
      const res = await api('/pay/confirm', { intentId: intent.intentId, method: 'face', ...scan });
      if (res.status === 'NEED_PIN') {
        setFaceScore(res.score);
        setStage('pin');
      } else done(res);
    } catch (e) {
      handleError(e);
    }
  };

  const onPin = async (pin) => {
    setBusy(true);
    try {
      done(await api('/pay/confirm', { intentId: intent.intentId, method: 'pin', pin }));
    } catch (e) {
      if (e.status === 401) {
        setError(`${e.message}. ${e.data.attemptsLeft} attempts left.`);
        setPinKey((k) => k + 1);
      } else handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleError = (e) => {
    if (e.data?.fallbackToPin) {
      setFallback(true);
      setError("Face didn't match 3 times. Enter your backup PIN.");
      setStage('pin');
    } else if (e.status === 401 || e.status === 422 || e.status === 400) {
      setError(e.message);
      setFaceScore(e.data?.score ?? null);
      setResult({ attemptsLeft: e.data?.attemptsLeft });
      setStage('retry');
    } else {
      setError(e.message);
      setStage('amount');
    }
  };

  const amt = Number(amount);
  const validAmt = amt >= 1 && amt <= 100000;

  return (
    <div className="screen">
      {!['success', 'scan', 'verifying'].includes(stage) && <TopBar title="Pay" />}

      {stage === 'resolving' && <div className="center pad"><div className="spinner" /></div>}

      {stage === 'id' && (
        <form className="card form" onSubmit={(e) => { e.preventDefault(); resolve(upi); }}>
          <h2>Pay to UPI ID</h2>
          <label>
            UPI ID
            <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="rahul@facepay" autoFocus autoCapitalize="none" />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg" disabled={!upi.includes('@') || busy}>Verify & continue</button>
          <p className="tiny muted">Try <code>rahul@facepay</code>, <code>priya@facepay</code> or <code>campuscafe@facepay</code></p>
        </form>
      )}

      {stage === 'amount' && payee && (
        <div className="pay-amount">
          <div className="payee">
            <span className="avatar lg" style={{ background: colorFor(payee.name) }}>
              {payee.type === 'merchant' ? '☕' : initials(payee.name)}
            </span>
            <h2>{payee.name}</h2>
            <small className="muted">{payee.upiId} {payee.type === 'merchant' && '· ✔ Verified merchant'}</small>
          </div>
          <div className="amount-input">
            <span>₹</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*/, '$1').slice(0, 9))}
              inputMode="decimal"
              placeholder="0"
              autoFocus
              style={{ width: `${Math.max(1, amount.length || 1)}ch` }}
            />
          </div>
          <div className="chips">
            {[100, 500, 1500, 5000].map((v) => (
              <button key={v} className="chip" onClick={() => setAmount(String(v))}>{rupees(v)}</button>
            ))}
          </div>
          <input className="note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="Add a note (optional)" />
          <div className={`limit-hint ${amt > FACE_ONLY_LIMIT ? 'warn' : ''}`}>
            {amt > FACE_ONLY_LIMIT
              ? `🔐 Above ${rupees(FACE_ONLY_LIMIT)}: Face + backup PIN required`
              : `🙂 Face only, no PIN needed up to ${rupees(FACE_ONLY_LIMIT)}`}
          </div>
          {error && <p className="error-text center">{error}</p>}
          <button className="btn primary lg pay-btn" disabled={!validAmt || busy} onClick={start}>
            {busy ? 'Starting…' : <>Pay {validAmt ? rupees(amt) : ''} with Face</>}
          </button>
        </div>
      )}

      {stage === 'scan' && intent && (
        <>
          <div className="pay-summary">
            Paying <b>{rupees(intent.amount)}</b> to <b>{intent.payee.name}</b>
          </div>
          <FaceScanner
            key={scanKey}
            challenge={intent.challenge}
            subtitle={`Liveness challenge: ${CHALLENGE_INFO[intent.challenge].icon} ${CHALLENGE_INFO[intent.challenge].text}`}
            onComplete={onFace}
            onCancel={() => setStage('amount')}
          />
        </>
      )}

      {stage === 'verifying' && (
        <div className="verifying">
          <div className="spinner big" />
          <h2>Verifying face & securing payment…</h2>
          <p className="muted">Matching your face signature on the server</p>
        </div>
      )}

      {stage === 'retry' && (
        <div className="verifying">
          <div className="fail-badge">✕</div>
          <h2>{error}</h2>
          {faceScore != null && <p className="muted">Match score {faceScore}% (needs 60%+)</p>}
          {result?.attemptsLeft != null && <p className="muted">{result.attemptsLeft} attempt(s) left before PIN fallback</p>}
          <button className="btn primary lg" onClick={() => { setError(''); setScanKey((k) => k + 1); setStage('scan'); }}>Try again</button>
          <button className="btn ghost" onClick={() => setStage('amount')}>Cancel</button>
        </div>
      )}

      {stage === 'pin' && (
        <>
          {!fallback && faceScore != null && (
            <div className="face-ok">✓ Face verified · {faceScore}% match</div>
          )}
          <PinPad
            key={pinKey}
            title={fallback ? 'Enter backup PIN' : 'High-value payment'}
            hint={fallback ? `Paying ${rupees(intent.amount)} to ${intent.payee.name}` : `${rupees(intent.amount)} is above ${rupees(FACE_ONLY_LIMIT)}, so confirm with your backup PIN too.`}
            error={error}
            busy={busy}
            onComplete={onPin}
          />
        </>
      )}

      {stage === 'success' && result?.txn && (
        <div className="success-screen paid">
          <div className="success-badge pop">✓</div>
          <h1 className="paid-amt">{rupees(result.txn.amount)}</h1>
          <p>Paid to <b>{result.txn.counterparty.name}</b></p>
          <small className="muted">{result.txn.counterparty.upiId}</small>
          <div className="receipt card">
            <Row k="Verified by" v={{ face: '🙂 Face', 'face+pin': '🙂 Face + 🔢 PIN', pin: '🔢 Backup PIN' }[result.txn.method]} />
            {result.txn.matchScore != null && <Row k="Face match" v={`${result.txn.matchScore}%`} />}
            <Row k="Checkout time" v={`${result.seconds.toFixed(1)} s`} />
            <Row k="Transaction ID" v={result.txn.id} mono />
            <Row k="Balance left" v={rupees(result.balance)} />
            {result.txn.note && <Row k="Note" v={result.txn.note} />}
          </div>
          <button className="btn primary lg" onClick={() => navigate('/home', { replace: true })}>Done</button>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="row">
      <span className="muted">{k}</span>
      <b className={mono ? 'mono' : ''}>{v}</b>
    </div>
  );
}
