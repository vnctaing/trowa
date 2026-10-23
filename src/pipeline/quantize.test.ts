import { describe, expect, it } from 'vitest';
import type { Midi, QuantizedNote } from '../domain';
import type { MelodyNote } from './melody';
import { estimateTempo, guessMeter, quantize } from './quantize';

const m = (midi: number, onsetSec: number, durSec: number, ornament?: 'grace'): MelodyNote => ({
  midi: midi as Midi,
  onsetSec,
  durSec,
  amplitude: 0.8,
  onset: 0.9,
  ...(ornament ? { ornament } : {}),
});

const timeline = (notes: QuantizedNote[]) => notes.map((x) => [x.midi, x.startTick, x.durTicks]);

function beatsToNotes(beats: number[], bpm: number, startSec = 0.37): MelodyNote[] {
  const beat = 60 / bpm;
  let t = startSec;
  return beats.map((b, i) => {
    const note = m(60 + (i % 5), t, b * beat - 0.1);
    t += b * beat;
    return note;
  });
}

const TWINKLE_BEATS = [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2];

describe('estimateTempo', () => {
  it('finds 100 bpm from a quarter-and-half-note melody', () => {
    const onsets = beatsToNotes(TWINKLE_BEATS, 100).map((x) => x.onsetSec);
    expect(estimateTempo(onsets)).toBeCloseTo(100, 0);
  });

  it('finds 120 bpm with onset jitter', () => {
    const onsets = beatsToNotes(TWINKLE_BEATS, 120).map((x, i) => x.onsetSec + (i % 2 ? 0.012 : -0.01));
    expect(Math.abs(estimateTempo(onsets) - 120)).toBeLessThan(2);
  });
});

describe('quantize', () => {
  it('snaps detached quarter notes to a contiguous quarter-note grid starting at tick 0', () => {
    const notes = [m(60, 1.0, 0.5), m(62, 1.6, 0.5), m(64, 2.21, 0.48), m(65, 2.79, 0.5)];
    expect(timeline(quantize(notes, 100))).toEqual([
      [60, 0, 4],
      [62, 4, 4],
      [64, 8, 4],
      [65, 12, 4],
    ]);
  });

  it('fills a silent beat with a rest', () => {
    const notes = [m(60, 0, 0.55), m(62, 1.2, 0.55)];
    expect(timeline(quantize(notes, 100))).toEqual([
      [60, 0, 4],
      [null, 4, 4],
      [62, 8, 4],
    ]);
  });

  it('uses the given tempo for the grid', () => {
    const notes = [m(60, 0, 0.55), m(62, 0.6, 0.55)];
    expect(timeline(quantize(notes, 50))).toEqual([
      [60, 0, 2],
      [62, 2, 2],
    ]);
  });

  it('places a grace note at its principal note with no duration', () => {
    const notes = [m(60, 0, 0.55), m(62, 0.55, 0.05, 'grace'), m(64, 0.6, 0.55)];
    const out = quantize(notes, 100);
    expect(out.map((x) => [x.midi, x.startTick, x.durTicks, x.ornament])).toEqual([
      [60, 0, 4, undefined],
      [62, 4, 0, 'grace'],
      [64, 4, 4, undefined],
    ]);
  });

  it('on an eighth-note grid, writes 16th-offset onsets and lengths as eighths', () => {
    const notes = [m(60, 0, 0.42), m(62, 0.42, 0.75), m(64, 1.17, 1.2)];
    expect(timeline(quantize(notes, 100, { gridTicks: 2, legatoTicks: 0 }))).toEqual([
      [60, 0, 2],
      [62, 2, 6],
      [64, 8, 8],
    ]);
  });

  it('with a one-beat legato, extends a note over a rest of up to a beat', () => {
    const notes = [m(60, 0, 0.3), m(62, 0.6, 0.55), m(64, 2.1, 0.55)];
    const legato = { gridTicks: 2, legatoTicks: 4 } as const;
    expect(timeline(quantize(notes, 100, legato))).toEqual([
      [60, 0, 4],
      [62, 4, 4],
      [null, 8, 6],
      [64, 14, 6],
    ]);
    expect(timeline(quantize(notes, 100))).toContainEqual([null, 2, 2]);
  });

  it('produces a gapless, non-overlapping timeline', () => {
    const out = quantize(beatsToNotes(TWINKLE_BEATS, 100), 100);
    const timed = out.filter((x) => x.ornament !== 'grace');
    for (let i = 1; i < timed.length; i++) {
      expect(timed[i]!.startTick).toBe(timed[i - 1]!.startTick + timed[i - 1]!.durTicks);
    }
    expect(timed.reduce((s, x) => s + x.durTicks, 0)).toBe(32 * 4);
  });
});

describe('guessMeter', () => {
  it('reads Twinkle as 4/4', () => {
    const out = quantize(beatsToNotes(TWINKLE_BEATS, 100), 100);
    expect(guessMeter(out)).toEqual({ beatsPerBar: 4, beatUnit: 4 });
  });

  it('reads a half-quarter waltz as 3/4', () => {
    const out = quantize(beatsToNotes(Array.from({ length: 16 }, (_, i) => (i % 2 ? 1 : 2)), 120), 120);
    expect(guessMeter(out)).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  it('reads a quarter-eighth lilt as 6/8', () => {
    const out = quantize(beatsToNotes(Array.from({ length: 24 }, (_, i) => (i % 2 ? 0.5 : 1)), 120), 120);
    expect(guessMeter(out)).toEqual({ beatsPerBar: 6, beatUnit: 8 });
  });
});
