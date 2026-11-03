import { describe, expect, it } from 'vitest';
import { clipFrame, SignClipRecorder } from '../signClips';

const points = (count: number, x: number) => Array.from({ length: count }, (_, i) => ({ x, y: i / 100, z: -x }));

describe('clipFrame', () => {
  it('keeps both hands and the body, with NaN for a hand that is not seen', () => {
    const frame = clipFrame({ rightHandLandmarks: [points(21, 0.4)], poseLandmarks: [points(33, 0.5)] });
    expect(frame).toHaveLength(225);
    expect(Number.isNaN(frame[0])).toBe(true); // no left hand
    expect(Array.from(frame.slice(63, 66))).toEqual([Math.fround(0.4), 0, Math.fround(-0.4)]); // right hand, dot 0
    expect(frame[126]).toBeCloseTo(0.5); // body, point 0
  });
});

describe('SignClipRecorder', () => {
  it('numbers the clips, counts them per label, and leaves missing points empty', () => {
    const rec = new SignClipRecorder();
    const frame = clipFrame({ rightHandLandmarks: [points(21, 0.4)] });
    expect(rec.add('NAME', [frame, frame])).toBe(1);
    expect(rec.add('other', [frame])).toBe(1);
    expect(rec.add('NAME', [frame])).toBe(2);
    expect(rec.counts()).toEqual({ NAME: 2, other: 1 });
    const lines = rec.toCsv().split('\n');
    expect(lines).toHaveLength(1 + 4); // header + 4 frames
    expect(lines[0].split(',')).toHaveLength(2 + 225);
    expect(lines[1].startsWith('NAME,1,,,')).toBe(true); // left hand missing → empty cells
    expect(lines[3].startsWith('other,2,')).toBe(true);
  });
});
