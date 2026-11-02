/**
 * Moving letters (J and Z): a single frame can't show movement, so we cut the
 * stream of hand frames into "moves" and give a whole move to the motion model.
 */
import type { P3 } from './letters';

const TRACKED = [0, 4, 8, 12, 16, 20]; // wrist and the five fingertips

/** How far the hand moved since the previous frame, measured in palm sizes. */
export function handSpeed(previous: P3[], current: P3[]): number {
  const palm = Math.hypot(current[9].x - current[0].x, current[9].y - current[0].y);
  if (!palm) return 0;
  let total = 0;
  for (const i of TRACKED) total += Math.hypot(current[i].x - previous[i].x, current[i].y - previous[i].y);
  return total / TRACKED.length / palm;
}

export interface MotionOptions {
  start: number; // a move starts when the (smoothed) speed goes above this, in palm sizes per frame
  stop: number; // ...and ends once the speed has stayed below this
  stillFrames: number; // ...for this many frames in a row
  minFrames: number; // shorter moves are just jitter
  maxFrames: number; // longer moves are several letters or waving, not one letter
  preRoll: number; // frames kept from just before the move started
  smooth: number; // average the speed over this many frames (the camera sometimes repeats a frame)
}

const DEFAULTS: MotionOptions = {
  start: 0.03,
  stop: 0.02,
  stillFrames: 5,
  minFrames: 8,
  maxFrames: 75,
  preRoll: 3,
  smooth: 3,
};

/**
 * Cuts a stream of hand frames into moves: speed up → move starts; still again → move ends.
 * push() returns the frames of a finished move, otherwise null. When a move is thrown away,
 * `discarded` says why for that one frame ('too short' or 'too long').
 */
export class MotionSegmenter {
  discarded: 'too short' | 'too long' | null = null;
  private options: MotionOptions;
  private frames: P3[][] = [];
  private before: P3[][] = []; // the last few frames before a move starts
  private speeds: number[] = [];
  private previous: P3[] | null = null;
  private still = 0;
  private tooLong = false; // the current move went past maxFrames; wait for stillness, then drop it

  constructor(options: Partial<MotionOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** True while a move is happening. */
  get moving() {
    return this.frames.length > 0 || this.tooLong;
  }

  reset() {
    this.frames = [];
    this.before = [];
    this.speeds = [];
    this.previous = null;
    this.still = 0;
    this.tooLong = false;
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

    const { start, stop, stillFrames, maxFrames, preRoll, smooth } = this.options;
    this.speeds = [...this.speeds, this.previous ? handSpeed(this.previous, hand) : 0].slice(-smooth);
    const speed = this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
    this.previous = hand;

    if (!this.moving) {
      if (speed > start) {
        this.frames = [...this.before, hand];
        this.still = 0;
      } else {
        this.before = [...this.before, hand].slice(-preRoll);
      }
      return null;
    }

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
    this.frames = [];
    this.before = [];
    this.still = 0;
    this.tooLong = false;
    if (tooLong) {
      this.discarded = 'too long';
      return null;
    }
    if (move.length < this.options.minFrames) {
      if (move.length) this.discarded = 'too short';
      return null;
    }
    return move;
  }
}
