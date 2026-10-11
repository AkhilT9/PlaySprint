import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { TopBar, useApp } from '../App.jsx';
import { rupees } from '../lib/api.js';

export default function MyQR() {
  const { me } = useApp();
  const [amount, setAmount] = useState('');
  const [src, setSrc] = useState('');
  const { name, upiId } = me.user;

  useEffect(() => {
    const params = new URLSearchParams({ pa: upiId, pn: name, cu: 'INR' });
    if (Number(amount) > 0) params.set('am', amount);
    QRCode.toDataURL(`upi://pay?${params}`, { width: 520, margin: 1, color: { dark: '#1b1340', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => {});
  }, [amount, name, upiId]);

  return (
    <div className="screen">
      <TopBar title="My QR" />
      <div className="card qr-card">
        <b>{name}</b>
        <small className="muted">{upiId}</small>
        {src && <img src={src} alt={`UPI QR for ${upiId}`} />}
        <small className="muted">
          Scan with FacePay to pay {Number(amount) > 0 ? rupees(Number(amount)) : 'me'}
        </small>
      </div>
      <label className="form">
        Request a specific amount (optional)
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} inputMode="numeric" placeholder="₹ amount" />
      </label>
    </div>
  );
}
