import type { QuantizedNote } from '../domain';

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export function majorTonicToFifths(pitchClass: number): number {
  const v = (((pitchClass * 7) % 12) + 12) % 12;
  return v > 6 ? v - 12 : v;
}

export function estimateKeyFifths(notes: readonly QuantizedNote[]): number {
  const histogram = new Array<number>(12).fill(0);
  for (const note of notes) {
    if (note.midi === null) continue;
    histogram[note.midi % 12]! += Math.max(note.durTicks, 1);
  }

  let bestScore = -Infinity;
  let bestMajorTonic = 0;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = histogram.map((_, pc) => histogram[(pc + tonic) % 12]!);
    const major = correlation(rotated, MAJOR_PROFILE);
    const minor = correlation(rotated, MINOR_PROFILE);
    if (major > bestScore) {
      bestScore = major;
      bestMajorTonic = tonic;
    }
    if (minor > bestScore) {
      bestScore = minor;
      bestMajorTonic = (tonic + 3) % 12;
    }
  }
  return majorTonicToFifths(bestMajorTonic);
}
