import { describe, expect, it } from 'vitest';
import { letterFeatures } from '../letterModel';
import type { P3 } from '../letters';
import fixture from './letter-features.fixture.json';

/** 63 numbers (x, y, z for each of the 21 dots) → 21 points. */
const toPoints = (raw: number[]): P3[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] }));

/** Checks two lists of numbers are equal to 4 decimal places. */
const expectSame = (mine: ArrayLike<number>, expected: ArrayLike<number>) => {
  expect(mine.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(mine[i]).toBeCloseTo(expected[i], 4);
};

describe('letterFeatures', () => {
  it('gives the same 108 numbers as the Python notebook (one left-hand and one right-hand card)', () => {
    for (const card of fixture) {
      expectSame(letterFeatures(toPoints(card.raw)), card.features);
    }
  });

  it('gives the same numbers when the hand is moved or looks bigger', () => {
    const hand = toPoints(fixture[0].raw);
    const movedAndBigger = hand.map((p) => ({ x: p.x * 2 + 0.1, y: p.y * 2 - 0.3, z: p.z * 2 }));
    expectSame(letterFeatures(movedAndBigger), letterFeatures(hand));
  });

  it('gives the same numbers for the mirror image (left hand vs right hand)', () => {
    const hand = toPoints(fixture[0].raw);
    const mirrored = hand.map((p) => ({ ...p, x: 1 - p.x }));
    expectSame(letterFeatures(mirrored), letterFeatures(hand));
  });
});