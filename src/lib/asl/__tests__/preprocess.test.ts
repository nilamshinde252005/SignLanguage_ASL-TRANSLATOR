import { describe, expect, it } from 'vitest';
import {
  holisticFrame,
  hasHand,
  INPUT_SIZE,
  isArmUp,
  N_COLS,
  SignSegmenter,
  toWindow,
} from '../preprocess';

const hand = (x = 0.2) => Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
const handFrame = (x = 0.2) => holisticFrame({ rightHandLandmarks: [hand(x)] });
const emptyFrame = () => holisticFrame({});

describe('holisticFrame / hasHand', () => {
  it('marks missing body parts as NaN and detects a visible hand', () => {
    const frame = handFrame();
    expect(frame.length).toBe(543 * 2);
    expect(Number.isNaN(frame[0])).toBe(true); // face not detected
    expect(hasHand(frame)).toBe(true);
    expect(hasHand(emptyFrame())).toBe(false);
  });
});

describe('toWindow', () => {
  it('pads short clips to the 64-step model input', () => {
    const w = toWindow(Array.from({ length: 10 }, () => handFrame()));
    expect(w.xy.length).toBe(INPUT_SIZE * N_COLS * 2);
    expect(w.length).toBe(10);
    expect(Array.from(w.mask).filter((m) => m === 1).length).toBe(10);
  });

  it('squashes long clips down to exactly 64 steps', () => {
    const w = toWindow(Array.from({ length: 130 }, () => handFrame()));
    expect(w.length).toBe(INPUT_SIZE);
  });

  it('mirrors right-handed signs so the model always sees the same side', () => {
    const w = toWindow([handFrame(0.2)]);
    const firstHandCol = 40; // 40 lip points come first
    expect(w.xy[firstHandCol * 2]).toBeCloseTo(0.8); // x mirrored: 1 - 0.2
  });
});

describe('SignSegmenter', () => {
  it('returns one sign after the hand has been gone for `gap` frames', () => {
    const seg = new SignSegmenter({ gap: 2, minFrames: 3 });
    for (let i = 0; i < 4; i++) expect(seg.push(handFrame())).toBeNull();
    expect(seg.push(emptyFrame())).toBeNull();
    const sign = seg.push(emptyFrame());
    expect(sign?.length).toBe(6);
    expect(seg.active).toBe(false);
  });

  it('keeps the sign open longer while the arm is still raised', () => {
    const seg = new SignSegmenter({ gap: 2, maxGap: 4, minFrames: 1 });
    seg.push(handFrame());
    expect(seg.push(emptyFrame(), true)).toBeNull();
    expect(seg.push(emptyFrame(), true)).toBeNull(); // would have ended without armUp
    expect(seg.active).toBe(true);
  });

  it('ignores flickers that are too short to be a sign', () => {
    const seg = new SignSegmenter({ gap: 1, minFrames: 3 });
    seg.push(handFrame());
    expect(seg.push(emptyFrame())).toBeNull();
    expect(seg.active).toBe(false);
  });
});

describe('isArmUp', () => {
  const pose = (wristY: number, elbowY: number) => {
    const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, visibility: 1 }));
    p[15] = { x: 0.4, y: wristY, visibility: 1 };
    p[13] = { x: 0.4, y: elbowY, visibility: 1 };
    return p;
  };
  it('is true when a wrist is above its elbow', () => {
    expect(isArmUp(pose(0.3, 0.6))).toBe(true);
    expect(isArmUp(pose(0.95, 0.6))).toBe(false);
    expect(isArmUp(undefined)).toBe(false);
  });
});
