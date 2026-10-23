import { FLUTE_HIGH, FLUTE_LOW, type DetectedNote, type Midi, type Options } from '../domain';

export type MelodyNote = DetectedNote & { ornament?: 'grace' };

const FRAMES_PER_SEC = 100;
const MIN_BLIP_SEC = 0.05;
const TAIL_GAP_SEC = 0.02;
const TAIL_AMPLITUDE_RATIO = 0.85;
const FRAGMENT_SIXTEENTHS = 2;
const FRAGMENT_GAP_SEC = 0.05;
const REARTICULATION_ONSET = 0.8;
const DROPOUT_SIXTEENTHS = 4;
const REVEALED_AFTER_SEC = 0.15;
const REVEALED_MIN_SEC = 0.25;
const SHORT_NOTE_FRACTION_OF_16TH = 0.75;
const REGISTER_QUANTILE = 0.75;
const BELOW_REGISTER_SEMITONES = 19;

export function foldIntoFlute(midi: number): Midi {
  let m = Math.round(midi);
  while (m < FLUTE_LOW) m += 12;
  while (m > FLUTE_HIGH) m -= 12;
  return m as Midi;
}

function salience(note: DetectedNote): number {
  return note.amplitude + 0.1 * Math.min(note.durSec, 1) + 0.01 * note.midi;
}

function absorbWeakerTails(notes: readonly DetectedNote[]): DetectedNote[] {
  const out: DetectedNote[] = [];
  const lastByPitch = new Map<number, DetectedNote>();
  for (const note of [...notes].sort((a, b) => a.onsetSec - b.onsetSec)) {
    const prev = lastByPitch.get(note.midi);
    const isTail =
      prev !== undefined &&
      note.onsetSec - (prev.onsetSec + prev.durSec) < TAIL_GAP_SEC &&
      note.amplitude < prev.amplitude * TAIL_AMPLITUDE_RATIO;
    if (isTail) {
      prev.durSec = Math.max(prev.durSec, note.onsetSec + note.durSec - prev.onsetSec);
      continue;
    }
    const own = { ...note };
    out.push(own);
    lastByPitch.set(own.midi, own);
  }
  return out;
}

function registerFloor(notes: readonly DetectedNote[]): number {
  const weighted = notes.map((x) => ({ midi: x.midi, weight: x.durSec * x.amplitude })).sort((a, b) => a.midi - b.midi);
  const target = REGISTER_QUANTILE * weighted.reduce((sum, x) => sum + x.weight, 0);
  let seen = 0;
  const upper = weighted.find((x) => (seen += x.weight) >= target) ?? weighted.at(-1)!;
  return upper.midi - BELOW_REGISTER_SEMITONES;
}

export function reduceToLine(detected: readonly DetectedNote[], transpose: number): DetectedNote[] {
  if (detected.length === 0) return [];
  const floor = registerFloor(detected);
  const notes = absorbWeakerTails(detected.filter((x) => x.midi >= floor));
  const frameOf = (sec: number) => Math.round(sec * FRAMES_PER_SEC);
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

  const midiAt = (f: number) => (winner[f]! < 0 ? -1 : notes[winner[f]!]!.midi);
  const continues = (f: number) => {
    if (winner[f] === winner[f - 1]) return true;
    const previous = notes[winner[f - 1]!];
    return (
      previous !== undefined && midiAt(f) === previous.midi && frameOf(previous.onsetSec + previous.durSec) > f
    );
  };

  const line: DetectedNote[] = [];
  let start = 0;
  for (let f = 1; f <= totalFrames; f++) {
    if (f < totalFrames && continues(f)) continue;
    const src = notes[winner[start]!];
    const durSec = (f - start) / FRAMES_PER_SEC;
    const revealed = src !== undefined && start / FRAMES_PER_SEC - src.onsetSec > REVEALED_AFTER_SEC;
    const covered = src !== undefined && src.onsetSec + src.durSec - f / FRAMES_PER_SEC > REVEALED_AFTER_SEC;
    if (src !== undefined && durSec >= (revealed || covered ? REVEALED_MIN_SEC : MIN_BLIP_SEC)) {
      line.push({
        midi: foldIntoFlute(src.midi + transpose),
        onsetSec: start / FRAMES_PER_SEC,
        durSec,
        amplitude: src.amplitude,
        onset: revealed ? 0 : src.onset,
      });
    }
    start = f;
  }
  return line;
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

const MELODY: readonly Simplification[] = [mergeFragments, dropShortNotes];

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
