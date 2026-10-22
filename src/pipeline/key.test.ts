import { describe, expect, it } from 'vitest';
import type { Midi, QuantizedNote } from '../domain';
import { estimateKeyFifths } from './key';

const seq = (midis: number[], durTicks = 4): QuantizedNote[] =>
  midis.map((m, i) => ({ midi: m as Midi, startTick: i * durTicks, durTicks }));

describe('estimateKeyFifths', () => {
  it('reads a C major scale as 0 fifths', () => {
    expect(estimateKeyFifths(seq([60, 62, 64, 65, 67, 69, 71, 72]))).toBe(0);
  });

  it('reads a G major scale as 1 sharp', () => {
    expect(estimateKeyFifths(seq([67, 69, 71, 72, 74, 76, 78, 79]))).toBe(1);
  });

  it('reads an E-flat major arpeggio and scale as 3 flats', () => {
    expect(estimateKeyFifths(seq([63, 65, 67, 68, 70, 72, 74, 75, 70, 67, 63]))).toBe(-3);
  });

  it('reads A minor as its relative major, 0 fifths', () => {
    expect(estimateKeyFifths(seq([69, 71, 72, 74, 76, 72, 69, 64, 69, 68, 69]))).toBe(0);
  });

  it('reads B minor as 2 sharps', () => {
    expect(estimateKeyFifths(seq([71, 73, 74, 76, 78, 74, 71, 66, 71, 70, 71]))).toBe(2);
  });

  it('ignores rests', () => {
    const notes: QuantizedNote[] = [
      ...seq([60, 62, 64, 65, 67, 69, 71, 72]),
      { midi: null, startTick: 32, durTicks: 64 },
    ];
    expect(estimateKeyFifths(notes)).toBe(0);
  });
});
