// On-device face engine: detection, 68-point landmarks, expressions and the
// 128-d face embedding all run in the browser (TensorFlow.js / WebGL).
// Only the embeddings (128 numbers) ever leave the phone - never the photo.
import * as faceapi from '@vladmandic/face-api';

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
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const eyeAspect = (e) => (d2(e[1], e[5]) + d2(e[2], e[4])) / (2 * d2(e[0], e[3]));

/**
 * Analyse one video frame. Returns null when no face is found.
 * yaw: 0.5 = looking straight; > 0.5 = turned to the user's LEFT (raw, un-mirrored image).
 */
export async function analyze(video, withDescriptor = false) {
  let task = faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks().withFaceExpressions();
  if (withDescriptor) task = task.withFaceDescriptor();
  const r = await task;
  if (!r) return null;
  const lm = r.landmarks;
  const pts = lm.positions;
  const jawL = pts[0];
  const jawR = pts[16];
  const nose = pts[30];
  const box = r.detection.box;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  return {
    points: pts,
    box,
    vw,
    vh,
    ear: (eyeAspect(lm.getLeftEye()) + eyeAspect(lm.getRightEye())) / 2,
    yaw: (nose.x - jawL.x) / Math.max(1, jawR.x - jawL.x),
    happy: r.expressions.happy,
    centered:
      Math.abs(box.x + box.width / 2 - vw / 2) < vw * 0.2 && Math.abs(box.y + box.height / 2 - vh / 2) < vh * 0.22,
    bigEnough: box.width > vw * 0.22,
    tooClose: box.width > vw * 0.75,
    descriptor: r.descriptor ? Array.from(r.descriptor) : null,
  };
}

export const CHALLENGE_INFO = {
  smile: { icon: '😄', text: 'Give us a big smile' },
  blink: { icon: '😌', text: 'Blink slowly' },
  turnLeft: { icon: '👈', text: 'Turn your head to the left' },
  turnRight: { icon: '👉', text: 'Turn your head to the right' },
};

export const randomChallenge = () => {
  const list = ['smile', 'turnLeft', 'turnRight'];
  return list[Math.floor(Math.random() * list.length)];
};

/**
 * Stateful liveness detector. Every challenge needs a neutral "before" state
 * followed by the action, so a static photo can never pass.
 * update(frame) -> progress 0..1 (1 = passed)
 */
export function createLiveness(type) {
  let seenNeutral = false;
  let hits = 0;
  let baseEar = null;
  let closed = false;
  return {
    type,
    update(f) {
      switch (type) {
        case 'smile':
          if (f.happy < 0.4) seenNeutral = true;
          if (seenNeutral && f.happy > 0.75) hits++;
          return seenNeutral ? Math.min(1, Math.max(f.happy, hits / 2)) : 0.1;
        case 'turnLeft':
        case 'turnRight': {
          if (Math.abs(f.yaw - 0.5) < 0.1) seenNeutral = true;
          const turn = type === 'turnLeft' ? f.yaw - 0.5 : 0.5 - f.yaw;
          if (seenNeutral && turn > 0.17) hits++;
          return seenNeutral ? Math.min(1, Math.max(0, turn / 0.17) * 0.9 + (hits >= 2 ? 0.1 : 0)) : 0.1;
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
