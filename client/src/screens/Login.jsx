import { useState } from 'react';
import { TopBar, useApp } from '../App.jsx';
import FaceScanner from '../components/FaceScanner.jsx';
import PinPad from '../components/PinPad.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';

export default function Login() {
  const { login } = useApp();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const finish = async (res) => {
    const me = await login(res.token);
    navigate(me?.user.hasFace ? '/home' : '/enroll', { replace: true });
  };

  const withFace = async (scan) => {
    setBusy(true);
    try {
      await finish(await api('/login/face', { phone, ...scan }));
    } catch (e) {
      setError(e.data?.score != null ? `${e.message} (match ${e.data.score}%)` : e.message);
      setStep('phone');
    } finally {
      setBusy(false);
    }
  };

  const withPin = async (pin) => {
    setBusy(true);
    try {
      await finish(await api('/login', { phone, pin }));
    } catch (e) {
      setError(e.data?.attemptsLeft != null ? `${e.message}. ${e.data.attemptsLeft} attempts left.` : e.message);
      setAttempt((a) => a + 1);
    } finally {
      setBusy(false);
    }
  };

  const valid = /^[6-9]\d{9}$/.test(phone);

  return (
    <div className="screen">
      <TopBar title="Log in" back="/" />
      {step === 'phone' && (
        <div className="card form">
          <h2>Welcome back</h2>
          <label>
            Mobile number
            <div className="phone-input">
              <span>+91</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="98765 43210"
                autoFocus
              />
            </div>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg" disabled={!valid} onClick={() => { setError(''); setStep('face'); }}>
            🙂 Log in with Face
          </button>
          <button className="btn lg" disabled={!valid} onClick={() => { setError(''); setStep('pin'); }}>
            Use backup PIN
          </button>
        </div>
      )}
      {step === 'face' && (
        <>
          <FaceScanner title="Verify it's you" onComplete={withFace} onCancel={() => setStep('phone')} />
          {busy && <p className="center muted">Verifying…</p>}
        </>
      )}
      {step === 'pin' && (
        <PinPad key={attempt} title="Enter backup PIN" error={error} busy={busy} onComplete={withPin} />
      )}
    </div>
  );
}
