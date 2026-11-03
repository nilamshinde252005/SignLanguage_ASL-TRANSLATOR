/**
 * My own sign model, for words the 250-sign model doesn't know (like NAME). It reads one sign
 * clip (both hands + body, see signClips.ts) and was trained in training/train_signs.ipynb.
 */
import { BASE_PATH, startLiteRt } from './classifier';

export const SIGN_FRAMES = 24; // every clip is stretched or squashed to this many frames
export const SIGN_FEATURES = 96; // 47 points × (x, y) + "signing hand seen" + "other hand seen"
export const MIN_MY_SIGN_CONFIDENCE = 0.8; // only use my model's answer if it is at least 80% sure
const MODEL_URL = `${BASE_PATH}/models/my_signs/my_signs.tflite`;
const LABELS_URL = `${BASE_PATH}/models/my_signs/my_signs.json`;

// Where things are inside a clip frame (in points; each point is x, y, z).
const LEFT_HAND = 0;
const RIGHT_HAND = 21;
const BODY = 42;
const NOSE = BODY;
const SHOULDER = { left: BODY + 11, right: BODY + 12 };
const ELBOW = { left: BODY + 13, right: BODY + 14 };
const WRIST = { left: BODY + 15, right: BODY + 16 };

type XY = [number, number];
type Side = 'left' | 'right';

/** A point's missing frames copy the last frame it was seen in (or the first one, at the start). Never seen → 0. */
function fillGaps(track: XY[]): XY[] {
  const first = track.findIndex(([x]) => !Number.isNaN(x));
  if (first < 0) return track.map((): XY => [0, 0]);
  const filled = track.slice();
  for (let t = 0; t < first; t++) filled[t] = track[first];
  for (let t = first + 1; t < filled.length; t++) if (Number.isNaN(filled[t][0])) filled[t] = filled[t - 1];
  return filled;
}

/** Stretches or squashes a clip to exactly `count` frames, blending neighbouring frames (like numpy's linspace). */
function resample(frames: number[][], count = SIGN_FRAMES): number[][] {
  const step = (frames.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, k) => {
    const t = k === count - 1 ? frames.length - 1 : k * step;
    const before = Math.floor(t);
    const after = Math.min(before + 1, frames.length - 1);
    const mix = t - before;
    return frames[before].map((v, i) => v * (1 - mix) + frames[after][i] * mix);
  });
}

/** One sign clip → 24 × 96 numbers, the same recipe as sign_features() in the notebook. */
export function signFeatures(clip: Float32Array[]): Float32Array {
  const point = (frame: Float32Array, p: number): XY => [frame[p * 3], frame[p * 3 + 1]];

  // 1. Measure everything from the middle of the shoulders, in shoulder widths.
  const shoulders = clip
    .map((frame) => [point(frame, SHOULDER.left), point(frame, SHOULDER.right)])
    .filter(([l, r]) => !Number.isNaN(l[0]) && !Number.isNaN(r[0]));
  let centre: XY = [0.5, 0.6]; // a guess, for when the shoulders aren't seen
  let width = 0.3;
  const meanWidth = shoulders.reduce((sum, [l, r]) => sum + Math.hypot(l[0] - r[0], l[1] - r[1]), 0) / shoulders.length;
  if (shoulders.length && meanWidth > 0) {
    centre = [0, 1].map((a) => shoulders.reduce((sum, [l, r]) => sum + (l[a] + r[a]) / 2, 0) / shoulders.length) as XY;
    width = meanWidth;
  }
  const xy = clip.map((frame) =>
    Array.from({ length: 75 }, (_, p): XY => {
      const [x, y] = point(frame, p);
      return [(x - centre[0]) / width, (y - centre[1]) / width];
    })
  );

  // 2. The hand seen in more frames is the signing hand. Mirror left-handed signing so it looks right-handed.
  const seenFrames = (start: number) => xy.filter((frame) => !Number.isNaN(frame[start][0])).length;
  const main: Side = seenFrames(RIGHT_HAND) >= seenFrames(LEFT_HAND) ? 'right' : 'left';
  const other: Side = main === 'right' ? 'left' : 'right';
  if (main === 'left') xy.forEach((frame) => frame.forEach((p) => (p[0] = -p[0])));
  const hand = { left: LEFT_HAND, right: RIGHT_HAND };

  // 3. Per frame: signing hand (21 dots), other hand (21), wrists and elbows, nose, and whether each hand is seen.
  const order = [
    ...Array.from({ length: 21 }, (_, i) => hand[main] + i),
    ...Array.from({ length: 21 }, (_, i) => hand[other] + i),
    WRIST[main],
    ELBOW[main],
    WRIST[other],
    ELBOW[other],
    NOSE,
  ];
  const tracks = order.map((p) => fillGaps(xy.map((frame) => frame[p])));
  const rows = xy.map((frame, t) => [
    ...tracks.flatMap((track) => track[t]),
    Number.isNaN(frame[hand[main]][0]) ? 0 : 1,
    Number.isNaN(frame[hand[other]][0]) ? 0 : 1,
  ]);
  return new Float32Array(resample(rows).flat());
}

export interface MySignGuess {
  label: string; // e.g. 'NAME', or 'other'
  probability: number;
}
export type ReadMySign = (clip: Float32Array[]) => Promise<MySignGuess>;

let loading: Promise<ReadMySign> | null = null;

/** Loads the model once and returns a function that reads a sign clip. */
export function loadMySignModel(): Promise<ReadMySign> {
  loading ??= createReader().catch((error) => {
    loading = null; // allow another try later
    throw error;
  });
  return loading;
}

async function createReader(): Promise<ReadMySign> {
  const { Tensor, loadAndCompile } = await startLiteRt();
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`My sign model not found at ${MODEL_URL}`);
  const model = await loadAndCompile(new Uint8Array(await response.arrayBuffer()), { accelerator: 'wasm' });
  const labels: string[] = await (await fetch(LABELS_URL)).json();

  return async (clip) => {
    const input = new Tensor(signFeatures(clip), [1, SIGN_FRAMES, SIGN_FEATURES]);
    const [output] = await model.run(input);
    const scores = output.toTypedArray() as Float32Array;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const guess = { label: labels[best], probability: scores[best] };
    input.delete();
    output.delete();
    return guess;
  };
}
