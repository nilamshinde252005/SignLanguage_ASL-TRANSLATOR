import { describe, expect, it } from 'vitest';
import { classifyLetter, LetterTyper, type P3 } from '../letters';

type Fingers = { index: boolean; middle: boolean; ring: boolean; pinky: boolean };

/**
 * Builds a simple, flat 21-point hand (MediaPipe order) for testing.
 * Wrist at (0, 0); fingers point "up" (negative y); palm size = 1.
 */
function makeHand(f: Fingers, { thumbOut = false, indexTipX = -0.3 } = {}): P3[] {
  const h: P3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const finger = (mcp: number, x: number, extended: boolean, tipX = x) => {
    h[mcp] = { x, y: -1, z: 0 };
    h[mcp + 1] = { x, y: -1.4, z: 0 }; // PIP
    h[mcp + 2] = { x, y: extended ? -1.7 : -1.2, z: 0 }; // DIP
    h[mcp + 3] = extended ? { x: tipX, y: -2.0, z: 0 } : { x, y: -0.9, z: 0 }; // TIP
  };
  finger(5, -0.3, f.index, indexTipX);
  finger(9, 0, f.middle);
  finger(13, 0.3, f.ring);
  finger(17, 0.6, f.pinky);
  // Thumb: CMC, MCP, IP, TIP
  h[1] = { x: -0.3, y: -0.3, z: 0 };
  h[2] = { x: -0.4, y: -0.5, z: 0 };
  h[3] = thumbOut ? { x: -0.8, y: -0.55, z: 0 } : { x: -0.25, y: -0.7, z: 0 };
  h[4] = thumbOut ? { x: -1.2, y: -0.6, z: 0 } : { x: -0.1, y: -0.8, z: 0 };
  return h;
}

const ALL = { index: true, middle: true, ring: true, pinky: true };
const ONLY_PINKY = { index: false, middle: false, ring: false, pinky: true };
const TWO = { index: true, middle: true, ring: false, pinky: false };

describe('classifyLetter', () => {
  it('returns null when fewer than 21 points are given', () => {
    expect(classifyLetter([])).toBeNull();
  });

  it('recognises B: four fingers up, thumb tucked in', () => {
    expect(classifyLetter(makeHand(ALL))).toBe('B');
  });

  it('tells V (fingers spread) apart from U (fingers together)', () => {
    expect(classifyLetter(makeHand(TWO, { indexTipX: -0.5 }))).toBe('V');
    expect(classifyLetter(makeHand(TWO, { indexTipX: -0.1 }))).toBe('U');
  });

  it('tells Y (thumb out) apart from I (thumb in)', () => {
    expect(classifyLetter(makeHand(ONLY_PINKY, { thumbOut: true }))).toBe('Y');
    expect(classifyLetter(makeHand(ONLY_PINKY))).toBe('I');
  });

  it('gives the same answer when the hand is bigger or moved (scale invariance)', () => {
    const moved = makeHand(ALL).map((p) => ({ x: p.x * 3 + 0.5, y: p.y * 3 + 0.2, z: p.z }));
    expect(classifyLetter(moved)).toBe('B');
  });
});

describe('LetterTyper', () => {
  it('types a letter only after it is held steady for `hold` frames, and only once', () => {
    const typer = new LetterTyper(3, 5);
    expect(typer.push('A', true)).toBeNull();
    expect(typer.push('A', true)).toBeNull();
    expect(typer.push('A', true)).toBe('A');
    expect(typer.push('A', true)).toBeNull(); // no repeats while held
  });

  it('types a space after the hand has been gone for `spaceAfter` frames', () => {
    const typer = new LetterTyper(1, 3);
    expect(typer.push('L', true)).toBe('L');
    expect(typer.push(null, false)).toBeNull();
    expect(typer.push(null, false)).toBeNull();
    expect(typer.push(null, false)).toBe(' ');
    expect(typer.push(null, false)).toBeNull(); // only one space
  });
});
