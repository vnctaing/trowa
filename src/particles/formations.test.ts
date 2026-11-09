import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Midi, TrackSignature } from '../domain';
import { prepare, type Formation, type Geometry, type Placed, type Sample, type Seeds } from './formations';
import { Song } from './song';

const COUNT = 400;
const geometry: Geometry = { w: 1200, h: 800 };

function seeds(): Seeds {
  let state = 7;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const arr = () => Float32Array.from({ length: COUNT }, next);
  return { a: arr(), b: arr(), c: arr(), d: arr() };
}

const SEEDS = seeds();

function signature(bpm: number): TrackSignature {
  const ramp = Float32Array.from({ length: 64 }, (_, k) => (k % 7) / 7);
  return { durationSec: 30, bpm, energy: ramp, brightness: ramp.map((v) => 1 - v) };
}

function sample(t: number, extra: Partial<Sample> = {}): Sample {
  return { i: 0, t, now: t, since: 5, calm: false, bands: new Float32Array(16), ...extra };
}

function positions(f: Formation, s: Sample, g = geometry): Placed[] {
  const { place } = prepare(f, g);
  return Array.from({ length: COUNT }, (_, i) => {
    const out = { x: 0, y: 0, alpha: 0, glow: 0 };
    place({ ...s, i }, SEEDS, out);
    return out;
  });
}

function largestStep(a: Placed[], b: Placed[]): number {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
}

afterEach(() => vi.restoreAllMocks());

describe('nebula', () => {
  it('keeps every particle in place when the tempo arrives late in a long session', () => {
    const song = new Song(1, () => null);
    const nebula: Formation = { kind: 'nebula', song };
    const t = 240;
    const before = positions(nebula, sample(t));
    song.apply({ type: 'signature', signature: signature(161) }, t);
    const after = positions(nebula, sample(t + 1 / 60));
    expect(largestStep(before, after)).toBeLessThan(15);
  });
});

describe('streams', () => {
  it('keeps every particle in place when the tempo arrives late in a long session', () => {
    const song = new Song(1, () => null);
    const streams: Formation = { kind: 'streams', song };
    const t = 240;
    const before = positions(streams, sample(t));
    song.apply({ type: 'signature', signature: signature(161) }, t);
    const after = positions(streams, sample(t + 1 / 60));
    expect(largestStep(before, after)).toBeLessThan(15);
  });
});

describe('reduced motion', () => {
  it('shows the finished nebula at once instead of morphing toward it', () => {
    const song = new Song(1, () => null);
    const nebula: Formation = { kind: 'nebula', song };
    song.apply({ type: 'signature', signature: signature(120) }, 10);
    const frozen = 9;
    const early = positions(nebula, sample(frozen, { now: 10.1, calm: true }));
    const late = positions(nebula, sample(frozen, { now: 30, calm: true }));
    expect(largestStep(early, late)).toBe(0);
  });

  it('shows found notes on the roll at full strength at once', () => {
    const song = new Song(1, () => null);
    song.apply({ type: 'signature', signature: signature(120) }, 0);
    const notes = Array.from({ length: 30 }, (_, k) => ({ midi: (60 + (k % 12)) as Midi, onsetSec: k, durSec: 0.9, amplitude: 0.5, onset: 0.5 }));
    song.apply({ type: 'notesFound', notes, throughSec: 30 }, 20);
    const roll: Formation = { kind: 'roll', song };
    const early = positions(roll, sample(5, { now: 20.05, since: 60, calm: true }));
    const late = positions(roll, sample(5, { now: 40, since: 60, calm: true }));
    expect(early.map((p) => p.alpha)).toEqual(late.map((p) => p.alpha));
  });
});

describe('roll', () => {
  it('keeps revealed notes in place when the window is resized', () => {
    const song = new Song(1, () => null);
    song.apply({ type: 'signature', signature: signature(120) }, 0);
    const notes = Array.from({ length: 30 }, (_, k) => ({ midi: (60 + (k % 12)) as Midi, onsetSec: k, durSec: 0.9, amplitude: 0.5, onset: 0.5 }));
    song.apply({ type: 'notesFound', notes, throughSec: 30 }, 1);
    const roll: Formation = { kind: 'roll', song };
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const settled = sample(60, { since: 60 });
    const beforeResize = positions(roll, settled);
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const afterResize = positions(roll, settled);
    expect(largestStep(beforeResize, afterResize)).toBeLessThan(1);
  });
});
