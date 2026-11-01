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

/**
 * Cuts a stream of hand frames into moves.
 * A move starts when the hand moves faster than `start` (palm sizes per frame) and ends
 * once it has been slower than `stop` for `stillFrames` frames in a row, or when the hand
 * leaves the picture. Moves shorter than `minFrames` are just jitter and are thrown away.
 *
 * push() returns the frames of a finished move, otherwise null.
 */
export class MotionSegmenter {
  private frames: P3[][] = [];
  private before: P3[][] = []; // the last few frames before a move starts
  private previous: P3[] | null = null;
  private still = 0;

  constructor(
    private start = 0.035,
    private stop = 0.015,
    private stillFrames = 6,
    private minFrames = 8,
    private maxFrames = 90,
    private preRoll = 3
  ) {}

  /** True while a move is being collected. */
  get moving() {
    return this.frames.length > 0;
  }

  reset() {
    this.frames = [];
    this.before = [];
    this.previous = null;
    this.still = 0;
  }

  push(hand: P3[] | undefined): P3[][] | null {
    if (!hand) {
      const move = this.finish();
      this.previous = null;
      return move;
    }
    const speed = this.previous ? handSpeed(this.previous, hand) : 0;
    this.previous = hand;

    if (!this.moving) {
      if (speed > this.start) {
        this.frames = [...this.before, hand];
        this.still = 0;
      } else {
        this.before = [...this.before, hand].slice(-this.preRoll);
      }
      return null;
    }

    this.frames.push(hand);
    this.still = speed < this.stop ? this.still + 1 : 0;
    if (this.still >= this.stillFrames || this.frames.length >= this.maxFrames) return this.finish();
    return null;
  }

  private finish(): P3[][] | null {
    const move = this.frames;
    this.frames = [];
    this.before = [];
    this.still = 0;
    return move.length >= this.minFrames ? move : null;
  }
}
