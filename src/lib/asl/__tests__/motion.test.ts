import { describe, expect, it } from 'vitest';
import { ClipRecorder } from '../clipRecorder';
import type { P3 } from '../letters';
import { handSpeed, MotionSegmenter } from '../motion';

/** A simple 21-point hand placed at (x, y). Dot 9 sits 0.1 above the wrist, so the palm size is 0.1. */
const hand = (x = 0.5, y = 0.5): P3[] =>
  Array.from({ length: 21 }, (_, i) =>
    i === 9 ? { x, y: y - 0.1, z: 0 } : { x: x + (i % 5) * 0.01, y: y - (i % 4) * 0.02, z: 0 }
  );

// No smoothing, short pauses: easier to count frames in the tests.
const options = { smooth: 1, stillFrames: 3, minFrames: 4, preRoll: 2 };

describe('handSpeed', () => {
  it('is 0 for a still hand and grows with movement (in palm sizes)', () => {
    expect(handSpeed(hand(), hand())).toBe(0);
    expect(handSpeed(hand(0.5), hand(0.51))).toBeCloseTo(0.1); // moved 0.01 = a tenth of the palm
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

  it('smooths the speed, so one repeated camera frame does not end a move', () => {
    const seg = new MotionSegmenter({ smooth: 3, stillFrames: 2, minFrames: 4, preRoll: 0 });
    const xs = [0.5, 0.5, 0.5, 0.52, 0.54, 0.54, 0.56, 0.58, 0.58, 0.6]; // every third frame repeats
    for (const x of xs) expect(seg.push(hand(x))).toBeNull();
    expect(seg.moving).toBe(true);
  });
});

describe('ClipRecorder', () => {
  it('counts moves per label and saves 63 numbers per frame', () => {
    const rec = new ClipRecorder();
    rec.add('J', [hand(), hand()]);
    rec.add('J', [hand()]);
    rec.add('other', [hand()]);
    expect(rec.counts()).toEqual({ J: 2, other: 1 });
    const clips = JSON.parse(rec.toJson());
    expect(clips[0].frames[0]).toHaveLength(63);
  });
});
