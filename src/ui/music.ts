import { TICKS_PER_QUARTER, type Midi, type QuantizedNote, type Score } from '../domain';

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Spelling = { letter: Letter; alter: -1 | 0 | 1; octave: number };

const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_SPELLING: readonly [number, -1 | 0 | 1][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
];
const FLAT_SPELLING: readonly [number, -1 | 0 | 1][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
];

export function spell(midi: Midi, keyFifths: number): Spelling {
  const table = keyFifths < 0 ? FLAT_SPELLING : SHARP_SPELLING;
  const pc = ((midi % 12) + 12) % 12;
  const [letterIndex, alter] = table[pc] ?? [0, 0];
  return { letter: LETTERS[letterIndex] ?? 'C', alter, octave: Math.floor(midi / 12) - 1 };
}

export function diatonicIndex(s: Spelling): number {
  return s.octave * 7 + LETTERS.indexOf(s.letter);
}

const E4_INDEX = diatonicIndex({ letter: 'E', alter: 0, octave: 4 });

export function stepsAboveBottomLine(midi: Midi, keyFifths: number): number {
  return diatonicIndex(spell(midi, keyFifths)) - E4_INDEX;
}

export function measureTicks(score: Pick<Score, 'beatsPerBar' | 'beatUnit'>): number {
  return (score.beatsPerBar * TICKS_PER_QUARTER * 4) / score.beatUnit;
}

export function firstMeasure(score: Score): QuantizedNote[] {
  const end = measureTicks(score);
  const start = score.notes[0] ? Math.floor(score.notes[0].startTick / end) * end : 0;
  return score.notes.filter((n) => n.startTick >= start && n.startTick < start + end && !n.ornament);
}

export function secondsPerTick(score: Pick<Score, 'bpm'>): number {
  return 60 / score.bpm / TICKS_PER_QUARTER;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
