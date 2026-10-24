import { FLUTE_HIGH, FLUTE_LOW, TICKS_PER_QUARTER, type DetectedNote, type Midi, type Options } from '../domain';

export type MelodyNote = DetectedNote & { ornament?: 'grace' };

const FRAGMENT_SIXTEENTHS = 2;
const FRAGMENT_GAP_SEC = 0.05;
const REARTICULATION_ONSET = 0.8;
const DROPOUT_SIXTEENTHS = 4;
const SHORT_NOTE_FRACTION_OF_16TH = 0.75;
const PHRASE_GAP_SEC = 0.5;
const OCTAVE_OUTLIER_SEMITONES = 12;

export function foldIntoFlute(midi: number): Midi {
  let m = Math.round(midi);
  while (m < FLUTE_LOW) m += 12;
  while (m > FLUTE_HIGH) m -= 12;
  return m as Midi;
}

export function foldLine(line: readonly DetectedNote[], transpose: number): DetectedNote[] {
  const transposed = line.map((x) => ({ ...x, midi: (x.midi + transpose) as Midi }));
  return phrases(transposed).flatMap(pullOctaveOutliers);
}

function phrases(line: readonly DetectedNote[]): DetectedNote[][] {
  const out: DetectedNote[][] = [];
  line.forEach((note, i) => {
    const prev = line[i - 1];
    if (prev === undefined || note.onsetSec - (prev.onsetSec + prev.durSec) > PHRASE_GAP_SEC) out.push([]);
    out.at(-1)!.push(note);
  });
  return out;
}

function weightedMedianMidi(notes: readonly DetectedNote[]): number {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const half = sorted.reduce((sum, x) => sum + x.durSec, 0) / 2;
  let seen = 0;
  return (sorted.find((x) => (seen += x.durSec) >= half) ?? sorted.at(-1)!).midi;
}

function pullOctaveOutliers(phrase: readonly DetectedNote[]): DetectedNote[] {
  const center = weightedMedianMidi(phrase);
  return phrase.map((x) => {
    const distance = x.midi - center;
    const midi = Math.abs(distance) >= OCTAVE_OUTLIER_SEMITONES ? x.midi - 12 * Math.round(distance / 12) : x.midi;
    return { ...x, midi: foldIntoFlute(midi) };
  });
}

type Simplification = (line: readonly DetectedNote[], sixteenthSec: number) => DetectedNote[];

const isShort = (note: DetectedNote, sixteenthSec: number) => note.durSec < sixteenthSec * SHORT_NOTE_FRACTION_OF_16TH;

const mergeFragments: Simplification = (line, sixteenthSec) => {
  const out: DetectedNote[] = [];
  for (const note of line) {
    const prev = out.at(-1);
    const gap = prev === undefined ? Infinity : note.onsetSec - (prev.onsetSec + prev.durSec);
    const isFragment =
      prev?.midi === note.midi &&
      ((gap < FRAGMENT_GAP_SEC && note.durSec < sixteenthSec * FRAGMENT_SIXTEENTHS) ||
        (gap < sixteenthSec * DROPOUT_SIXTEENTHS && note.onset < REARTICULATION_ONSET));
    if (prev && isFragment) prev.durSec = note.onsetSec + note.durSec - prev.onsetSec;
    else out.push({ ...note });
  }
  return out;
};

const dropShortNotes: Simplification = (line, sixteenthSec) => line.filter((note) => !isShort(note, sixteenthSec));

const alignOctaveFlips: Simplification = (line, sixteenthSec) => {
  const out = line.map((x) => ({ ...x }));
  out.forEach((note, i) => {
    const prev = out[i - 1];
    if (prev === undefined || Math.abs(note.midi - prev.midi) !== 12) return;
    const beat = sixteenthSec * TICKS_PER_QUARTER;
    if (note.onsetSec - (prev.onsetSec + prev.durSec) >= beat || Math.min(note.durSec, prev.durSec) >= beat) return;
    if (note.durSec < prev.durSec) note.midi = prev.midi;
    else prev.midi = note.midi;
  });
  return out;
};

const MELODY: readonly Simplification[] = [dropShortNotes, alignOctaveFlips, mergeFragments];

function withGraceNotes(line: readonly DetectedNote[], sixteenthSec: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  line.forEach((note, i) => {
    if (!isShort(note, sixteenthSec)) {
      out.push(note);
      return;
    }
    const next = line[i + 1];
    const leadsIntoNext =
      next !== undefined &&
      !isShort(next, sixteenthSec) &&
      next.midi !== note.midi &&
      next.onsetSec - (note.onsetSec + note.durSec) < sixteenthSec;
    if (leadsIntoNext) out.push({ ...note, ornament: 'grace' });
  });
  return out;
}

export function applyDifficulty(
  line: readonly DetectedNote[],
  difficulty: Options['difficulty'],
  sixteenthSec: number,
): MelodyNote[] {
  if (difficulty === 'ornaments') return withGraceNotes(line, sixteenthSec);
  return MELODY.reduce<DetectedNote[]>((notes, simplify) => simplify(notes, sixteenthSec), [...line]);
}
