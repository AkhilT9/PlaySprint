import { useState } from 'react';
import { useApp } from '../App.jsx';
import FaceScanner from '../components/FaceScanner.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { Progress } from './Register.jsx';

export default function Enroll() {
  const { me, refresh } = useApp();
  const [step, setStep] = useState('intro');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const reenroll = me?.user.hasFace;

  const save = async (scan) => {
    setStep('saving');
    try {
      await api('/face/enroll', scan);
      await refresh();
      setStep('done');
    } catch (e) {
      setError(e.message);
      setStep('intro');
      setAttempt((a) => a + 1);
    }
  };

  return (
    <div className="screen">
      {!reenroll && <Progress step={3} />}
      {step === 'intro' && (
        <div className="enroll-intro">
          <div className="hero-face small">
            <div className="hero-ring" />
            <span>🧑</span>
          </div>
          <h2 className="center">{reenroll ? 'Re-scan your face' : 'Set up FacePay'}</h2>
          <p className="muted center">Takes about 5 seconds. You'll turn your head slightly once to prove you're real.</p>
          <ul className="tips">
            <li>💡 Find good, even lighting</li>
            <li>👓 Remove sunglasses and masks</li>
            <li>📱 Hold the phone at eye level</li>
          </ul>
          {error && <p className="error-text center">{error}</p>}
          <button className="btn primary lg" onClick={() => setStep('scan')}>Start face scan</button>
          {reenroll && <button className="btn ghost" onClick={() => navigate('/home')}>Cancel</button>}
        </div>
      )}
      {(step === 'scan' || step === 'saving') && (
        <FaceScanner
          key={attempt}
          mode="enroll"
          title="Scanning your face"
          onComplete={save}
          onCancel={() => setStep('intro')}
        />
      )}
      {step === 'done' && (
        <div className="success-screen">
          <div className="success-badge">✓</div>
          <h2>FacePay is ready!</h2>
          <p className="muted center">From now on, just look at your phone to pay. No PIN needed for payments up to ₹2,000.</p>
          <div className="card upi-card">
            <small>Your UPI ID</small>
            <b>{me?.user.upiId}</b>
          </div>
          <button className="btn primary lg" onClick={() => navigate('/home', { replace: true })}>Go to home</button>
        </div>
      )}
    </div>
  );
}
