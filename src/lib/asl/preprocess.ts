/**
 * Turns MediaPipe Holistic results into the exact input the ASL sign model expects.
 *
 * TypeScript port of app/web/preprocess.js from https://github.com/ceydaakin/asl-realtime
 * (MIT licence, (c) Ceyda Akin). Keep the maths identical to the original: the model
 * was trained on data prepared exactly this way, so any change here lowers accuracy.
 *
 * A "frame" is a Float32Array of 543 * 2 numbers (x, y for every Holistic landmark).
 * NaN means "not detected in this frame".
 */

export const INPUT_SIZE = 64; // the model always looks at 64 time steps
export const N_COLS = 66; // 40 lip points + 21 hand points + 5 arm points
const N_HOLISTIC = 543; // 468 face + 21 left hand + 33 pose + 21 right hand

export type Frame = Float32Array;

export interface ModelWindow {
  xy: Float32Array; // 64 * 66 * 2 numbers
  mask: Float32Array; // 64 numbers: 1 = real frame, 0 = padding
  length: number; // how many of the 64 slots are real
}

interface Point {
  x: number;
  y: number;
}

/** The parts of a HolisticLandmarkerResult this file reads. */
export interface HolisticLike {
  faceLandmarks?: Point[][];
  leftHandLandmarks?: Point[][];
  poseLandmarks?: Point[][];
  rightHandLandmarks?: Point[][];
}

const range = (start: number, stop: number) =>
  Array.from({ length: stop - start }, (_, i) => start + i);

const LIPS = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
  95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
];
export const LEFT_HAND = range(468, 489);
export const RIGHT_HAND = range(522, 543);
const LEFT_DOMINANT = [...LIPS, ...LEFT_HAND, 502, 504, 506, 508, 510];
const RIGHT_DOMINANT = [...LIPS, ...RIGHT_HAND, 503, 505, 507, 509, 511];

// Holistic order inside a frame: face, left hand, pose, right hand.
const PARTS: [keyof HolisticLike, number, number][] = [
  ['faceLandmarks', 0, 468],
  ['leftHandLandmarks', 468, 21],
  ['poseLandmarks', 489, 33],
  ['rightHandLandmarks', 522, 21],
];

export const detected = (frame: Frame, idxs: number[]) =>
  idxs.some((i) => !Number.isNaN(frame[i * 2]));

export const hasHand = (frame: Frame) => detected(frame, LEFT_HAND) || detected(frame, RIGHT_HAND);

/** MediaPipe HolisticLandmarkerResult -> one frame. */
export function holisticFrame(result: HolisticLike): Frame {
  const frame = new Float32Array(N_HOLISTIC * 2).fill(NaN);
  for (const [field, start, count] of PARTS) {
    const points = result[field]?.[0];
    if (!points?.length) continue;
    for (let i = 0; i < count; i++) {
      frame[(start + i) * 2] = points[i].x;
      frame[(start + i) * 2 + 1] = points[i].y;
    }
  }
  return frame;
}

/** Same as numpy's array_split: the first (n % parts) chunks are one longer. */
function chunks(n: number, parts: number): [number, number][] {
  const base = Math.floor(n / parts);
  const extra = n % parts;
  let start = 0;
  return range(0, parts).map((i) => {
    const size = base + (i < extra ? 1 : 0);
    start += size;
    return [start - size, start];
  });
}

/** All the frames of one sign -> the model's input. */
export function toWindow(frames: Frame[]): ModelWindow {
  const left = frames.filter((f) => detected(f, LEFT_HAND));
  const right = frames.filter((f) => detected(f, RIGHT_HAND));
  // Whichever hand appears in more frames is treated as the signing ("dominant") hand.
  const leftDominant = left.length >= right.length;
  const idxs = leftDominant ? LEFT_DOMINANT : RIGHT_DOMINANT;
  const clip = (leftDominant ? left : right).map((frame) => {
    const out = new Float32Array(N_COLS * 2);
    idxs.forEach((src, col) => {
      const x = frame[src * 2];
      // Right-dominant clips are mirrored (hand and arm, not the lips) so every
      // clip looks the same way round to the model.
      out[col * 2] = leftDominant || col < LIPS.length ? x : 1 - x;
      out[col * 2 + 1] = frame[src * 2 + 1];
    });
    return out;
  });

  // Squash long clips into 64 steps by averaging; short clips are padded.
  const spans: [number, number][] =
    clip.length > INPUT_SIZE ? chunks(clip.length, INPUT_SIZE) : clip.map((_, i) => [i, i + 1]);
  const xy = new Float32Array(INPUT_SIZE * N_COLS * 2);
  spans.forEach(([start, stop], t) => {
    for (let v = 0; v < N_COLS * 2; v++) {
      let sum = 0;
      let count = 0;
      for (let i = start; i < stop; i++) {
        if (!Number.isNaN(clip[i][v])) {
          sum += clip[i][v];
          count++;
        }
      }
      xy[t * N_COLS * 2 + v] = count ? sum / count : 0;
    }
  });
  const mask = new Float32Array(INPUT_SIZE);
  mask.fill(1, 0, spans.length);
  return { xy, mask, length: spans.length };
}

/**
 * Cuts the live stream into signs: a sign starts when a hand appears and ends
 * when the hand has been out of view for `gap` frames ("raise hand, sign, lower hand").
 *
 * Hand tracking often drops out for a moment when the hand is in front of the face
 * (THANK YOU, MOM, GRANDMA...). If the caller says the arm is still raised (`armUp`,
 * worked out from the body points), the sign is kept open for up to `maxGap` frames
 * instead, so it isn't cut in half.
 *
 * push() returns the sign's frames once it is finished, otherwise null.
 */
export class SignSegmenter {
  gap: number;
  maxGap: number;
  minFrames: number;
  maxFrames: number;
  private frames: Frame[] = [];
  private handFrames = 0;
  private missing = 0;

  constructor({ gap = 8, maxGap = 24, minFrames = 4, maxFrames = 4 * INPUT_SIZE } = {}) {
    this.gap = gap;
    this.maxGap = Math.max(gap, maxGap);
    this.minFrames = minFrames;
    this.maxFrames = maxFrames;
  }

  reset() {
    this.frames = [];
    this.handFrames = 0;
    this.missing = 0;
  }

  /** True while a sign is being collected (useful for a "recording…" indicator). */
  get active() {
    return this.frames.length > 0;
  }

  push(frame: Frame, armUp = false): Frame[] | null {
    const hand = hasHand(frame);
    if (!hand && !this.frames.length) return null;
    this.frames.push(frame);
    this.handFrames += hand ? 1 : 0;
    this.missing = hand ? 0 : this.missing + 1;
    const handGone = this.missing >= (armUp ? this.maxGap : this.gap);
    if (!handGone && this.frames.length < this.maxFrames) return null;
    const { frames, handFrames } = this;
    this.reset();
    return handFrames >= this.minFrames ? frames : null;
  }
}

interface PosePoint {
  x: number;
  y: number;
  visibility?: number;
}

/**
 * Is either arm raised? True when a wrist is visible, inside the picture and higher
 * than its elbow (y grows downwards). Used to tell "hand briefly lost in front of
 * the face" apart from "hand lowered, sign finished".
 */
export function isArmUp(pose: PosePoint[] | undefined): boolean {
  if (!pose || pose.length < 17) return false;
  return [
    [15, 13], // left wrist, left elbow
    [16, 14], // right wrist, right elbow
  ].some(([w, e]) => {
    const wrist = pose[w];
    const elbow = pose[e];
    return (wrist.visibility ?? 1) > 0.5 && wrist.y < 1 && wrist.y < elbow.y;
  });
}
