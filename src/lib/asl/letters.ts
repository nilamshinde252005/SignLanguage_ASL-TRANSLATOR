/**
 * ASL alphabet from ONE hand's 21 dots, using simple geometry rules (no training).
 * Covers the still letters it can tell apart reliably:
 *   A B C D E F G I L O S U V W Y
 * Not covered: J and Z (they move), and H K M N P Q R T X (too similar for simple rules).
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const dist = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Finger is straight if its tip is clearly further from the wrist than its middle knuckle. */
const extended = (h: P3[], tip: number, pip: number) => dist(h[tip], h[0]) > dist(h[pip], h[0]) * 1.1;

export function classifyLetter(h: P3[]): string | null {
  if (h.length < 21) return null;

  // Palm size: everything is measured in "palms" so distance from the camera doesn't matter.
  const palm = dist(h[0], h[9]);
  if (palm === 0) return null;
  const d = (a: number, b: number) => dist(h[a], h[b]) / palm;

  const index = extended(h, 8, 6);
  const middle = extended(h, 12, 10);
  const ring = extended(h, 16, 14);
  const pinky = extended(h, 20, 18);
  // Thumb sticks out if its tip is well away from the pinky side of the palm.
  const thumbOut = dist(h[4], h[17]) > dist(h[2], h[17]) * 1.2;

  const thumbIndex = d(4, 8);
  const thumbMiddle = d(4, 12);
  const thumbPinky = d(4, 20);
  const indexMiddleSpread = d(8, 12);
  const noFingers = !index && !middle && !ring && !pinky;

  // Rules run top to bottom and the FIRST match wins, so the strictest rules come first.
  if (index && middle && ring && pinky && !thumbOut) return 'B';
  if (index && middle && ring && !pinky) return 'W';
  if (!index && middle && ring && pinky && thumbIndex < 0.3) return 'F';

  if (index && middle && !ring && !pinky) return indexMiddleSpread > 0.3 ? 'V' : 'U';

  if (index && !middle && !ring && !pinky) {
    if (thumbMiddle < 0.35) return 'D';
    if (thumbOut && thumbIndex > 0.7) return 'L';
    if (Math.abs(h[8].y - h[4].y) / palm < 0.3) return 'G';
    return null;
  }

  if (!index && !middle && !ring && pinky) {
    if (thumbOut && thumbPinky > 0.8) return 'Y';
    if (!thumbOut) return 'I';
    return null;
  }

  // Curved hand: a medium gap between thumb and index, fingers bent but hand open.
  if (!index && !pinky && thumbIndex > 0.4 && thumbIndex < 0.8 && d(8, 0) > 1) return 'C';

  if (noFingers) {
    if (thumbIndex < 0.25 && thumbMiddle < 0.35) return 'O'; // fingertips meet the thumb in a ring
    if (thumbOut) return 'A'; // fist, thumb up at the side
    if (d(4, 10) < 0.3) return 'S'; // thumb wrapped across the middle finger
    if (thumbIndex < 0.35) return 'E'; // fingertips curled down onto the thumb
  }
  return null;
}

/**
 * Turns a stream of per-frame letters into typed text:
 * a letter is typed once it has been held steady for `hold` frames,
 * and a space is typed after the hand has been gone for `spaceAfter` frames.
 */
export class LetterTyper {
  private candidate: string | null = null;
  private count = 0;
  private typed = false;
  private noHand = 0;
  private spaceTyped = true;

  constructor(private hold = 12, private spaceAfter = 30) {}

  /** Returns text to add ("A", " ") or null. */
  push(letter: string | null, handVisible: boolean): string | null {
    if (!handVisible) {
      this.candidate = null;
      this.count = 0;
      this.typed = false;
      this.noHand++;
      if (this.noHand >= this.spaceAfter && !this.spaceTyped) {
        this.spaceTyped = true;
        return ' ';
      }
      return null;
    }
    this.noHand = 0;
    if (letter !== this.candidate) {
      this.candidate = letter;
      this.count = 0;
      this.typed = false;
    }
    this.count++;
    if (letter && !this.typed && this.count >= this.hold) {
      this.typed = true; // don't repeat until the letter changes
      this.spaceTyped = false;
      return letter;
    }
    return null;
  }
}
