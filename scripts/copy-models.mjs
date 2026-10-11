// Copies the face-api model weights into client/public/models so they are served
// locally (no CDN needed - works on flaky hackathon Wi-Fi).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
const dest = join(root, 'client', 'public', 'models');
const files = [
  'tiny_face_detector_model',
  'face_landmark_68_model',
  'face_recognition_model',
  'face_expression_model',
];

if (!existsSync(src)) {
  console.warn('[facepay] face-api models not found, skipping copy');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of files) {
  cpSync(join(src, `${f}.bin`), join(dest, `${f}.bin`));
  cpSync(join(src, `${f}-weights_manifest.json`), join(dest, `${f}-weights_manifest.json`));
}
console.log(`[facepay] copied ${files.length} face models to client/public/models`);
