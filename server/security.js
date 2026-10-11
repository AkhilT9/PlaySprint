import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.FACEPAY_SECRET || randomBytes(32).toString('hex');

// ---- PIN hashing (scrypt + per-user salt) ----
export function hashPin(pin) {
  const pinSalt = randomBytes(16).toString('hex');
  const pinHash = scryptSync(String(pin), pinSalt, 32).toString('hex');
  return { pinSalt, pinHash };
}

export function verifyPin(user, pin) {
  const hash = scryptSync(String(pin), user.pinSalt, 32);
  return timingSafeEqual(hash, Buffer.from(user.pinHash, 'hex'));
}

// ---- Signed tokens (HMAC, JWT-like) ----
export function sign(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp < Date.now() ? null : payload;
  } catch {
    return null;
  }
}

// ---- Face math ----
// face-api produces 128-d embeddings; same person is typically < 0.45 apart.
export const MATCH_THRESHOLD = 0.5; // 1:1 verification (payer's own phone)
export const IDENTIFY_THRESHOLD = 0.45; // 1:N identification (merchant terminal) - stricter
export const IDENTIFY_MARGIN = 0.06; // best match must beat runner-up by this much

export function isDescriptor(d) {
  return Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < 128; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function mean(descriptors) {
  const m = new Array(128).fill(0);
  for (const d of descriptors) for (let i = 0; i < 128; i++) m[i] += d[i] / descriptors.length;
  return m;
}

// Distance of a live capture against an enrolled face template.
export function faceDistance(face, probe) {
  const toMean = distance(face.mean, probe);
  const toBest = Math.min(...face.samples.map((s) => distance(s, probe)));
  return (toMean + toBest) / 2;
}

// Human-friendly 0-100 "match score" for the UI.
// 0.0 -> 100, threshold (0.5) -> 60, anything worse drops off quickly.
export function score(dist) {
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (dist / MATCH_THRESHOLD) ** 2 * 0.4))));
}
