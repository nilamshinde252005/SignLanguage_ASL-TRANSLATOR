import { describe, expect, it } from 'vitest';
import { SIGN_FEATURES, SIGN_FRAMES, signFeatures } from '../signModel';
import fixture from './sign-features.fixture.json';

/** Rows of 225 numbers (null = not seen) → clip frames, like clipFrame() makes. */
const toClip = (frames: (number | null)[][]) => frames.map((row) => Float32Array.from(row, (v) => v ?? NaN));

/** Checks two lists of numbers are equal to 4 decimal places. */
const expectSame = (mine: ArrayLike<number>, expected: ArrayLike<number>) => {
  expect(mine.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(mine[i]).toBeCloseTo(expected[i], 4);
};

describe('signFeatures', () => {
  it('gives the same 24 × 96 numbers as the Python notebook', () => {
    expect(fixture.map((c) => c.name)).toEqual(['NAME, middle', 'left hand signing', 'no shoulders']);
    for (const c of fixture) {
      const features = signFeatures(toClip(c.frames));
      expect(features).toHaveLength(SIGN_FRAMES * SIGN_FEATURES);
      expectSame(features, c.features);
    }
  });

  it('gives the same numbers when you stand somewhere else, or nearer the camera', () => {
    const clip = toClip(fixture[0].frames);
    const moved = clip.map((frame) =>
      frame.map((v, i) => (i % 3 === 0 ? v * 1.3 - 0.1 : i % 3 === 1 ? v * 1.3 + 0.05 : v))
    );
    expectSame(signFeatures(moved), signFeatures(clip));
  });
});
