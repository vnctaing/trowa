import { FLUTE_HIGH, FLUTE_LOW, type DetectedNote, type Midi, type Options } from '../domain';

export type MelodyNote = DetectedNote & { ornament?: 'grace' };

const FRAME_SEC = 0.01;
const MIN_BLIP_SEC = 0.05;
const SHORT_NOTE_FRACTION_OF_16TH = 0.75;

export function foldIntoFlute(midi: number): Midi {
  let m = Math.round(midi);
  while (m < FLUTE_LOW) m += 12;
  while (m > FLUTE_HIGH) m -= 12;
  return m as Midi;
}

function salience(note: DetectedNote): number {
  return note.amplitude + 0.1 * Math.min(note.durSec, 1) + 0.001 * note.midi;
}

export function reduceToLine(notes: readonly DetectedNote[], transpose: number): DetectedNote[] {
  if (notes.length === 0) return [];
  const frameOf = (sec: number) => Math.round(sec / FRAME_SEC);
  const totalFrames = Math.max(...notes.map((x) => frameOf(x.onsetSec + x.durSec)));
  const winner = new Int32Array(totalFrames).fill(-1);
  const best = new Float64Array(totalFrames).fill(-Infinity);

  notes.forEach((note, i) => {
    const s = salience(note);
    for (let f = frameOf(note.onsetSec); f < frameOf(note.onsetSec + note.durSec); f++) {
      if (s > best[f]!) {
        best[f] = s;
        winner[f] = i;
      }
    }
  });

  const line: DetectedNote[] = [];
  let start = 0;
  for (let f = 1; f <= totalFrames; f++) {
    if (f < totalFrames && winner[f] === winner[start]) continue;
    const idx = winner[start]!;
    const durSec = (f - start) * FRAME_SEC;
    if (idx >= 0 && durSec >= MIN_BLIP_SEC) {
      const src = notes[idx]!;
      line.push({
        midi: foldIntoFlute(src.midi + transpose),
        onsetSec: start * FRAME_SEC,
        durSec,
        amplitude: src.amplitude,
      });
    }
    start = f;
  }
  return line;
}

export function applyDifficulty(
  line: readonly DetectedNote[],
  difficulty: Options['difficulty'],
  sixteenthSec: number,
): MelodyNote[] {
  const isShort = (x: DetectedNote) => x.durSec < sixteenthSec * SHORT_NOTE_FRACTION_OF_16TH;
  const out: MelodyNote[] = [];
  line.forEach((note, i) => {
    if (!isShort(note)) {
      out.push(note);
      return;
    }
    if (difficulty === 'melody') return;
    const next = line[i + 1];
    const leadsIntoNext =
      next !== undefined &&
      !isShort(next) &&
      next.midi !== note.midi &&
      next.onsetSec - (note.onsetSec + note.durSec) < sixteenthSec;
    if (leadsIntoNext) out.push({ ...note, ornament: 'grace' });
  });
  return out;
}
