import { describe, expect, it } from 'vitest';
import type { DetectedNote, Midi } from '../domain';
import { applyDifficulty, foldIntoFlute, reduceToLine } from './melody';

const n = (midi: number, onsetSec: number, durSec: number, amplitude = 0.8): DetectedNote => ({
  midi: midi as Midi,
  onsetSec,
  durSec,
  amplitude,
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
      [n(60, 0, 1), n(64, 0.5, 1, 0.9), n(67, 1.2, 0.5), n(62, 1.3, 0.2, 0.2)],
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
    const line = reduceToLine([n(60, 0, 0.5), n(95, 0.6, 0.5)], 2);
    expect(pitches(line)).toEqual([62, 85]);
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
});
