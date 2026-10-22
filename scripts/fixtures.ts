import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav } from '../src/pipeline/wav';

const RATE = 22050;
const BPM = 100;
const BEAT = 60 / BPM;

export const TWINKLE: readonly [string, number][] = [
  ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
  ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
  ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
  ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
  ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
  ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
];

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (name: string) => 12 * (Number(name.slice(-1)) + 1) + SEMITONE[name[0]!]!;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function tone(out: Float32Array, startSec: number, durSec: number, midi: number, gain: number) {
  const f = hz(midi);
  const start = Math.round(startSec * RATE);
  const length = Math.round(durSec * RATE);
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / RATE;
    const envelope = Math.min(1, t / 0.02) * Math.min(1, (durSec - t) / 0.03);
    const wave = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t);
    out[start + i]! += gain * envelope * wave;
  }
}

function seededNoise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

function twinkle(withAccompaniment: boolean): Float32Array {
  const lead = 1.0;
  const totalBeats = TWINKLE.reduce((s, [, b]) => s + b, 0);
  const out = new Float32Array(Math.ceil((lead + totalBeats * BEAT + 1) * RATE));
  let t = lead;
  for (const [name, beats] of TWINKLE) {
    tone(out, t, beats * BEAT - 0.08, midiOf(name), 0.25);
    t += beats * BEAT;
  }
  if (withAccompaniment) {
    const verse = ['C3', 'C3', 'F2', 'C3', 'G2', 'C3', 'G2', 'C3'];
    const bridge = ['C3', 'G2', 'C3', 'G2', 'C3', 'G2', 'C3', 'G2'];
    [...verse, ...bridge, ...verse].forEach((root, half) => {
      tone(out, lead + half * 2 * BEAT, 2 * BEAT - 0.1, midiOf(root), 0.12);
    });
  }
  return out;
}

function drums(seconds: number): Float32Array {
  const out = new Float32Array(seconds * RATE);
  const noise = seededNoise(7);
  const eighth = BEAT / 2;
  for (let step = 0; step * eighth < seconds - 0.5; step++) {
    const start = Math.round(step * eighth * RATE);
    const isKick = step % 4 === 0;
    const isSnare = step % 4 === 2;
    for (let i = 0; i < RATE * 0.25 && start + i < out.length; i++) {
      const t = i / RATE;
      let v = 0.15 * noise() * Math.exp(-t / 0.02);
      if (isKick) v += 0.8 * Math.sin(2 * Math.PI * (50 * t + 60 * 0.05 * (1 - Math.exp(-t / 0.05)))) * Math.exp(-t / 0.12);
      if (isSnare) v += 0.5 * noise() * Math.exp(-t / 0.08);
      out[start + i]! += v;
    }
  }
  return out;
}

function whiteNoise(seconds: number): Float32Array {
  const noise = seededNoise(42);
  return Float32Array.from({ length: seconds * RATE }, () => 0.3 * noise());
}

const dir = process.argv[2] ?? '.proof/fixtures';
mkdirSync(dir, { recursive: true });
const files: [string, Float32Array][] = [
  ['twinkle.wav', twinkle(false)],
  ['twinkle-with-bass.wav', twinkle(true)],
  ['drums.wav', drums(20)],
  ['noise.wav', whiteNoise(15)],
];
for (const [name, samples] of files) {
  writeFileSync(join(dir, name), encodeWav({ samples, sampleRate: RATE }));
  console.log(`wrote ${join(dir, name)} (${(samples.length / RATE).toFixed(2)} s)`);
}
