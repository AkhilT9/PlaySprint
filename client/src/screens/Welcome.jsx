import { Logo } from '../App.jsx';
import { navigate } from '../lib/router.js';

export default function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <Logo big />
        <div className="hero-face">
          <div className="hero-ring" />
          <div className="hero-ring r2" />
          <span>🙂</span>
        </div>
        <h1 className="hero-title">
          Pay with a glance.
          <br />
          <span className="grad">No PIN. No OTP.</span>
        </h1>
        <p className="muted center">
          FacePay replaces the 4–6 digit UPI PIN with on-device face verification and a liveness check.
        </p>
      </div>

      <ul className="features">
        <li><span>⚡</span><div><b>Pay in seconds</b><small>Look, smile, paid. No more typing a PIN where people can see it.</small></div></li>
        <li><span>🛡️</span><div><b>Anti-spoof liveness</b><small>Random challenges block photos and videos.</small></div></li>
        <li><span>🔒</span><div><b>Privacy first</b><small>Your photo never leaves the phone, only a face signature.</small></div></li>
      </ul>

      <div className="stack">
        <button className="btn primary lg" onClick={() => navigate('/register')}>Get started</button>
        <button className="btn lg" onClick={() => navigate('/login')}>I already have an account</button>
        <button className="link" onClick={() => navigate('/terminal')}>🏪 Open merchant face terminal</button>
      </div>
    </div>
  );
}
