/**
 * The letter model I trained myself (see training/train_letters.ipynb):
 * one hand's 21 dots → 108 numbers → a % for each of 24 letters (A–Y, no J or Z).
 */
import type { P3 } from './letters';

const KEY_DOTS = [0, 4, 8, 12, 16, 20, 5, 9, 13, 17]; // wrist, 5 fingertips, 4 knuckles

/**
 * The same recipe as normalise() in the notebook. It MUST stay identical:
 * the model learned from numbers made this way, so any difference confuses it.
 */
export function letterFeatures(points: P3[]): Float32Array {
  const wrist = points[0];
  let hand = points.map((p) => [p.x - wrist.x, p.y - wrist.y, p.z - wrist.z]); // wrist to 0,0,0
  const palm = Math.hypot(...hand[9]); // palm size = distance from wrist to dot 9
  hand = hand.map((p) => p.map((value) => value / palm)); // measure everything in palms

  const [a, b] = [hand[5], hand[17]]; // is this the "other" hand?
  if (a[0] * b[1] - a[1] * b[0] < 0) {
    hand = hand.map(([x, y, z]) => [-x, y, z]); // if so, mirror it
  }

  const distances: number[] = []; // extra clues: distance between every pair of key dots
  for (let i = 0; i < KEY_DOTS.length; i++) {
    for (let j = i + 1; j < KEY_DOTS.length; j++) {
      const p = hand[KEY_DOTS[i]];
      const q = hand[KEY_DOTS[j]];
      distances.push(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }

  return new Float32Array([...hand.flat(), ...distances]); // 63 positions + 45 distances = 108
}