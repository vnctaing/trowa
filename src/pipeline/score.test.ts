import { describe, expect, it } from 'vitest';
import { TrowaError, type DetectedNote, type Midi, type Options, type QuantizedNote, type Score } from '../domain';
import type { Detection } from './pitch';
import { buildScore, transposeScore } from './score';

const note = (midi: number | null, startTick: number, durTicks: number): QuantizedNote => ({
  midi: midi as Midi | null,
  startTick,
  durTicks,
});

const score = (notes: QuantizedNote[]): Score => ({
  title: 't',
  source: 's',
  bpm: 100,
  beatsPerBar: 4,
  beatUnit: 4,
  keyFifths: 0,
  notes,
  confidence: 1,
});

describe('transposeScore', () => {
  it('shifts notes and the key signature', () => {
    const out = transposeScore(score([note(60, 0, 4), note(null, 4, 4), note(64, 8, 4)]), 2);
    expect(out.notes.map((x) => x.midi)).toEqual([62, null, 66]);
    expect(out.keyFifths).toBe(2);
  });

  it('keeps notes inside the flute range by octave folding', () => {
    const out = transposeScore(score([note(61, 0, 4), note(95, 4, 4)]), -3);
    expect(out.notes.map((x) => x.midi)).toEqual([70, 92]);
    expect(transposeScore(score([note(95, 0, 4)]), 3).notes[0]!.midi).toBe(86);
  });

  it('moves a semitone down from C major to B major', () => {
    expect(transposeScore(score([]), -1).keyFifths).toBe(5);
  });
});

const C_MAJOR_TUNE = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 67, 64, 60, 60];
const detected = (midis: number[], beatSec = 0.6): DetectedNote[] =>
  midis.map((m, i) => ({ midi: m as Midi, onsetSec: 0.5 + i * beatSec, durSec: beatSec - 0.08, amplitude: 0.8, onset: 0.9 }));
const detection = (notes: DetectedNote[], voicedFraction = 0.8): Detection => ({ notes, voicedFraction });
const defaults: Options = { transpose: 0, key: 'auto', difficulty: 'melody', tempoOverride: null };
const meta = { title: 'Tune', source: 'tune.wav' };

describe('buildScore', () => {
  it('turns a clean detected melody into a confident score', () => {
    const out = buildScore(detection(detected(C_MAJOR_TUNE)), defaults, meta);
    expect(out.notes.map((x) => x.midi)).toEqual(C_MAJOR_TUNE);
    expect(Math.round(out.bpm)).toBe(100);
    expect(out.keyFifths).toBe(0);
    expect(out.confidence).toBeGreaterThan(0.8);
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(out).toMatchObject(meta);
  });

  it('throws no_melody when there is essentially no pitched content', () => {
    const attempt = (d: Detection) => () => buildScore(d, defaults, meta);
    expect(attempt(detection([], 0))).toThrow(TrowaError);
    expect(attempt(detection(detected([60, 64, 67]), 0.05))).toThrowError(expect.objectContaining({ kind: 'no_melody' }));
    expect(attempt(detection(detected(C_MAJOR_TUNE), 0.0))).toThrowError(expect.objectContaining({ kind: 'no_melody' }));
    const scatteredBlips = C_MAJOR_TUNE.map((m, i) => ({ midi: m as Midi, onsetSec: i * 2, durSec: 0.1, amplitude: 0.4, onset: 0.9 }));
    expect(attempt(detection(scatteredBlips, 0.05))).toThrowError(expect.objectContaining({ kind: 'no_melody' }));
  });

  it('respects tempoOverride, a numeric key and transpose', () => {
    const out = buildScore(detection(detected(C_MAJOR_TUNE)), { ...defaults, tempoOverride: 50, key: -3, transpose: 2 }, meta);
    expect(out.bpm).toBe(50);
    expect(out.keyFifths).toBe(-3);
    expect(out.notes.slice(0, 3).map((x) => [x.midi, x.durTicks])).toEqual([
      [62, 2],
      [64, 2],
      [66, 2],
    ]);
  });

  it('plays the melody sheet legato through a short gap but keeps the rest in ornaments', () => {
    const detached = C_MAJOR_TUNE.map((m, i) => ({ midi: m as Midi, onsetSec: 0.5 + i * 0.6, durSec: 0.3, amplitude: 0.8, onset: 0.9 }));
    const rests = (difficulty: Options['difficulty']) =>
      buildScore(detection(detached), { ...defaults, difficulty, tempoOverride: 100 }, meta).notes.filter((x) => x.midi === null);
    expect(rests('melody')).toEqual([]);
    expect(rests('ornaments').length).toBeGreaterThan(0);
  });
});
