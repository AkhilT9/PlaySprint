import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db, load, save } from './db.js';
import {
  IDENTIFY_MARGIN,
  IDENTIFY_THRESHOLD,
  MATCH_THRESHOLD,
  distance,
  faceDistance,
  hashPin,
  isDescriptor,
  mean,
  score,
  sign,
  verify,
  verifyPin,
} from './security.js';

load();

const PORT = process.env.PORT || 3000;
const FACE_ONLY_LIMIT = 2_000_00; // above ₹2,000 a payment needs face + PIN
const TERMINAL_LIMIT = 2_000_00; // merchant face-terminal cap
const UPI_TXN_LIMIT = 1_00_000_00; // ₹1 lakh
const MAX_FACE_ATTEMPTS = 3;
const MAX_PIN_ATTEMPTS = 5;
const CHALLENGES = ['turnLeft', 'turnRight']; // quick head turns - no smiling on demand

const app = express();
app.use(express.json({ limit: '200kb' }));

// ---------- helpers ----------
class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function auth(req, _res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const payload = verify(token);
  const user = payload?.uid && db.userById(payload.uid);
  if (!user || payload.kind !== 'session') return next(new ApiError(401, 'Please log in again'));
  req.user = user;
  next();
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  upiId: u.upiId,
  type: u.type,
  hasFace: Boolean(u.face),
});

const session = (u) => sign({ uid: u.id, kind: 'session' }, 7 * 24 * 3600 * 1000);

function toPaise(amount) {
  const paise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(paise) || paise < 100) throw new ApiError(400, 'Minimum amount is ₹1');
  if (paise > UPI_TXN_LIMIT) throw new ApiError(400, 'UPI limit is ₹1,00,000 per transaction');
  return paise;
}

// The client sends several embeddings captured across the liveness challenge.
// They must all be the same face (blocks swapping a photo in mid-scan).
function probeFrom(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length < 2 || descriptors.length > 10 || !descriptors.every(isDescriptor)) {
    throw new ApiError(400, 'Face scan incomplete, please try again');
  }
  for (let i = 0; i < descriptors.length; i++)
    for (let j = i + 1; j < descriptors.length; j++)
      if (distance(descriptors[i], descriptors[j]) > 0.5)
        throw new ApiError(422, 'Face changed during scan. Hold steady and retry.');
  return mean(descriptors);
}

function checkPinLock(user) {
  if (user.lockedUntil > Date.now()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new ApiError(423, `Too many wrong PINs. Try again in ${mins} min.`);
  }
}

function checkPin(user, pin) {
  checkPinLock(user);
  if (!/^\d{4,6}$/.test(String(pin ?? '')) || !verifyPin(user, pin)) {
    user.failedPin += 1;
    if (user.failedPin >= MAX_PIN_ATTEMPTS) {
      user.lockedUntil = Date.now() + 5 * 60 * 1000;
      user.failedPin = 0;
    }
    save();
    throw new ApiError(401, 'Wrong PIN', { attemptsLeft: MAX_PIN_ATTEMPTS - user.failedPin });
  }
  user.failedPin = 0;
  save();
}

const txnView = (t, me) => {
  const outgoing = t.from === me.id;
  const other = db.userById(outgoing ? t.to : t.from);
  return {
    id: t.id,
    direction: outgoing ? 'out' : 'in',
    amount: t.amount / 100,
    note: t.note,
    method: t.method,
    matchScore: t.matchScore,
    latencyMs: t.latencyMs,
    createdAt: t.createdAt,
    counterparty: other ? { name: other.name, upiId: other.upiId, type: other.type } : null,
  };
};

// ---------- auth ----------
app.post('/api/register', route((req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  const pin = String(req.body.pin || '');
  if (name.length < 2) throw new ApiError(400, 'Enter your full name');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Enter a valid 10-digit mobile number');
  if (!/^\d{4}$/.test(pin)) throw new ApiError(400, 'Backup PIN must be 4 digits');
  if (db.userByPhone(phone)) throw new ApiError(409, 'This number is already registered. Log in instead.');
  const user = db.createUser({ name, phone, pin });
  res.json({ token: session(user), user: publicUser(user) });
}));

app.post('/api/login', route((req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  const user = db.userByPhone(phone);
  if (!user || user.type !== 'user') throw new ApiError(404, 'No FacePay account for this number');
  checkPin(user, req.body.pin);
  res.json({ token: session(user), user: publicUser(user) });
}));

app.post('/api/login/face', route((req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  const user = db.userByPhone(phone);
  if (!user || user.type !== 'user') throw new ApiError(404, 'No FacePay account for this number');
  if (!user.face) throw new ApiError(400, 'Face not set up for this account. Use your PIN.');
  if (!req.body.liveness?.passed) throw new ApiError(400, 'Liveness check failed');
  const dist = faceDistance(user.face, probeFrom(req.body.descriptors));
  if (dist > MATCH_THRESHOLD) throw new ApiError(401, "Face didn't match", { score: score(dist) });
  res.json({ token: session(user), user: publicUser(user), score: score(dist) });
}));

// ---------- face ----------
app.post('/api/face/enroll', auth, route((req, res) => {
  const { descriptors } = req.body;
  if (!req.body.liveness?.passed) throw new ApiError(400, 'Liveness check failed');
  if (!Array.isArray(descriptors) || descriptors.length < 3) throw new ApiError(400, 'Need at least 3 face samples');
  const template = probeFrom(descriptors);
  // Fraud check: one face = one account.
  for (const other of db.users) {
    if (other.id !== req.user.id && other.face && faceDistance(other.face, template) < 0.4) {
      throw new ApiError(409, 'This face is already linked to another FacePay account');
    }
  }
  req.user.face = { mean: template, samples: descriptors, enrolledAt: Date.now() };
  save();
  res.json({ ok: true, user: publicUser(req.user) });
}));

// Generic "prove it's you" - used to reveal balance, like GPay asks for the PIN.
app.post('/api/face/verify', auth, route((req, res) => {
  if (!req.user.face) throw new ApiError(400, 'Set up your face first');
  if (!req.body.liveness?.passed) throw new ApiError(400, 'Liveness check failed');
  const dist = faceDistance(req.user.face, probeFrom(req.body.descriptors));
  const ok = dist <= MATCH_THRESHOLD;
  if (!ok) throw new ApiError(401, "Face didn't match", { score: score(dist) });
  res.json({ ok, score: score(dist), balance: req.user.balance / 100 });
}));

// ---------- account ----------
app.get('/api/me', auth, (req, res) => {
  const me = req.user;
  const txns = db.transactions
    .filter((t) => t.from === me.id || t.to === me.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map((t) => txnView(t, me));
  res.json({ user: publicUser(me), transactions: txns });
});

app.get('/api/contacts', auth, (req, res) => {
  res.json(
    db.users
      .filter((u) => u.id !== req.user.id)
      .map((u) => ({ name: u.name, upiId: u.upiId, type: u.type }))
  );
});

app.get('/api/resolve', auth, (req, res, next) => {
  const u = db.userByUpi(req.query.upi || '');
  if (!u) return next(new ApiError(404, 'UPI ID not found on FacePay'));
  res.json({ name: u.name, upiId: u.upiId, type: u.type });
});

// ---------- payments ----------
const intents = new Map(); // short-lived, in memory

app.post('/api/pay/intent', auth, route((req, res) => {
  const payer = req.user;
  if (!payer.face) throw new ApiError(400, 'Set up FacePay (face) first');
  const payee = db.userByUpi(req.body.to || '');
  if (!payee) throw new ApiError(404, 'UPI ID not found on FacePay');
  if (payee.id === payer.id) throw new ApiError(400, "You can't pay yourself");
  const amount = toPaise(req.body.amount);
  if (amount > payer.balance) throw new ApiError(400, 'Insufficient balance');
  checkPinLock(payer);

  const intent = {
    id: randomUUID(),
    payer: payer.id,
    payee: payee.id,
    amount,
    note: String(req.body.note || '').slice(0, 60),
    challenge: CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)],
    requiresPin: amount > FACE_ONLY_LIMIT,
    faceAttempts: 0,
    faceVerified: false,
    matchScore: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3 * 60 * 1000,
  };
  intents.set(intent.id, intent);
  res.json({
    intentId: intent.id,
    payee: { name: payee.name, upiId: payee.upiId, type: payee.type },
    amount: amount / 100,
    challenge: intent.challenge,
    requiresPin: intent.requiresPin,
    faceOnlyLimit: FACE_ONLY_LIMIT / 100,
    expiresAt: intent.expiresAt,
  });
}));

function execute(intent, method, res) {
  const payer = db.userById(intent.payer);
  const payee = db.userById(intent.payee);
  let txn;
  try {
    txn = db.transfer({
      from: payer,
      to: payee,
      amount: intent.amount,
      note: intent.note,
      method,
      matchScore: intent.matchScore,
      latencyMs: Date.now() - intent.createdAt,
    });
  } catch (e) {
    throw new ApiError(400, e.message);
  }
  intents.delete(intent.id);
  res.json({ status: 'SUCCESS', txn: txnView(txn, payer), balance: payer.balance / 100 });
}

app.post('/api/pay/confirm', auth, route((req, res) => {
  const intent = intents.get(req.body.intentId);
  if (!intent || intent.payer !== req.user.id) throw new ApiError(404, 'Payment session not found. Start again.');
  if (intent.expiresAt < Date.now()) {
    intents.delete(intent.id);
    throw new ApiError(410, 'Payment session expired. Start again.');
  }

  if (req.body.method === 'face') {
    if (intent.faceAttempts >= MAX_FACE_ATTEMPTS)
      throw new ApiError(423, 'Too many face attempts. Use your PIN.', { fallbackToPin: true });
    const { liveness } = req.body;
    if (!liveness?.passed || liveness.challenge !== intent.challenge)
      throw new ApiError(400, 'Liveness check failed');
    const dist = faceDistance(req.user.face, probeFrom(req.body.descriptors));
    if (dist > MATCH_THRESHOLD) {
      intent.faceAttempts += 1;
      const left = MAX_FACE_ATTEMPTS - intent.faceAttempts;
      throw new ApiError(401, "Face didn't match", {
        score: score(dist),
        attemptsLeft: left,
        fallbackToPin: left <= 0,
      });
    }
    intent.faceVerified = true;
    intent.matchScore = score(dist);
    if (intent.requiresPin) return res.json({ status: 'NEED_PIN', score: intent.matchScore });
    return execute(intent, 'face', res);
  }

  if (req.body.method === 'pin') {
    // PIN alone is only allowed as a fallback after face failed; above the
    // face-only limit it is the second factor after a successful face match.
    const fallback = intent.faceAttempts >= MAX_FACE_ATTEMPTS;
    if (!intent.faceVerified && !fallback) throw new ApiError(400, 'Verify your face first');
    checkPin(req.user, req.body.pin);
    return execute(intent, intent.faceVerified ? 'face+pin' : 'pin', res);
  }

  throw new ApiError(400, 'Unknown method');
}));

// ---------- merchant face terminal (Smile-to-Pay) ----------
app.get('/api/merchants', (_req, res) => {
  res.json(db.users.filter((u) => u.type === 'merchant').map((u) => ({ name: u.name, upiId: u.upiId })));
});

const mask = (name) =>
  name
    .split(' ')
    .map((w) => (w.length <= 2 ? w : w[0] + '•'.repeat(w.length - 2) + w[w.length - 1]))
    .join(' ');

app.post('/api/merchant/identify', route((req, res) => {
  const merchant = db.userByUpi(req.body.merchant || '');
  if (!merchant || merchant.type !== 'merchant') throw new ApiError(404, 'Unknown merchant');
  const amount = toPaise(req.body.amount);
  if (amount > TERMINAL_LIMIT) throw new ApiError(400, `Face terminal limit is ₹${TERMINAL_LIMIT / 100}`);
  if (!req.body.liveness?.passed) throw new ApiError(400, 'Liveness check failed');
  const probe = probeFrom(req.body.descriptors);

  const ranked = db.users
    .filter((u) => u.type === 'user' && u.face)
    .map((u) => ({ u, d: faceDistance(u.face, probe) }))
    .sort((a, b) => a.d - b.d);
  const [best, second] = ranked;
  if (!best || best.d > IDENTIFY_THRESHOLD || (second && second.d - best.d < IDENTIFY_MARGIN)) {
    throw new ApiError(404, 'Face not recognised. Pay with UPI QR instead.');
  }
  const matchToken = sign(
    { kind: 'terminal', uid: best.u.id, merchant: merchant.id, amount, score: score(best.d) },
    90 * 1000
  );
  res.json({
    matchToken,
    maskedName: mask(best.u.name),
    phoneHint: `••••••${best.u.phone.slice(-4, -2)}••`,
    score: score(best.d),
  });
}));

app.post('/api/merchant/charge', route((req, res) => {
  const t = verify(req.body.matchToken);
  if (!t || t.kind !== 'terminal') throw new ApiError(410, 'Session expired. Scan again.');
  const payer = db.userById(t.uid);
  const merchant = db.userById(t.merchant);
  // Second factor: the customer types the last 4 digits of their phone number.
  if (String(req.body.last4 || '') !== payer.phone.slice(-4)) throw new ApiError(401, "Phone digits don't match");
  let txn;
  try {
    txn = db.transfer({
      from: payer,
      to: merchant,
      amount: t.amount,
      note: 'Face terminal payment',
      method: 'face-terminal',
      matchScore: t.score,
      latencyMs: null,
    });
  } catch (e) {
    throw new ApiError(400, e.message);
  }
  res.json({ status: 'SUCCESS', txnId: txn.id, amount: t.amount / 100, payer: mask(payer.name) });
}));

// ---------- demo helpers ----------
app.post('/api/demo/topup', auth, (req, res) => {
  req.user.balance += 5_000_00;
  save();
  res.json({ balance: req.user.balance / 100 });
});

app.post('/api/pin/change', auth, route((req, res) => {
  checkPin(req.user, req.body.oldPin);
  if (!/^\d{4}$/.test(String(req.body.newPin || ''))) throw new ApiError(400, 'PIN must be 4 digits');
  Object.assign(req.user, hashPin(req.body.newPin));
  save();
  res.json({ ok: true });
}));

// ---------- static client (production) ----------
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message, ...(err.extra || {}) });
});

app.listen(PORT, () => console.log(`FacePay API running on http://localhost:${PORT}`));
