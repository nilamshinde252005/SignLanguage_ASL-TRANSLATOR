import { describe, expect, it } from 'vitest';
import type { P3 } from '../letters';
import { handSpeed, MotionSegmenter, moveSize } from '../motion';

/** A simple 21-point hand placed at (x, y). Dot 9 sits 0.1 above the wrist, so the palm size is 0.1. */
const hand = (x = 0.5, y = 0.5): P3[] =>
  Array.from({ length: 21 }, (_, i) =>
    i === 9 ? { x, y: y - 0.1, z: 0 } : { x: x + (i % 5) * 0.01, y: y - (i % 4) * 0.02, z: 0 }
  );

// No smoothing, short pauses: easier to count frames in the tests.
const options = { smooth: 1, stillFrames: 3, minFrames: 4, minSize: 0.5, preRoll: 2 };

describe('handSpeed', () => {
  it('is 0 for a still hand and grows with movement (in palm sizes)', () => {
    expect(handSpeed(hand(), hand())).toBe(0);
    expect(handSpeed(hand(0.5), hand(0.51))).toBeCloseTo(0.1); // moved 0.01 = a tenth of the palm
  });
});

describe('moveSize', () => {
  it('is the widest path drawn by any dot, in palm sizes', () => {
    expect(moveSize([hand(0.5), hand(0.5)])).toBe(0);
    expect(moveSize([hand(0.5), hand(0.6, 0.4)])).toBeCloseTo(Math.SQRT2); // 0.1 right and 0.1 up, palm 0.1
  });
});

describe('MotionSegmenter', () => {
  it('ignores a hand that stays still', () => {
    const seg = new MotionSegmenter();
    for (let i = 0; i < 30; i++) expect(seg.push(hand())).toBeNull();
    expect(seg.moving).toBe(false);
  });

  it('returns one move after the hand moves and then holds still', () => {
    const seg = new MotionSegmenter(options);
    seg.push(hand(0.5));
    seg.push(hand(0.5));
    for (let i = 1; i <= 6; i++) expect(seg.push(hand(0.5 + i * 0.01))).toBeNull(); // moving
    expect(seg.moving).toBe(true);
    expect(seg.travelled).toBeCloseTo(0.6); // 0.5 → 0.56 so far, with a palm of 0.1
    expect(seg.push(hand(0.56))).toBeNull();
    expect(seg.push(hand(0.56))).toBeNull();
    const move = seg.push(hand(0.56)); // third still frame ends the move
    expect(move).not.toBeNull();
    expect(move!.length).toBe(2 + 6 + 3); // 2 frames from before + 6 moving + 3 still
    expect(seg.moving).toBe(false);
  });

  it('throws away tiny jerks, and ends a move when the hand leaves the picture', () => {
    const seg = new MotionSegmenter(options);
    seg.push(hand(0.5));
    seg.push(hand(0.52)); // one quick jerk
    expect(seg.push(undefined)).toBeNull();
    expect(seg.discarded).toBe('too short');
    for (let i = 0; i < 6; i++) seg.push(hand(0.5 + i * 0.02));
    expect(seg.push(undefined)?.length).toBeGreaterThanOrEqual(4);
  });

  it('throws away moves that go on too long (several letters, waving)', () => {
    const seg = new MotionSegmenter({ ...options, maxFrames: 10 });
    for (let i = 0; i < 20; i++) expect(seg.push(hand(0.3 + i * 0.01))).toBeNull(); // 20 moving frames
    expect(seg.moving).toBe(true);
    seg.push(hand(0.29)); // back to where it started, then hold still
    seg.push(hand(0.29));
    seg.push(hand(0.29));
    expect(seg.push(hand(0.29))).toBeNull(); // third still frame: the move ends, but is thrown away
    expect(seg.discarded).toBe('too long');
    expect(seg.moving).toBe(false);
  });

  it('ignores a shaky hand that never really goes anywhere', () => {
    const seg = new MotionSegmenter(options);
    // Wobbles by 0.004 each frame: fast enough to start a move, but the whole move is tiny.
    for (let i = 0; i < 10; i++) seg.push(hand(i % 2 ? 0.504 : 0.5));
    expect(seg.moving).toBe(true);
    for (let i = 0; i < 3; i++) expect(seg.push(hand(0.5))).toBeNull();
    expect(seg.push(hand(0.5))).toBeNull(); // third still frame ends it, and it is thrown away
    expect(seg.discarded).toBe('too small');
  });

  it('throws away a move where the dots jump (for example, the other hand came into view)', () => {
    const seg = new MotionSegmenter(options);
    for (let i = 0; i <= 6; i++) seg.push(hand(0.3 + i * 0.02));
    seg.push(hand(0.7)); // one frame on a different hand, almost 3 palms away
    for (let i = 0; i < 3; i++) expect(seg.push(hand(0.42))).toBeNull();
    expect(seg.push(hand(0.42))).toBeNull();
    expect(seg.discarded).toBe('jumped');
  });

  it('ignores a sudden jump while the hand is still (a gap between two key presses)', () => {
    const seg = new MotionSegmenter(options);
    for (let i = 0; i < 3; i++) seg.push(hand(0.3)); // end of one recording...
    expect(seg.push(hand(0.7))).toBeNull(); // ...the next recording starts somewhere else
    expect(seg.moving).toBe(false);
    seg.push(hand(0.7));
    for (let i = 1; i <= 5; i++) seg.push(hand(0.7 + i * 0.02)); // a real move
    seg.push(hand(0.8));
    seg.push(hand(0.8));
    const move = seg.push(hand(0.8));
    expect(move?.length).toBe(2 + 5 + 3); // starts at 0.7, with nothing from before the jump
  });

  it('smooths the speed, so one repeated camera frame does not end a move', () => {
    const seg = new MotionSegmenter({ smooth: 3, stillFrames: 2, minFrames: 4, preRoll: 0 });
    const xs = [0.5, 0.5, 0.5, 0.52, 0.54, 0.54, 0.56, 0.58, 0.58, 0.6]; // every third frame repeats
    for (const x of xs) expect(seg.push(hand(x))).toBeNull();
    expect(seg.moving).toBe(true);
  });
});
