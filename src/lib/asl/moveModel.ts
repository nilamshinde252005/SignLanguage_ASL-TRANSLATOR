/**
 * The moving-letters model (J, Z or "other"). It reads a whole move, cut out by
 * MotionSegmenter, and was trained in training/train_moves.ipynb.
 */
import type { P3 } from './letters';
import { BASE_PATH, startLiteRt } from './classifier';

export const MOVE_FRAMES = 24; // every move is stretched or squashed to this many frames
const MODEL_URL = `${BASE_PATH}/models/moves/moves.tflite`;
const LABELS_URL = `${BASE_PATH}/models/moves/moves.json`;

type Vec = [number, number, number];

/** Stretches or squashes a move to exactly `count` frames, blending neighbouring frames (like numpy's linspace). */
export function resampleMove(move: P3[][], count = MOVE_FRAMES): Vec[][] {
  const step = (move.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, k) => {
    const t = k === count - 1 ? move.length - 1 : k * step; // where this frame falls in the original move
    const before = Math.floor(t);
    const after = Math.min(before + 1, move.length - 1);
    const mix = t - before;
    return move[before].map((p, i): Vec => {
      const q = move[after][i];
      return [p.x * (1 - mix) + q.x * mix, p.y * (1 - mix) + q.y * mix, p.z * (1 - mix) + q.z * mix];
    });
  });
}

/**
 * Turns a move into 24 × 63 numbers, the same recipe as move_features() in the notebook:
 * stretch to 24 frames → start the wrist at 0,0,0 → measure in palm sizes → mirror left hands.
 */
export function moveFeatures(move: P3[][]): Float32Array {
  const frames = resampleMove(move);
  const [wx, wy, wz] = frames[0][0]; // the wrist at the start
  let m = frames.map((hand) => hand.map(([x, y, z]): Vec => [x - wx, y - wy, z - wz]));
  const palm = m.reduce((sum, h) => sum + Math.hypot(h[9][0] - h[0][0], h[9][1] - h[0][1], h[9][2] - h[0][2]), 0) / m.length;
  m = m.map((hand) => hand.map(([x, y, z]): Vec => [x / palm, y / palm, z / palm]));
  const [start] = m;
  const a = [start[5][0] - start[0][0], start[5][1] - start[0][1]];
  const b = [start[17][0] - start[0][0], start[17][1] - start[0][1]];
  if (a[0] * b[1] - a[1] * b[0] < 0) m = m.map((hand) => hand.map(([x, y, z]): Vec => [-x, y, z]));
  return new Float32Array(m.flat(2));
}

export const MIN_MOVE_CONFIDENCE = 0.8; // only type J or Z when the model is at least 80% sure
const TAKE_BACK_MS = 1000;

/** A still letter that was typed, and when (performance.now()). */
export interface TypedLetter {
  letter: string;
  at: number;
}

/**
 * Adds a J or Z to the subtitles. A J starts from the I hand shape (and a Z from a pointing finger),
 * so the still-letter typer may have typed that shape just before the move started. If the last
 * letter typed was typed less than a second before the move began (or during it), take it back.
 */
export function addMovingLetter(text: string, letter: string, lastStill: TypedLetter | null, moveStartedAt: number) {
  if (lastStill && lastStill.at >= moveStartedAt - TAKE_BACK_MS && text.endsWith(lastStill.letter)) {
    text = text.slice(0, -lastStill.letter.length);
  }
  return text + letter;
}

export interface MoveGuess {
  label: string; // 'J', 'Z' or 'other'
  probability: number;
}
export type ReadMove = (move: P3[][]) => Promise<MoveGuess>;

let loading: Promise<ReadMove> | null = null;

/** Loads the model once and returns a function that reads a move. */
export function loadMoveModel(): Promise<ReadMove> {
  loading ??= createMoveReader().catch((error) => {
    loading = null; // allow another try later
    throw error;
  });
  return loading;
}

async function createMoveReader(): Promise<ReadMove> {
  const { Tensor, loadAndCompile } = await startLiteRt();
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Moving-letters model not found at ${MODEL_URL}`);
  const model = await loadAndCompile(new Uint8Array(await response.arrayBuffer()), { accelerator: 'wasm' });
  const labels: string[] = await (await fetch(LABELS_URL)).json();

  return async (move) => {
    const input = new Tensor(moveFeatures(move), [1, MOVE_FRAMES, 63]);
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
