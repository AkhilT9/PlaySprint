// Tiny JSON-file database. Good enough for a hackathon demo, zero setup.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hashPin } from './security.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
export const DB_FILE = join(DATA_DIR, 'db.json');

const STARTING_BALANCE = 10_000_00; // ₹10,000 in paise

function seed() {
  const demo = (name, phone, upiId, type = 'demo') => ({
    id: randomUUID(),
    name,
    phone,
    upiId,
    type,
    ...hashPin('0000'),
    balance: 5_000_00,
    face: null,
    failedPin: 0,
    lockedUntil: 0,
    createdAt: Date.now(),
  });
  return {
    users: [
      demo('Rahul Sharma', '9000000001', 'rahul@facepay'),
      demo('Priya Patel', '9000000002', 'priya@facepay'),
      demo('Aman Verma', '9000000003', 'aman@facepay'),
      demo('Campus Café', '9000000100', 'campuscafe@facepay', 'merchant'),
    ],
    transactions: [],
  };
}

let state;

export function load() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) {
    state = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } else {
    state = seed();
    save();
  }
  return state;
}

export function save() {
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, DB_FILE);
}

export const db = {
  get users() {
    return state.users;
  },
  get transactions() {
    return state.transactions;
  },
  userById: (id) => state.users.find((u) => u.id === id),
  userByPhone: (phone) => state.users.find((u) => u.phone === phone),
  userByUpi: (upiId) => state.users.find((u) => u.upiId.toLowerCase() === String(upiId).toLowerCase()),
  createUser({ name, phone, pin }) {
    const base = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) || 'user';
    let upiId = `${base}${phone.slice(-2)}@facepay`;
    let n = 1;
    while (db.userByUpi(upiId)) upiId = `${base}${phone.slice(-2)}${n++}@facepay`;
    const user = {
      id: randomUUID(),
      name,
      phone,
      upiId,
      type: 'user',
      ...hashPin(pin),
      balance: STARTING_BALANCE,
      face: null,
      failedPin: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
    };
    state.users.push(user);
    save();
    return user;
  },
  // Moves money atomically (single-threaded Node = no races within a process).
  transfer({ from, to, amount, note, method, matchScore, latencyMs }) {
    if (from.balance < amount) throw new Error('Insufficient balance');
    from.balance -= amount;
    to.balance += amount;
    const txn = {
      id: `FP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      from: from.id,
      to: to.id,
      amount,
      note: note || '',
      method,
      matchScore: matchScore ?? null,
      latencyMs: latencyMs ?? null,
      status: 'SUCCESS',
      createdAt: Date.now(),
    };
    state.transactions.push(txn);
    save();
    return txn;
  },
};
