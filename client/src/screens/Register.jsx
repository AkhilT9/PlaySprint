import { useState } from 'react';
import { useApp } from '../App.jsx';
import { TopBar } from '../App.jsx';
import PinPad from '../components/PinPad.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';

export default function Register() {
  const { login } = useApp();
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const submitDetails = (e) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Enter your full name');
    if (!/^[6-9]\d{9}$/.test(phone)) return setError('Enter a valid 10-digit mobile number');
    setStep('pin');
  };

  const confirmPin = async (p) => {
    if (p !== pin) {
      setError("PINs don't match. Try again.");
      setPin('');
      setAttempt((a) => a + 1);
      return setStep('pin');
    }
    setBusy(true);
    try {
      const res = await api('/register', { name: name.trim(), phone, pin });
      await login(res.token);
      navigate('/enroll', { replace: true });
    } catch (err) {
      setError(err.message);
      setStep('details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title="Create account" back="/" />
      <Progress step={step === 'details' ? 1 : 2} />
      {step === 'details' && (
        <form className="card form" onSubmit={submitDetails}>
          <h2>Tell us about you</h2>
          <label>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Akhil Kumar" autoFocus />
          </label>
          <label>
            Mobile number
            <div className="phone-input">
              <span>+91</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="98765 43210"
              />
            </div>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg" type="submit">Continue</button>
          <p className="tiny muted center">Demo app: no real money, no real OTP. You get ₹10,000 of demo balance.</p>
        </form>
      )}
      {step === 'pin' && (
        <PinPad
          key={`set-${attempt}`}
          title="Set a backup PIN"
          hint="Used only if face verification fails, or for payments above ₹2,000."
          error={error}
          onComplete={(p) => {
            setPin(p);
            setError('');
            setStep('confirm');
          }}
        />
      )}
      {step === 'confirm' && (
        <PinPad key="confirm" title="Confirm backup PIN" hint="Enter the same 4 digits again" busy={busy} onComplete={confirmPin} />
      )}
    </div>
  );
}

export function Progress({ step, total = 3 }) {
  return (
    <div className="progress-steps">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  );
}
