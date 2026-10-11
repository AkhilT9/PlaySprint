// Standalone mode (GitHub Pages): the same API as server/index.js, but running
// in the browser with data kept in localStorage. Used when VITE_STANDALONE=1.

const DB_KEY = 'facepay.standalone.db';
const FACE_ONLY_LIMIT = 2_000_00;
const TERMINAL_LIMIT = 2_000_00;
const UPI_TXN_LIMIT = 1_00_000_00;
const MAX_FACE_ATTEMPTS = 3;
const MAX_PIN_ATTEMPTS = 5;
const CHALLENGES = ['turnLeft', 'turnRight'];
const MATCH_THRESHOLD = 0.5;
const IDENTIFY_THRESHOLD = 0.45;
const IDENTIFY_MARGIN = 0.06;

class Fail extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.data = { error, ...extra };
  }
}

const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPin(pin) {
  const pinSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { pinSalt, pinHash: await digest(pinSalt, pin) };
}
async function digest(salt, pin) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}

// ---------- storage ----------
let state;
async function load() {
  if (state) return state;
  try {
    state = JSON.parse(localStorage.getItem(DB_KEY));
  } catch {
    state = null;
  }
  if (!state) {
    const demo = async (name, phone, upiId, type = 'demo') => ({
      id: uuid(), name, phone, upiId, type, ...(await hashPin('0000')),
      balance: 5_000_00, face: null, failedPin: 0, lockedUntil: 0, createdAt: Date.now(),
    });
    state = {
      users: [
        await demo('Rahul Sharma', '9000000001', 'rahul@facepay'),
        await demo('Priya Patel', '9000000002', 'priya@facepay'),
        await demo('Aman Verma', '9000000003', 'aman@facepay'),
        await demo('Campus Café', '9000000100', 'campuscafe@facepay', 'merchant'),
      ],
      transactions: [],
      sessions: {},
    };
    save();
  }
  return state;
}
function save() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked - keep going in memory */
  }
}

const userById = (id) => state.users.find((u) => u.id === id);
const userByPhone = (p) => state.users.find((u) => u.phone === p);
const userByUpi = (upi) => state.users.find((u) => u.upiId.toLowerCase() === String(upi).toLowerCase());

// ---------- face math (same as server/security.js) ----------
const isDescriptor = (d) => Array.isArray(d) && d.length === 128 && d.every((x) => Number.isFinite(x));
function distance(a, b) {
  let s = 0;
  for (let i = 0; i < 128; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}
function mean(ds) {
  const m = new Array(128).fill(0);
  for (const d of ds) for (let i = 0; i < 128; i++) m[i] += d[i] / ds.length;
  return m;
}
const faceDistance = (face, probe) =>
  (distance(face.mean, probe) + Math.min(...face.samples.map((s) => distance(s, probe)))) / 2;
const score = (d) => Math.max(0, Math.min(100, Math.round(100 * (1 - (d / MATCH_THRESHOLD) ** 2 * 0.4))));

function probeFrom(ds) {
  if (!Array.isArray(ds) || ds.length < 2 || ds.length > 10 || !ds.every(isDescriptor))
    throw new Fail(400, 'Face scan incomplete, please try again');
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++)
      if (distance(ds[i], ds[j]) > 0.5) throw new Fail(422, 'Face changed during scan. Hold steady and retry.');
  return mean(ds);
}

// ---------- helpers ----------
const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone, upiId: u.upiId, type: u.type, hasFace: Boolean(u.face) });
function session(u) {
  const token = uuid();
  state.sessions[token] = u.id;
  save();
  return token;
}
function toPaise(amount) {
  const p = Math.round(Number(amount) * 100);
  if (!Number.isFinite(p) || p < 100) throw new Fail(400, 'Minimum amount is ₹1');
  if (p > UPI_TXN_LIMIT) throw new Fail(400, 'UPI limit is ₹1,00,000 per transaction');
  return p;
}
function checkPinLock(u) {
  if (u.lockedUntil > Date.now())
    throw new Fail(423, `Too many wrong PINs. Try again in ${Math.ceil((u.lockedUntil - Date.now()) / 60000)} min.`);
}
async function checkPin(u, pin) {
  checkPinLock(u);
  if (!/^\d{4,6}$/.test(String(pin ?? '')) || (await digest(u.pinSalt, pin)) !== u.pinHash) {
    u.failedPin += 1;
    if (u.failedPin >= MAX_PIN_ATTEMPTS) {
      u.lockedUntil = Date.now() + 5 * 60 * 1000;
      u.failedPin = 0;
    }
    save();
    throw new Fail(401, 'Wrong PIN', { attemptsLeft: MAX_PIN_ATTEMPTS - u.failedPin });
  }
  u.failedPin = 0;
  save();
}
function transfer({ from, to, amount, note, method, matchScore, latencyMs }) {
  if (from.balance < amount) throw new Fail(400, 'Insufficient balance');
  from.balance -= amount;
  to.balance += amount;
  const txn = {
    id: `FP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    from: from.id, to: to.id, amount, note: note || '', method,
    matchScore: matchScore ?? null, latencyMs: latencyMs ?? null, status: 'SUCCESS', createdAt: Date.now(),
  };
  state.transactions.push(txn);
  save();
  return txn;
}
function txnView(t, me) {
  const out = t.from === me.id;
  const o = userById(out ? t.to : t.from);
  return {
    id: t.id, direction: out ? 'out' : 'in', amount: t.amount / 100, note: t.note, method: t.method,
    matchScore: t.matchScore, latencyMs: t.latencyMs, createdAt: t.createdAt,
    counterparty: o ? { name: o.name, upiId: o.upiId, type: o.type } : null,
  };
}
const mask = (name) =>
  name.split(' ').map((w) => (w.length <= 2 ? w : w[0] + '•'.repeat(w.length - 2) + w[w.length - 1])).join(' ');

const intents = new Map();
const terminalMatches = new Map();

// ---------- routes ----------
async function route(method, path, query, body, token) {
  await load();
  const me = () => {
    const u = userById(state.sessions[token]);
    if (!u) throw new Fail(401, 'Please log in again');
    return u;
  };
  const key = `${method} ${path}`;

  switch (key) {
    case 'POST /register': {
      const name = String(body.name || '').trim();
      const phone = String(body.phone || '').replace(/\D/g, '');
      const pin = String(body.pin || '');
      if (name.length < 2) throw new Fail(400, 'Enter your full name');
      if (!/^[6-9]\d{9}$/.test(phone)) throw new Fail(400, 'Enter a valid 10-digit mobile number');
      if (!/^\d{4}$/.test(pin)) throw new Fail(400, 'Backup PIN must be 4 digits');
      if (userByPhone(phone)) throw new Fail(409, 'This number is already registered. Log in instead.');
      const base = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) || 'user';
      let upiId = `${base}${phone.slice(-2)}@facepay`;
      for (let n = 1; userByUpi(upiId); n++) upiId = `${base}${phone.slice(-2)}${n}@facepay`;
      const u = {
        id: uuid(), name, phone, upiId, type: 'user', ...(await hashPin(pin)),
        balance: 10_000_00, face: null, failedPin: 0, lockedUntil: 0, createdAt: Date.now(),
      };
      state.users.push(u);
      save();
      return { token: session(u), user: publicUser(u) };
    }
    case 'POST /login': {
      const u = userByPhone(String(body.phone || '').replace(/\D/g, ''));
      if (!u || u.type !== 'user') throw new Fail(404, 'No FacePay account for this number');
      await checkPin(u, body.pin);
      return { token: session(u), user: publicUser(u) };
    }
    case 'POST /login/face': {
      const u = userByPhone(String(body.phone || '').replace(/\D/g, ''));
      if (!u || u.type !== 'user') throw new Fail(404, 'No FacePay account for this number');
      if (!u.face) throw new Fail(400, 'Face not set up for this account. Use your PIN.');
      if (!body.liveness?.passed) throw new Fail(400, 'Liveness check failed');
      const d = faceDistance(u.face, probeFrom(body.descriptors));
      if (d > MATCH_THRESHOLD) throw new Fail(401, "Face didn't match", { score: score(d) });
      return { token: session(u), user: publicUser(u), score: score(d) };
    }
    case 'POST /face/enroll': {
      const u = me();
      if (!body.liveness?.passed) throw new Fail(400, 'Liveness check failed');
      if (!Array.isArray(body.descriptors) || body.descriptors.length < 3) throw new Fail(400, 'Need at least 3 face samples');
      const template = probeFrom(body.descriptors);
      for (const o of state.users)
        if (o.id !== u.id && o.face && faceDistance(o.face, template) < 0.4)
          throw new Fail(409, 'This face is already linked to another FacePay account');
      u.face = { mean: template, samples: body.descriptors, enrolledAt: Date.now() };
      save();
      return { ok: true, user: publicUser(u) };
    }
    case 'POST /face/verify': {
      const u = me();
      if (!u.face) throw new Fail(400, 'Set up your face first');
      if (!body.liveness?.passed) throw new Fail(400, 'Liveness check failed');
      const d = faceDistance(u.face, probeFrom(body.descriptors));
      if (d > MATCH_THRESHOLD) throw new Fail(401, "Face didn't match", { score: score(d) });
      return { ok: true, score: score(d), balance: u.balance / 100 };
    }
    case 'GET /me': {
      const u = me();
      const txns = state.transactions
        .filter((t) => t.from === u.id || t.to === u.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((t) => txnView(t, u));
      return { user: publicUser(u), transactions: txns };
    }
    case 'GET /contacts': {
      const u = me();
      return state.users.filter((o) => o.id !== u.id).map((o) => ({ name: o.name, upiId: o.upiId, type: o.type }));
    }
    case 'GET /resolve': {
      me();
      const o = userByUpi(query.upi || '');
      if (!o) throw new Fail(404, 'UPI ID not found on FacePay');
      return { name: o.name, upiId: o.upiId, type: o.type };
    }
    case 'POST /pay/intent': {
      const payer = me();
      if (!payer.face) throw new Fail(400, 'Set up FacePay (face) first');
      const payee = userByUpi(body.to || '');
      if (!payee) throw new Fail(404, 'UPI ID not found on FacePay');
      if (payee.id === payer.id) throw new Fail(400, "You can't pay yourself");
      const amount = toPaise(body.amount);
      if (amount > payer.balance) throw new Fail(400, 'Insufficient balance');
      checkPinLock(payer);
      const it = {
        id: uuid(), payer: payer.id, payee: payee.id, amount, note: String(body.note || '').slice(0, 60),
        challenge: CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)],
        requiresPin: amount > FACE_ONLY_LIMIT, faceAttempts: 0, faceVerified: false, matchScore: null,
        createdAt: Date.now(), expiresAt: Date.now() + 3 * 60 * 1000,
      };
      intents.set(it.id, it);
      return {
        intentId: it.id, payee: { name: payee.name, upiId: payee.upiId, type: payee.type }, amount: amount / 100,
        challenge: it.challenge, requiresPin: it.requiresPin, faceOnlyLimit: FACE_ONLY_LIMIT / 100, expiresAt: it.expiresAt,
      };
    }
    case 'POST /pay/confirm': {
      const u = me();
      const it = intents.get(body.intentId);
      if (!it || it.payer !== u.id) throw new Fail(404, 'Payment session not found. Start again.');
      if (it.expiresAt < Date.now()) {
        intents.delete(it.id);
        throw new Fail(410, 'Payment session expired. Start again.');
      }
      const execute = (method) => {
        const txn = transfer({
          from: u, to: userById(it.payee), amount: it.amount, note: it.note, method,
          matchScore: it.matchScore, latencyMs: Date.now() - it.createdAt,
        });
        intents.delete(it.id);
        return { status: 'SUCCESS', txn: txnView(txn, u), balance: u.balance / 100 };
      };
      if (body.method === 'face') {
        if (it.faceAttempts >= MAX_FACE_ATTEMPTS) throw new Fail(423, 'Too many face attempts. Use your PIN.', { fallbackToPin: true });
        if (!body.liveness?.passed || body.liveness.challenge !== it.challenge) throw new Fail(400, 'Liveness check failed');
        const d = faceDistance(u.face, probeFrom(body.descriptors));
        if (d > MATCH_THRESHOLD) {
          it.faceAttempts += 1;
          const left = MAX_FACE_ATTEMPTS - it.faceAttempts;
          throw new Fail(401, "Face didn't match", { score: score(d), attemptsLeft: left, fallbackToPin: left <= 0 });
        }
        it.faceVerified = true;
        it.matchScore = score(d);
        if (it.requiresPin) return { status: 'NEED_PIN', score: it.matchScore };
        return execute('face');
      }
      if (body.method === 'pin') {
        if (!it.faceVerified && it.faceAttempts < MAX_FACE_ATTEMPTS) throw new Fail(400, 'Verify your face first');
        await checkPin(u, body.pin);
        return execute(it.faceVerified ? 'face+pin' : 'pin');
      }
      throw new Fail(400, 'Unknown method');
    }
    case 'GET /merchants':
      return state.users.filter((u) => u.type === 'merchant').map((u) => ({ name: u.name, upiId: u.upiId }));
    case 'POST /merchant/identify': {
      const merchant = userByUpi(body.merchant || '');
      if (!merchant || merchant.type !== 'merchant') throw new Fail(404, 'Unknown merchant');
      const amount = toPaise(body.amount);
      if (amount > TERMINAL_LIMIT) throw new Fail(400, `Face terminal limit is ₹${TERMINAL_LIMIT / 100}`);
      if (!body.liveness?.passed) throw new Fail(400, 'Liveness check failed');
      const probe = probeFrom(body.descriptors);
      const ranked = state.users
        .filter((u) => u.type === 'user' && u.face)
        .map((u) => ({ u, d: faceDistance(u.face, probe) }))
        .sort((a, b) => a.d - b.d);
      const [best, second] = ranked;
      if (!best || best.d > IDENTIFY_THRESHOLD || (second && second.d - best.d < IDENTIFY_MARGIN))
        throw new Fail(404, 'Face not recognised. Pay with UPI QR instead.');
      const matchToken = uuid();
      terminalMatches.set(matchToken, { uid: best.u.id, merchant: merchant.id, amount, score: score(best.d), exp: Date.now() + 90000 });
      return { matchToken, maskedName: mask(best.u.name), phoneHint: `••••••${best.u.phone.slice(-4, -2)}••`, score: score(best.d) };
    }
    case 'POST /merchant/charge': {
      const t = terminalMatches.get(body.matchToken);
      if (!t || t.exp < Date.now()) throw new Fail(410, 'Session expired. Scan again.');
      const payer = userById(t.uid);
      if (String(body.last4 || '') !== payer.phone.slice(-4)) throw new Fail(401, "Phone digits don't match");
      terminalMatches.delete(body.matchToken);
      const txn = transfer({ from: payer, to: userById(t.merchant), amount: t.amount, note: 'Face terminal payment', method: 'face-terminal', matchScore: t.score });
      return { status: 'SUCCESS', txnId: txn.id, amount: t.amount / 100, payer: mask(payer.name) };
    }
    case 'POST /demo/topup': {
      const u = me();
      u.balance += 5_000_00;
      save();
      return { balance: u.balance / 100 };
    }
    default:
      throw new Fail(404, 'Not found');
  }
}

export async function localApi(path, body, method) {
  const [p, qs = ''] = path.split('?');
  const token = (() => {
    try {
      return localStorage.getItem('facepay.token');
    } catch {
      return null;
    }
  })();
  try {
    return { ok: true, status: 200, data: await route(method, p, Object.fromEntries(new URLSearchParams(qs)), body || {}, token) };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, status: e.status, data: e.data };
    console.error(e);
    return { ok: false, status: 500, data: { error: 'Something went wrong' } };
  }
}
