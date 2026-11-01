import type { P3 } from './letters';

/** One recorded move: its label and, for every frame, x, y, z of the 21 hand points (63 numbers). */
export interface Clip {
  label: string;
  frames: number[][];
}

const round = (value: number) => Math.round(value * 1e5) / 1e5; // 5 decimals keeps the file small

/** Collects labelled moves (for training the motion model) and saves them as a .json file. */
export class ClipRecorder {
  private clips: Clip[] = [];

  /** How many moves have been recorded for each label, e.g. { J: 12, Z: 9, other: 20 }. */
  counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const clip of this.clips) counts[clip.label] = (counts[clip.label] ?? 0) + 1;
    return counts;
  }

  add(label: string, frames: P3[][]) {
    this.clips.push({ label, frames: frames.map((hand) => hand.flatMap((p) => [round(p.x), round(p.y), round(p.z)])) });
  }

  toJson() {
    return JSON.stringify(this.clips);
  }

  download() {
    const file = new Blob([this.toJson()], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `moves-${Date.now()}.json`;
    link.click();
  }
}
