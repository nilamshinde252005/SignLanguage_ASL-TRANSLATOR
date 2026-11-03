/**
 * Recording my own signs (like NAME) for training. In Signs mode the app already cuts the
 * camera stream into signs (raise your hands → sign → lower them); each cut sign is a "clip".
 *
 * A clip frame keeps x, y, z for 75 points: left hand (21), right hand (21) and body (33).
 * NaN means "not seen in this frame".
 */

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** The parts of a HolisticLandmarkerResult this file reads. */
export interface HolisticPoints {
  leftHandLandmarks?: Point3[][];
  rightHandLandmarks?: Point3[][];
  poseLandmarks?: Point3[][];
}

const PARTS: [keyof HolisticPoints, string, number][] = [
  ['leftHandLandmarks', 'lh', 21],
  ['rightHandLandmarks', 'rh', 21],
  ['poseLandmarks', 'pose', 33],
];
export const CLIP_POINTS = 75;

/** One camera frame → 225 numbers (75 points × x, y, z), NaN for anything not seen. */
export function clipFrame(result: HolisticPoints): Float32Array {
  const frame = new Float32Array(CLIP_POINTS * 3).fill(NaN);
  let offset = 0;
  for (const [field, , count] of PARTS) {
    const points = result[field]?.[0];
    if (points?.length === count) {
      points.forEach((p, i) => frame.set([p.x, p.y, p.z], (offset + i) * 3));
    }
    offset += count;
  }
  return frame;
}

const cell = (value: number) => (Number.isNaN(value) ? '' : String(Math.round(value * 1e5) / 1e5));

/** Collects labelled clips and downloads them as one CSV: label, clip number, then 225 numbers per frame. */
export class SignClipRecorder {
  private rows: string[] = [];
  private clips = 0;
  private perLabel: Record<string, number> = {};

  /** Saves one clip; returns how many clips of that label there are now. */
  add(label: string, clip: Float32Array[]): number {
    this.clips++;
    for (const frame of clip) this.rows.push([label, this.clips, ...Array.from(frame, cell)].join(','));
    this.perLabel[label] = (this.perLabel[label] ?? 0) + 1;
    return this.perLabel[label];
  }

  counts(): Record<string, number> {
    return { ...this.perLabel };
  }

  toCsv() {
    const columns = PARTS.flatMap(([, name, count]) =>
      Array.from({ length: count }, (_, i) => `${name}${i}_x,${name}${i}_y,${name}${i}_z`)
    );
    return ['label,clip,' + columns.join(','), ...this.rows].join('\n');
  }

  download() {
    const file = new Blob([this.toCsv()], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `signs-${Date.now()}.csv`;
    link.click();
  }
}
