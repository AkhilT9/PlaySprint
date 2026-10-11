import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { TopBar } from '../App.jsx';
import { navigate } from '../lib/router.js';

// Scan any UPI QR (upi://pay?pa=...&am=...) and jump into the FacePay pay flow.
export default function Scan() {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('Point the camera at a UPI QR code');

  useEffect(() => {
    let stream;
    let stopped = false;
    let pausedUntil = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const handle = (text) => {
      let pa = '';
      let am = '';
      let tn = '';
      if (/^upi:\/\//i.test(text)) {
        const params = new URLSearchParams(text.split('?')[1] || '');
        pa = params.get('pa') || '';
        am = params.get('am') || '';
        tn = params.get('tn') || '';
      } else if (/^[\w.-]+@[\w.-]+$/.test(text.trim())) {
        pa = text.trim();
      }
      if (!pa) {
        setHint("That's not a UPI QR code");
        return false;
      }
      if (!pa.toLowerCase().endsWith('@facepay')) {
        setHint(`Found ${pa}. This demo can only pay @facepay IDs.`);
        return false;
      }
      navigator.vibrate?.(60);
      const q = new URLSearchParams({ to: pa, ...(am ? { amount: am } : {}), ...(tn ? { note: tn } : {}) });
      navigate(`/pay?${q}`, { replace: true });
      return true;
    };

    const tick = () => {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.videoWidth && performance.now() > pausedUntil) {
        const w = 480;
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          if (handle(code.data)) return;
          pausedUntil = performance.now() + 2000;
        }
      }
      requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs https:// or localhost');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        tick();
      } catch (e) {
        setError(e.message.includes('https') ? e.message : 'Camera permission denied');
      }
    })();

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="screen">
      <TopBar title="Scan & Pay" />
      <div className="qr-viewport">
        <video ref={videoRef} playsInline muted />
        <div className="qr-corners" />
        <div className="scan-line" />
      </div>
      {error ? <p className="error-text center">{error}</p> : <p className="center muted">{hint}</p>}
      <button className="btn lg" onClick={() => navigate('/pay', { replace: true })}>Enter UPI ID instead</button>
    </div>
  );
}
