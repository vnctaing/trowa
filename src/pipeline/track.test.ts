import { describe, expect, it } from 'vitest';
import { FRAME_SEC, frameToSec, LOWEST_MIDI, NOTE_BINS, trackLead, type Activations } from './track';

const FPS = 1 / FRAME_SEC;
type Voice = { midi: number; fromSec: number; toSec: number; act: number; onset?: number };

function activations(seconds: number, voices: Voice[]): Activations {
  const frameCount = Math.round(seconds * FPS);
  const frames = new Float32Array(frameCount * NOTE_BINS);
  const onsets = new Float32Array(frameCount * NOTE_BINS);
  for (const v of voices) {
    const from = Math.round(v.fromSec * FPS);
    const to = Math.round(v.toSec * FPS);
    for (let t = from; t < to; t++)
      frames[t * NOTE_BINS + v.midi - LOWEST_MIDI] = Math.max(frames[t * NOTE_BINS + v.midi - LOWEST_MIDI]!, v.act);
    onsets[from * NOTE_BINS + v.midi - LOWEST_MIDI] = v.onset ?? 0.9;
  }
  return { frameCount, frames, onsets };
}

const pitches = (notes: { midi: number }[]) => notes.map((x) => x.midi);
const spans = (notes: { onsetSec: number; durSec: number }[]) =>
  notes.map((x) => [x.onsetSec, x.onsetSec + x.durSec].map((s) => Math.round(s * 20) / 20));

function arpeggio(midis: number[], fromSec: number, toSec: number, stepSec: number, act: number): Voice[] {
  const out: Voice[] = [];
  for (let k = 0; fromSec + k * stepSec < toSec; k++) {
    out.push({ midi: midis[k % midis.length]!, fromSec: fromSec + k * stepSec, toSec: fromSec + (k + 1) * stepSec, act });
  }
  return out;
}

describe('trackLead', () => {
  it('follows a quieter sustained voice over a louder arpeggio an octave below', () => {
    const lead: Voice[] = [
      { midi: 78, fromSec: 0, toSec: 1, act: 0.5 },
      { midi: 81, fromSec: 1, toSec: 2, act: 0.5 },
      { midi: 79, fromSec: 2, toSec: 3, act: 0.5 },
    ];
    const line = trackLead(activations(3, [...lead, ...arpeggio([62, 66, 69], 0, 3, 0.25, 0.8)]));
    expect(pitches(line)).toEqual([78, 81, 79]);
  });

  it('leaves a gap where no pitch is confident instead of filling it with the accompaniment', () => {
    const line = trackLead(
      activations(3, [
        { midi: 76, fromSec: 0, toSec: 1, act: 0.7 },
        { midi: 52, fromSec: 1, toSec: 2, act: 0.2 },
        { midi: 76, fromSec: 2, toSec: 3, act: 0.7 },
      ]),
    );
    expect(spans(line)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('splits a repeated note at an onset peak', () => {
    const line = trackLead(
      activations(2, [
        { midi: 72, fromSec: 0, toSec: 1, act: 0.8 },
        { midi: 72, fromSec: 1, toSec: 2, act: 0.8, onset: 0.9 },
      ]),
    );
    expect(spans(line)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('does not split a held note whose onset activation merely wobbles without a sharp rise', () => {
    const a = activations(2, [{ midi: 72, fromSec: 0, toSec: 2, act: 0.8 }]);
    for (let t = 1; t < a.frameCount; t++) a.onsets[t * NOTE_BINS + 72 - LOWEST_MIDI] = t % 2 ? 0.6 : 0.45;
    expect(spans(trackLead(a))).toEqual([[0, 2]]);
  });

  it('holds a steady voice through a louder neighbor that flickers on and off', () => {
    const a = activations(2, [{ midi: 72, fromSec: 0, toSec: 2, act: 0.6 }]);
    for (let t = 0; t < a.frameCount; t++) if (t % 3) a.frames[t * NOTE_BINS + 73 - LOWEST_MIDI] = 0.95;
    expect(pitches(trackLead(a))).toEqual([72]);
    expect(spans(trackLead(a))).toEqual([[0, 2]]);
  });

  it('stays in the melody register when a louder note sounds an octave below', () => {
    const phrase: Voice[] = [
      { midi: 81, fromSec: 0, toSec: 2, act: 0.6 },
      { midi: 83, fromSec: 2, toSec: 3, act: 0.6 },
      { midi: 78, fromSec: 3, toSec: 5, act: 0.3 },
      { midi: 66, fromSec: 3, toSec: 5, act: 0.8 },
      { midi: 76, fromSec: 5, toSec: 7, act: 0.6 },
    ];
    expect(pitches(trackLead(activations(7, phrase)))).toEqual([81, 83, 78, 76]);
  });

  it("reports onsets on Basic Pitch's windowed time axis", () => {
    const line = trackLead(activations(5, [{ midi: 72, fromSec: 4, toSec: 5, act: 0.8 }]));
    expect(line[0]!.onsetSec).toBeCloseTo(frameToSec(Math.round(4 * FPS)), 5);
    expect(frameToSec(344)).toBeLessThan(344 * FRAME_SEC - 0.02);
  });

  it('returns nothing for an empty track', () => {
    expect(trackLead({ frameCount: 0, frames: new Float32Array(), onsets: new Float32Array() })).toEqual([]);
  });
});
