import { describe, expect, it } from 'vitest';
import type { DetectedNote, Midi } from '../domain';
import { applyDifficulty, foldIntoFlute, reduceToLine } from './melody';

const n = (midi: number, onsetSec: number, durSec: number, amplitude = 0.8, onset = 0.9): DetectedNote => ({
  midi: midi as Midi,
  onsetSec,
  durSec,
  amplitude,
  onset,
});

const pitches = (notes: { midi: number }[]) => notes.map((x) => x.midi);

describe('foldIntoFlute', () => {
  it('raises a C2 to C4', () => {
    expect(foldIntoFlute(36)).toBe(60);
  });

  it('lowers notes above C7 by octaves', () => {
    expect(foldIntoFlute(98)).toBe(86);
  });

  it('leaves in-range notes alone', () => {
    expect(foldIntoFlute(60)).toBe(60);
    expect(foldIntoFlute(96)).toBe(96);
  });
});

describe('reduceToLine', () => {
  it('keeps the louder note when two overlap for the whole span', () => {
    const line = reduceToLine([n(64, 0, 1, 0.3), n(67, 0, 1, 0.9)], 0);
    expect(pitches(line)).toEqual([67]);
  });

  it('prefers the higher note when amplitudes tie', () => {
    const line = reduceToLine([n(60, 0, 1, 0.5), n(72, 0, 1, 0.5)], 0);
    expect(pitches(line)).toEqual([72]);
  });

  it('never outputs overlapping notes', () => {
    const line = reduceToLine(
      [n(60, 0, 1), n(64, 0.5, 1, 0.9), n(67, 1.4, 0.5), n(62, 1.3, 0.2, 0.2)],
      0,
    );
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1]!;
      expect(line[i]!.onsetSec).toBeGreaterThanOrEqual(prev.onsetSec + prev.durSec - 1e-9);
    }
    expect(pitches(line)).toEqual([60, 64, 67]);
  });

  it('drops very short blips', () => {
    const line = reduceToLine([n(60, 0, 0.5), n(90, 0.6, 0.02), n(62, 0.7, 0.5)], 0);
    expect(pitches(line)).toEqual([60, 62]);
  });

  it('applies transpose before folding into the flute range', () => {
    const line = reduceToLine([n(84, 0, 0.5), n(95, 0.6, 0.5)], 2);
    expect(pitches(line)).toEqual([86, 85]);
  });

  it('merges overlapping duplicate detections of one pitch into one note', () => {
    const line = reduceToLine([n(60, 0, 0.5, 0.5), n(60, 0.3, 0.25, 0.9), n(62, 0.6, 0.5)], 0);
    expect(line.map((x) => [x.midi, x.onsetSec, x.durSec])).toEqual([
      [60, 0, 0.55],
      [62, 0.6, 0.5],
    ]);
  });

  it('absorbs a weaker contiguous tail of the same pitch', () => {
    const line = reduceToLine([n(60, 1.0, 0.48, 0.77), n(60, 1.48, 0.12, 0.5), n(62, 1.6, 0.48, 0.77)], 0);
    expect(line.map((x) => [x.midi, x.onsetSec, x.durSec])).toEqual([
      [60, 1, 0.6],
      [62, 1.6, 0.48],
    ]);
  });

  it('does not let a sustained accompaniment note surface in short melody gaps', () => {
    const melody = [n(60, 1.0, 0.5), n(62, 1.6, 0.5), n(64, 2.2, 0.5)];
    const bass = n(48, 1.02, 1.6, 0.6);
    expect(pitches(reduceToLine([...melody, bass], 0))).toEqual([60, 62, 64]);
  });

  it('keeps a lower note that sustains on alone after the melody stops', () => {
    const line = reduceToLine([n(72, 0, 0.5), n(67, 0, 1.5, 0.5)], 0);
    expect(pitches(line)).toEqual([72, 67]);
  });

  it('leaves out a bass line that sounds alone between melody notes far above it', () => {
    const melody = [72, 74, 76, 77, 79, 77, 76, 74].map((midi, i) => n(midi, i, 0.6));
    const bass = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => n(41, i + 0.6, 0.4, 0.7));
    expect(pitches(reduceToLine([...melody, ...bass], 0))).toEqual([72, 74, 76, 77, 79, 77, 76, 74]);
  });

  it('keeps repeated notes that are separately articulated', () => {
    const line = reduceToLine([n(60, 0, 0.5), n(60, 0.6, 0.5)], 0);
    expect(pitches(line)).toEqual([60, 60]);
  });
});

describe('applyDifficulty', () => {
  const sixteenth = 0.15;
  const line = [n(60, 0, 0.6), n(62, 0.6, 0.08), n(64, 0.68, 0.6)];

  it("drops notes shorter than a 16th in 'melody'", () => {
    const out = applyDifficulty(line, 'melody', sixteenth);
    expect(pitches(out)).toEqual([60, 64]);
    expect(out.every((x) => x.ornament === undefined)).toBe(true);
  });

  it("keeps a short note before its neighbor as a grace note in 'ornaments'", () => {
    const out = applyDifficulty(line, 'ornaments', sixteenth);
    expect(out.map((x) => [x.midi, x.ornament])).toEqual([
      [60, undefined],
      [62, 'grace'],
      [64, undefined],
    ]);
  });

  it("joins same-pitch fragments shorter than an eighth into one held note in 'melody'", () => {
    const held = [n(64, 1.0, 0.25), n(64, 1.28, 0.2), n(64, 1.51, 0.22), n(64, 1.76, 0.2), n(67, 2.0, 0.6)];
    expect(applyDifficulty(held, 'melody', sixteenth).map((x) => [x.midi, x.onsetSec, x.durSec])).toEqual([
      [64, 1.0, 0.96],
      [67, 2.0, 0.6],
    ]);
  });

  it("joins a long same-pitch re-onset that Basic Pitch heard no attack for in 'melody'", () => {
    const held = [n(64, 1.0, 0.5), n(64, 1.5, 0.5, 0.7, 0.55), n(67, 2.0, 0.6)];
    expect(applyDifficulty(held, 'melody', sixteenth).map((x) => [x.midi, x.onsetSec, x.durSec])).toEqual([
      [64, 1.0, 1.0],
      [67, 2.0, 0.6],
    ]);
  });

  it("keeps same-pitch quarter notes as separate notes in 'melody'", () => {
    const repeated = [n(60, 0, 0.6), n(60, 0.6, 0.55), n(62, 1.2, 0.6)];
    expect(pitches(applyDifficulty(repeated, 'melody', sixteenth))).toEqual([60, 60, 62]);
  });
});
