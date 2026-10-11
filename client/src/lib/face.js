// On-device face engine: detection, 68-point landmarks and the 128-d face
// embedding all run in the browser (TensorFlow.js / WebGL).
// Only the embeddings (128 numbers) ever leave the phone - never the photo.
import * as faceapi from '@vladmandic/face-api';

const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });

let loading;
export function loadModels() {
  if (!loading) {
    loading = (async () => {
      try {
        await faceapi.tf.setBackend('webgl');
      } catch {
        /* falls back to cpu/wasm automatically */
      }
      await faceapi.tf.ready();
      const url = `${import.meta.env.BASE_URL}models`;
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68Net.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
        faceapi.nets.faceExpressionNet.loadFromUri(url),
      ]);
      await warmUp();
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

// The first WebGL inference compiles shaders and can take seconds. Run every
// net once on a blank canvas in the background so the real scan is instant.
async function warmUp() {
  const c = document.createElement('canvas');
  c.width = 224;
  c.height = 224;
  try {
    await faceapi.nets.tinyFaceDetector.locateFaces(c, detectorOptions);
    await faceapi.nets.faceLandmark68Net.detectLandmarks(c);
    await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(c);
  } catch {
    /* warm-up is best effort */
  }
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const eyeAspect = (e) => (d2(e[1], e[5]) + d2(e[2], e[4])) / (2 * d2(e[0], e[3]));

/**
 * Analyse one video frame. Returns null when no face is found.
 * yaw: ~0.5 = looking straight; higher = turned to the user's LEFT (raw, un-mirrored image).
 * Expressions are only computed when asked for (smile challenge) - they cost a model pass.
 */
export async function analyze(video, { descriptor = false, expressions = false } = {}) {
  let task = faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks();
  if (expressions) task = task.withFaceExpressions();
  if (descriptor) task = task.withFaceDescriptor();
  const r = await task;
  if (!r) return null;
  const lm = r.landmarks;
  const pts = lm.positions;
  const jawL = pts[0];
  const jawR = pts[16];
  const nose = pts[30];
  const box = r.detection.box;
  const vw = video.videoWidth || video.width;
  const vh = video.videoHeight || video.height;
  return {
    points: pts,
    box,
    vw,
    vh,
    ear: (eyeAspect(lm.getLeftEye()) + eyeAspect(lm.getRightEye())) / 2,
    yaw: (nose.x - jawL.x) / Math.max(1, jawR.x - jawL.x),
    happy: r.expressions?.happy ?? 0,
    centered:
      Math.abs(box.x + box.width / 2 - vw / 2) < vw * 0.22 && Math.abs(box.y + box.height / 2 - vh / 2) < vh * 0.25,
    bigEnough: box.width > vw * 0.2,
    tooClose: box.width > vw * 0.8,
    descriptor: r.descriptor ? Array.from(r.descriptor) : null,
  };
}

export const CHALLENGE_INFO = {
  smile: { icon: '😄', text: 'Smile' },
  blink: { icon: '😌', text: 'Blink slowly' },
  turnLeft: { icon: '👈', text: 'Turn your head slightly left' },
  turnRight: { icon: '👉', text: 'Turn your head slightly right' },
};

// Head turns: quick, natural, work with glasses and in any lighting.
export const randomChallenge = () => (Math.random() < 0.5 ? 'turnLeft' : 'turnRight');

const TURN = 0.11; // yaw change needed, relative to the user's own straight pose

/**
 * Stateful liveness detector. A challenge only passes on *movement* away from
 * the pose seen while capturing, so a static photo can never pass.
 * baseYaw: the user's natural "straight" yaw, measured during capture.
 * update(frame) -> progress 0..1
 */
export function createLiveness(type, baseYaw = 0.5) {
  let seenNeutral = false;
  let hits = 0;
  let baseEar = null;
  let closed = false;
  return {
    type,
    needsExpressions: type === 'smile',
    update(f) {
      switch (type) {
        case 'smile':
          if (f.happy < 0.5) seenNeutral = true;
          if (seenNeutral && f.happy > 0.6) hits++;
          return seenNeutral ? Math.min(1, Math.max(f.happy, hits / 2)) : 0.1;
        case 'turnLeft':
        case 'turnRight': {
          const turn = type === 'turnLeft' ? f.yaw - baseYaw : baseYaw - f.yaw;
          if (turn > TURN) hits++;
          return Math.min(1, Math.max(0, turn / TURN));
        }
        case 'blink': {
          if (baseEar === null) baseEar = f.ear;
          if (!closed) baseEar = baseEar * 0.85 + Math.max(baseEar, f.ear) * 0.15;
          if (!closed && f.ear < baseEar * 0.78) closed = true;
          if (closed && f.ear > baseEar * 0.9) hits = 2;
          return hits >= 2 ? 1 : closed ? 0.6 : 0.2;
        }
        default:
          return 1;
      }
    },
    get passed() {
      return hits >= 2;
    },
  };
}
