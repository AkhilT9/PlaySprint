import { useEffect, useRef, useState } from 'react';
import { analyze, CHALLENGE_INFO, createLiveness, loadModels, randomChallenge } from '../lib/face.js';

const RING = 2 * Math.PI * 140;
const sleepFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Camera + liveness + face-embedding capture.
 * mode "enroll": 3 frontal samples -> liveness challenge -> 2 more samples
 * mode "verify": 1 sample -> liveness challenge -> 2 more samples
 * Calls onComplete({ descriptors, liveness: { challenge, passed } }).
 */
export default function FaceScanner({ mode = 'verify', challenge, onComplete, onCancel, title, subtitle }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;
  const [challengeType] = useState(() => challenge || randomChallenge());
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('Starting camera…');
  const [progress, setProgress] = useState(0);
  const [fatal, setFatal] = useState(null);

  useEffect(() => {
    let stream;
    let stopped = false;
    const video = videoRef.current;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera needs a secure connection. Open the app over https:// or on localhost.');
      }
      const modelsReady = loadModels();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        throw new Error('Camera permission denied. Allow camera access and try again.');
      }
      if (stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setMessage('Loading face AI…');
      await modelsReady;
      while (!video.videoWidth && !stopped) await sleepFrame();
      if (!stopped) await loop();
    }

    async function loop() {
      const needBefore = mode === 'enroll' ? 3 : 1;
      const needAfter = mode === 'enroll' ? 2 : 1;
      let step = 'position';
      let stable = 0;
      let lastSeen = performance.now();
      let lastCapture = 0;
      let yaws = [];
      let baseYaw = 0.5;
      let liveness = createLiveness(challengeType);
      let challengeStart = 0;
      let before = [];
      let after = [];

      const go = (s, msg) => {
        step = s;
        setPhase(s);
        if (msg) setMessage(msg);
      };
      const reset = (msg) => {
        before = [];
        after = [];
        yaws = [];
        stable = 0;
        setProgress(0);
        go('position', msg);
      };
      go('position', 'Look at the camera');

      while (!stopped) {
        await sleepFrame();
        const now = performance.now();
        const descriptor =
          (step === 'capture' && now - lastCapture > 120) || (step === 'return' && now - lastCapture > 120);
        let f;
        try {
          f = await analyze(video, { descriptor, expressions: step === 'challenge' && liveness.needsExpressions });
        } catch {
          continue;
        }
        if (stopped) return;
        draw(f);

        if (!f) {
          if (step !== 'position' && now - lastSeen > 1500) reset('Face lost. Look at the camera again.');
          else if (step === 'position') setMessage('Looking for your face…');
          continue;
        }
        lastSeen = now;
        // "Straight" is loose here; liveness is measured relative to the user's own pose.
        const facingCamera = Math.abs(f.yaw - 0.5) < 0.14;

        if (step === 'position') {
          if (!f.bigEnough) setMessage('Move a little closer');
          else if (f.tooClose) setMessage('Move back a little');
          else if (!f.centered) setMessage('Center your face in the circle');
          else if (!facingCamera) setMessage('Look straight at the camera');
          else if (++stable >= 2) go('capture', 'Hold still…');
          setProgress(Math.min(0.15, stable * 0.07));
        } else if (step === 'capture') {
          if (f.descriptor && facingCamera) {
            yaws.push(f.yaw);
            before.push(f.descriptor);
            lastCapture = now;
            setProgress(0.15 + (before.length / needBefore) * 0.2);
            if (before.length >= needBefore) {
              baseYaw = [...yaws].sort((a, b) => a - b)[Math.floor(yaws.length / 2)]; // median
              liveness = createLiveness(challengeType, baseYaw);
              challengeStart = now;
              go('challenge', CHALLENGE_INFO[challengeType].text);
            }
          }
        } else if (step === 'challenge') {
          const p = liveness.update(f);
          setProgress(0.35 + p * 0.5);
          if (liveness.passed) {
            go('return', 'Now look back at the camera');
          } else if (now - challengeStart > 8000) {
            liveness = createLiveness(challengeType, baseYaw);
            challengeStart = now;
            setMessage(`A bit more! ${CHALLENGE_INFO[challengeType].text}`);
          }
        } else if (step === 'return') {
          if (f.descriptor && Math.abs(f.yaw - baseYaw) < 0.07) {
            after.push(f.descriptor);
            lastCapture = now;
            setProgress(0.85 + (after.length / needAfter) * 0.15);
            if (after.length >= needAfter) {
              stopped = true;
              go('done', 'Face captured');
              setProgress(1);
              stream?.getTracks().forEach((t) => t.stop());
              doneRef.current?.({
                descriptors: [...before, ...after],
                liveness: { challenge: challengeType, passed: true },
              });
              return;
            }
          }
        }
      }
    }

    // Landmark overlay - mirrors the cover-cropped, mirrored video.
    function draw(f) {
      const c = canvasRef.current;
      if (!c) return;
      const size = c.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== size * dpr) {
        c.width = size * dpr;
        c.height = size * dpr;
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      if (!f) return;
      const scale = Math.max(size / f.vw, size / f.vh);
      const ox = (size - f.vw * scale) / 2;
      const oy = (size - f.vh * scale) / 2;
      ctx.fillStyle = 'rgba(120, 255, 214, 0.85)';
      for (const p of f.points) {
        const x = size - (p.x * scale + ox);
        const y = p.y * scale + oy;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    start().catch((e) => {
      if (!stopped) {
        setFatal(e.message || 'Could not start the camera');
        setPhase('error');
      }
    });

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, challengeType]);

  const info = CHALLENGE_INFO[challengeType];
  const ringClass = phase === 'done' ? 'ok' : phase === 'challenge' ? 'active' : '';

  return (
    <div className="scanner">
      {title && <h2 className="scanner-title">{title}</h2>}
      {subtitle && <p className="muted center">{subtitle}</p>}
      <div className={`scanner-frame ${phase}`}>
        <video ref={videoRef} playsInline muted className="scanner-video" />
        <canvas ref={canvasRef} className="scanner-canvas" />
        {phase !== 'done' && phase !== 'error' && <div className="scan-line" />}
        {phase === 'loading' && <div className="scanner-overlay"><div className="spinner" /></div>}
        {phase === 'done' && <div className="scanner-overlay ok-overlay"><span className="big-check">✓</span></div>}
        <svg className={`ring ${ringClass}`} viewBox="0 0 300 300">
          <circle cx="150" cy="150" r="140" className="ring-bg" />
          <circle
            cx="150"
            cy="150"
            r="140"
            className="ring-fg"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - progress)}
          />
        </svg>
      </div>

      {fatal ? (
        <p className="error-text center">{fatal}</p>
      ) : (
        <div className="scanner-msg">
          {phase === 'challenge' && <span className="challenge-icon">{info.icon}</span>}
          <span>{message}</span>
        </div>
      )}

      <div className="liveness-steps">
        <Step label="Face found" done={['capture', 'challenge', 'return', 'done'].includes(phase)} />
        <Step label="Liveness" done={['return', 'done'].includes(phase)} />
        <Step label="Signature" done={phase === 'done'} />
      </div>
      <p className="tiny muted center">🔒 Processed on your device. Only a 128-number face signature is sent, never your photo.</p>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function Step({ label, done }) {
  return <span className={`lstep ${done ? 'done' : ''}`}>{done ? '✓' : '•'} {label}</span>;
}
