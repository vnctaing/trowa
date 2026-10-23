import { describe, expect, it } from 'vitest';
import { SIGNATURE_SLICES } from '../domain';
import { leadShare, trackSignature } from './signature';

const RATE = 22050;

function clickTrack(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(RATE * seconds);
  const beat = (60 / bpm) * RATE;
  for (let b = 0; b * beat < out.length; b++) {
    const at = Math.round(b * beat);
    for (let i = 0; i < 600 && at + i < out.length; i++) out[at + i] = Math.sin(i * 0.3) * Math.exp(-i / 120);
  }
  return out;
}

function tone(hz: number, seconds: number, gain: (t: number) => number = () => 0.5): Float32Array {
  const out = new Float32Array(RATE * seconds);
  for (let i = 0; i < out.length; i++) out[i] = gain(i / RATE) * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

describe('trackSignature', () => {
  it.each([72, 100, 128, 150])('finds the pulse of a %i bpm click track', (bpm) => {
    expect(Math.abs(trackSignature({ samples: clickTrack(bpm, 20), sampleRate: RATE }).bpm - bpm)).toBeLessThanOrEqual(2);
  });

  it('follows the loudness over time, peaking at 1', () => {
    const { energy } = trackSignature({ samples: tone(440, 10, (t) => (t < 5 ? 0.1 : 0.8)), sampleRate: RATE });
    expect(energy).toHaveLength(SIGNATURE_SLICES);
    expect(energy[10]).toBeCloseTo(0.125, 2);
    expect(energy[SIGNATURE_SLICES - 10]).toBeCloseTo(1, 2);
  });

  it('reads a high tone as brighter than a low one', () => {
    const low = trackSignature({ samples: tone(220, 4), sampleRate: RATE }).brightness;
    const high = trackSignature({ samples: tone(1760, 4), sampleRate: RATE }).brightness;
    expect(high[50]! / low[50]!).toBeCloseTo(8, 0);
  });
});

describe('leadShare', () => {
  it('is the lead loudness over the mix loudness in each slice', () => {
    const mix = tone(440, 4);
    const lead = tone(440, 4, (t) => (t < 2 ? 0.5 : 0.1));
    const share = leadShare(mix, lead);
    expect(share[10]).toBeCloseTo(1, 2);
    expect(share[SIGNATURE_SLICES - 10]).toBeCloseTo(0.2, 2);
  });

  it('is zero where the mix is silent', () => {
    expect(leadShare(new Float32Array(RATE), new Float32Array(RATE)).every((v) => v === 0)).toBe(true);
  });
});
