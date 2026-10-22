import { describe, expect, it } from 'vitest';
import type { Midi, QuantizedNote, Score } from '../domain';
import { transposeScore } from './score';

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
