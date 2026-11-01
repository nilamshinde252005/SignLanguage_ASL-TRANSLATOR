import { describe, expect, it } from 'vitest';
import { ClipRecorder } from '../clipRecorder';
import type { P3 } from '../letters';
import { handSpeed, MotionSegmenter } from '../motion';

/** A simple 21-point hand placed at (x, y). Dot 9 sits 0.1 above the wrist, so the palm size is 0.1. */
const hand = (x = 0.5, y = 0.5): P3[] =>
  Array.from({ length: 21 }, (_, i) =>
    i === 9 ? { x, y: y - 0.1, z: 0 } : { x: x + (i % 5) * 0.01, y: y - (i % 4) * 0.02, z: 0 }
  );

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
    const seg = new MotionSegmenter(0.035, 0.015, 3, 4, 90, 2);
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

  it('ends a move when the hand leaves the picture, and throws away tiny ones', () => {
    const seg = new MotionSegmenter(0.035, 0.015, 3, 4);
    seg.push(hand(0.5));
    seg.push(hand(0.52)); // one quick jerk
    expect(seg.push(undefined)).toBeNull(); // too short to count
    for (let i = 0; i < 6; i++) seg.push(hand(0.5 + i * 0.02));
    expect(seg.push(undefined)?.length).toBeGreaterThanOrEqual(4);
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
