// Wipes the demo database (users, faces, transactions). Restart the server afterwards.
import { rmSync } from 'node:fs';
import { DB_FILE } from './db.js';

rmSync(DB_FILE, { force: true });
console.log('FacePay demo data reset.');
