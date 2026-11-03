import { describe, expect, it } from 'vitest';
import type { P3 } from '../letters';
import { addMovingLetter, MOVE_FRAMES, moveFeatures, resampleMove } from '../moveModel';
import fixture from './move-features.fixture.json';

/** One row of 63 numbers (x, y, z for each of the 21 dots) → 21 points. */
const toHand = (raw: number[]): P3[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] }));
const toMove = (frames: number[][]) => frames.map(toHand);

/** Checks two lists of numbers are equal to 4 decimal places. */
const expectSame = (mine: ArrayLike<number>, expected: ArrayLike<number>) => {
  expect(mine.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(mine[i]).toBeCloseTo(expected[i], 4);
};

describe('resampleMove', () => {
  it('always gives 24 frames, starting and ending where the move does', () => {
    const move = toMove(fixture[0].frames);
    const frames = resampleMove(move);
    expect(frames).toHaveLength(MOVE_FRAMES);
    expect(frames[0][8]).toEqual([move[0][8].x, move[0][8].y, move[0][8].z]);
    const last = move[move.length - 1][8];
    expect(frames[MOVE_FRAMES - 1][8]).toEqual([last.x, last.y, last.z]);
  });

  it('blends neighbouring frames', () => {
    const move = [0, 1, 2].map((x) => Array.from({ length: 21 }, () => ({ x, y: 0, z: 0 })));
    expect(resampleMove(move, 5).map((hand) => hand[0][0])).toEqual([0, 0.5, 1, 1.5, 2]);
  });
});

describe('moveFeatures', () => {
  it('gives the same 24 × 63 numbers as the Python notebook (a J from each hand direction, and a Z)', () => {
    expect(fixture.map((m) => m.mirrored)).toEqual([true, false, true]);
    for (const m of fixture) expectSame(moveFeatures(toMove(m.frames)), m.features);
  });

  it('gives the same numbers when the move is somewhere else in the picture, or bigger', () => {
    const move = toMove(fixture[0].frames);
    const movedAndBigger = move.map((hand) => hand.map((p) => ({ x: p.x * 1.5 - 0.2, y: p.y * 1.5 + 0.1, z: p.z * 1.5 })));
    expectSame(moveFeatures(movedAndBigger), moveFeatures(move));
  });

  it('gives the same numbers for the mirror image (left hand vs right hand)', () => {
    const move = toMove(fixture[1].frames);
    const mirrored = move.map((hand) => hand.map((p) => ({ ...p, x: 1 - p.x })));
    expectSame(moveFeatures(mirrored), moveFeatures(move));
  });
});

describe('addMovingLetter', () => {
  it('takes back the I that was typed just before a J', () => {
    expect(addMovingLetter('HI', 'J', { letter: 'I', at: 4500 }, 5000)).toBe('HJ');
  });

  it('keeps a letter typed long before the move', () => {
    expect(addMovingLetter('HI', 'J', { letter: 'I', at: 1000 }, 5000)).toBe('HIJ');
  });

  it('keeps the text when something else was typed since (a space)', () => {
    expect(addMovingLetter('HI ', 'Z', { letter: 'I', at: 4900 }, 5000)).toBe('HI Z');
    expect(addMovingLetter('', 'Z', null, 5000)).toBe('Z');
  });
});
