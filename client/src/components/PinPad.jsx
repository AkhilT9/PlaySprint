import { useEffect, useState } from 'react';

// Numeric keypad with dots. Used for backup PIN and phone-digit confirmation.
export default function PinPad({ length = 4, title, hint, error, onComplete, busy, mask = true }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (error) setValue('');
  }, [error]);

  const press = (k) => {
    if (busy) return;
    if (k === '⌫') return setValue(value.slice(0, -1));
    if (value.length >= length) return;
    const next = value + k;
    setValue(next);
    if (next.length === length) setTimeout(() => onComplete(next), 120);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('⌫');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pinpad">
      {title && <h2 className="center">{title}</h2>}
      {hint && <p className="muted center">{hint}</p>}
      <div className={`pin-dots ${error ? 'shake' : ''}`}>
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`pin-dot ${i < value.length ? 'filled' : ''}`}>
            {!mask && value[i]}
          </span>
        ))}
      </div>
      {error && <p className="error-text center">{error}</p>}
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k ? (
            <button key={i} className="key" onClick={() => press(k)} disabled={busy}>
              {k}
            </button>
          ) : (
            <span key={i} />
          )
        )}
      </div>
    </div>
  );
}
