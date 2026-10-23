import { describe, expect, it } from 'vitest';
import type { DetectedNote, Midi } from '../domain';
import { applyDifficulty, foldIntoFlute, foldLine } from './melody';

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

describe('foldLine', () => {
  it('applies transpose before folding into the flute range', () => {
    const line = foldLine([n(84, 0, 0.5), n(95, 0.6, 0.5)], 2);
    expect(pitches(line)).toEqual([86, 85]);
  });

  it('moves a note detected an octave away from the rest of its phrase back into the phrase', () => {
    const line = foldLine([72, 74, 88, 76, 74, 86].map((midi, i) => n(midi, i * 0.5, 0.5)), 0);
    expect(pitches(line)).toEqual([72, 74, 76, 76, 74, 74]);
  });

  it('keeps a phrase that climbs stepwise over more than an octave', () => {
    const scale = [72, 74, 76, 77, 79, 81, 83, 84, 86, 88];
    expect(pitches(foldLine(scale.map((midi, i) => n(midi, i * 0.5, 0.5)), 0))).toEqual(scale);
  });

  it('judges each phrase on its own', () => {
    const low = [60, 62, 64].map((midi, i) => n(midi, i * 0.5, 0.5));
    const high = [84, 86, 88].map((midi, i) => n(midi, 3 + i * 0.5, 0.5));
    expect(pitches(foldLine([...low, ...high], 0))).toEqual([60, 62, 64, 84, 86, 88]);
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

  it("bridges a dropout of under a beat when the same pitch resumes without an attack in 'melody'", () => {
    const dropout = [n(71, 1.0, 1.5), n(71, 2.75, 1.25, 0.4, 0.3), n(76, 4.0, 0.5)];
    expect(applyDifficulty(dropout, 'melody', sixteenth).map((x) => [x.midi, x.onsetSec, x.durSec])).toEqual([
      [71, 1.0, 3.0],
      [76, 4.0, 0.5],
    ]);
  });

  it("keeps a same-pitch note re-struck after a short silence in 'melody'", () => {
    const restruck = [n(71, 0, 0.45), n(71, 0.6, 0.45, 0.8, 0.9)];
    expect(pitches(applyDifficulty(restruck, 'melody', sixteenth))).toEqual([71, 71]);
  });

  it("turns a held note with a 40 ms semitone wobble into one note in 'melody'", () => {
    const wobble = [n(76, 1.0, 1.0), n(77, 2.0, 0.04), n(76, 2.04, 0.96, 0.8, 0.5)];
    const out = applyDifficulty(foldLine(wobble, 0), 'melody', sixteenth);
    expect(out.map((x) => [x.midi, x.onsetSec])).toEqual([[76, 1.0]]);
    expect(out[0]!.durSec).toBeCloseTo(2.0);
  });

  it("moves a short note an octave away from its neighbor into the longer note's octave in 'melody'", () => {
    const flip = [n(71, 0, 0.7), n(83, 0.7, 0.25, 0.8, 0.9), n(71, 0.95, 0.25, 0.8, 0.9), n(83, 1.2, 3.0, 0.8, 0.9)];
    expect(pitches(applyDifficulty(flip, 'melody', sixteenth))).toEqual([71, 83, 83]);
  });

  it("keeps an octave leap between two notes of a beat or longer in 'melody'", () => {
    const leap = [n(60, 0, 1.2), n(72, 1.2, 1.2)];
    expect(pitches(applyDifficulty(leap, 'melody', sixteenth))).toEqual([60, 72]);
  });

  it("keeps same-pitch quarter notes as separate notes in 'melody'", () => {
    const repeated = [n(60, 0, 0.6), n(60, 0.6, 0.55), n(62, 1.2, 0.6)];
    expect(pitches(applyDifficulty(repeated, 'melody', sixteenth))).toEqual([60, 60, 62]);
  });
});
