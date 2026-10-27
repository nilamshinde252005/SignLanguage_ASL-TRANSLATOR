import type { P3 } from './letters';

/**
 * Collects labelled examples for training the letter model.
 * One example = one row: the letter, then x, y, z for all 21 hand points (63 numbers).
 */
export class Recorder {
  label: string | null = null; // the letter being recorded right now (null = not recording)
  private rows: string[] = [];

  /** How many examples have been recorded so far. */
  get count() {
    return this.rows.length;
  }

  /** Call once per camera frame. Saves the hand only while recording and a hand is visible. */
  add(hand: P3[] | undefined) {
    if (!this.label || !hand) return;
    const numbers = hand.flatMap((p) => [p.x, p.y, p.z]);
    this.rows.push([this.label, ...numbers].join(','));
  }

  /** The whole table as CSV text: a header row, then one row per example. */
  toCsv() {
    const columns = Array.from({ length: 21 }, (_, i) => `x${i},y${i},z${i}`);
    return ['label,' + columns.join(','), ...this.rows].join('\n');
  }

  /** Makes the browser download the table as a .csv file. */
  download() {
    const file = new Blob([this.toCsv()], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `letters-${Date.now()}.csv`;
    link.click();
  }
}