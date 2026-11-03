/**
 * Moving letters (J and Z): a single frame can't show movement, so we cut the
 * stream of hand frames into "moves" and give a whole move to the motion model.
 */
import type { P3 } from './letters';

const TRACKED = [0, 4, 8, 12, 16, 20]; // wrist and the five fingertips

const palmSize = (hand: P3[]) => Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y);

/** How far the hand moved since the previous frame, measured in palm sizes. */
export function handSpeed(previous: P3[], current: P3[]): number {
  const palm = palmSize(current);
  if (!palm) return 0;
  let total = 0;
  for (const i of TRACKED) total += Math.hypot(current[i].x - previous[i].x, current[i].y - previous[i].y);
  return total / TRACKED.length / palm;
}

/**
 * How big a move is, in palm sizes: the widest path drawn by any of the tracked dots.
 * A shaky "still" hand is about 0.1–0.3; a real J or Z is more than 1.
 */
export function moveSize(frames: P3[][]): number {
  const palm = frames.reduce((sum, hand) => sum + palmSize(hand), 0) / frames.length;
  if (!palm) return 0;
  let widest = 0;
  for (const i of TRACKED) {
    const xs = frames.map((hand) => hand[i].x);
    const ys = frames.map((hand) => hand[i].y);
    widest = Math.max(widest, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  }
  return widest / palm;
}

export interface MotionOptions {
  start: number; // a move starts when the (smoothed) speed goes above this, in palm sizes per frame
  stop: number; // ...and ends once the speed has stayed below this
  stillFrames: number; // ...for this many frames in a row
  minFrames: number; // shorter moves are just jitter
  maxFrames: number; // longer moves are several letters or waving, not one letter
  minSize: number; // smaller moves (in palm sizes) are a shaky hand, not a letter
  maxJump: number; // a jump bigger than this in one frame means the tracking switched hands or glitched
  gapJump: number; // a still hand that suddenly jumps this far is a gap in the recording, not a move starting
  preRoll: number; // frames kept from just before the move started
  smooth: number; // average the speed over this many frames (the camera sometimes repeats a frame)
}

// Measured on real recordings: a J takes about 50–70 frames and a Z about 100–180,
// a real move is 1–5 palms big, the fastest real frame-to-frame step was 0.7 palms,
// and real moves start gently (first steps under 0.1 palms).
const DEFAULTS: MotionOptions = {
  start: 0.03,
  stop: 0.02,
  stillFrames: 5,
  minFrames: 15,
  maxFrames: 200,
  minSize: 0.6,
  maxJump: 1,
  gapJump: 0.3,
  preRoll: 3,
  smooth: 3,
};

export type Discarded = 'too short' | 'too long' | 'too small' | 'jumped';

/**
 * Cuts a stream of hand frames into moves: speed up → move starts; still again → move ends.
 * push() returns the frames of a finished move, otherwise null. When a move is thrown away,
 * `discarded` says why for that one frame.
 */
export class MotionSegmenter {
  discarded: Discarded | null = null;
  private options: MotionOptions;
  private frames: P3[][] = [];
  private before: P3[][] = []; // the last few frames before a move starts
  private speeds: number[] = [];
  private previous: P3[] | null = null;
  private still = 0;
  private tooLong = false; // the current move went past maxFrames; wait for stillness, then drop it
  private biggestStep = 0; // the biggest one-frame step during the current move

  constructor(options: Partial<MotionOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** True while a move is happening. */
  get moving() {
    return this.frames.length > 0 || this.tooLong;
  }

  /** How big the current move is so far, in palm sizes (0 when the hand isn't moving). */
  get travelled() {
    return this.frames.length ? moveSize(this.frames) : 0;
  }

  reset() {
    this.frames = [];
    this.before = [];
    this.speeds = [];
    this.previous = null;
    this.still = 0;
    this.tooLong = false;
    this.biggestStep = 0;
    this.discarded = null;
  }

  push(hand: P3[] | undefined): P3[][] | null {
    this.discarded = null;
    if (!hand) {
      const move = this.finish();
      this.previous = null;
      this.speeds = [];
      return move;
    }

    const { start, stop, stillFrames, maxFrames, gapJump, preRoll, smooth } = this.options;
    const step = this.previous ? handSpeed(this.previous, hand) : 0;
    this.previous = hand;
    if (!this.moving && step > gapJump) {
      // A still hand jumped: a gap between two recordings (or a glitch). Start afresh from here.
      this.speeds = [];
      this.before = [hand];
      return null;
    }
    this.speeds = [...this.speeds, step].slice(-smooth);
    const speed = this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;

    if (!this.moving) {
      if (speed > start) {
        this.frames = [...this.before, hand];
        this.still = 0;
        this.biggestStep = step;
      } else {
        this.before = [...this.before, hand].slice(-preRoll);
      }
      return null;
    }

    this.biggestStep = Math.max(this.biggestStep, step);
    if (!this.tooLong) this.frames.push(hand);
    if (this.frames.length > maxFrames) {
      this.tooLong = true;
      this.frames = [];
    }
    this.still = speed < stop ? this.still + 1 : 0;
    return this.still >= stillFrames ? this.finish() : null;
  }

  private finish(): P3[][] | null {
    const move = this.frames;
    const tooLong = this.tooLong;
    const biggestStep = this.biggestStep;
    this.frames = [];
    this.before = [];
    this.still = 0;
    this.tooLong = false;
    this.biggestStep = 0;
    const { minFrames, minSize, maxJump } = this.options;
    if (tooLong) this.discarded = 'too long';
    else if (!move.length) this.discarded = null;
    else if (biggestStep > maxJump) this.discarded = 'jumped';
    else if (move.length < minFrames) this.discarded = 'too short';
    else if (moveSize(move) < minSize) this.discarded = 'too small';
    else return move;
    return null;
  }
}
