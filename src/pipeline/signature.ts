import { SIGNATURE_SLICES, type TrackSignature } from '../domain';
import type { MonoPcm } from './wav';

const PULSE_HOP = 512;
const SLOWEST_BPM = 60;
const FASTEST_BPM = 180;
const LIKELY_BPM = 115;
const BRIGHT_CROSSINGS_PER_SEC = 4000;

function sliceBounds(length: number, k: number): [number, number] {
  return [Math.floor((k * length) / SIGNATURE_SLICES), Math.floor(((k + 1) * length) / SIGNATURE_SLICES)];
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

export function estimatePulse({ samples, sampleRate }: MonoPcm): number {
  const hops = Math.floor(samples.length / PULSE_HOP);
  const flux = new Float32Array(hops);
  let previous = 0;
  for (let h = 0; h < hops; h++) {
    const level = Math.log(1e-4 + rms(samples, h * PULSE_HOP, (h + 1) * PULSE_HOP));
    flux[h] = Math.max(0, level - previous);
    previous = level;
  }
  const hopsPerSec = sampleRate / PULSE_HOP;
  let best = { bpm: LIKELY_BPM, score: -Infinity };
  for (let bpm = SLOWEST_BPM; bpm <= FASTEST_BPM; bpm++) {
    const lag = (60 * hopsPerSec) / bpm;
    const whole = Math.floor(lag);
    const part = lag - whole;
    let sum = 0;
    for (let h = 0; h + whole + 1 < hops; h++) sum += flux[h]! * (flux[h + whole]! * (1 - part) + flux[h + whole + 1]! * part);
    const prior = Math.exp(-0.5 * Math.log2(bpm / LIKELY_BPM) ** 2);
    const score = (sum / Math.max(1, hops - whole)) * prior;
    if (score > best.score) best = { bpm, score };
  }
  return best.bpm;
}

export function trackSignature(pcm: MonoPcm): TrackSignature {
  const { samples, sampleRate } = pcm;
  const energy = new Float32Array(SIGNATURE_SLICES);
  const brightness = new Float32Array(SIGNATURE_SLICES);
  for (let k = 0; k < SIGNATURE_SLICES; k++) {
    const [from, to] = sliceBounds(samples.length, k);
    energy[k] = rms(samples, from, to);
    let crossings = 0;
    for (let i = from + 1; i < to; i++) if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++;
    brightness[k] = to > from ? Math.min(1, (crossings * sampleRate) / (to - from) / BRIGHT_CROSSINGS_PER_SEC) : 0;
  }
  const loudest = Math.max(1e-6, ...energy);
  energy.forEach((v, k) => (energy[k] = v / loudest));
  return { durationSec: samples.length / sampleRate, bpm: estimatePulse(pcm), energy, brightness };
}

export function leadShare(mix: Float32Array, lead: Float32Array): Float32Array {
  const share = new Float32Array(SIGNATURE_SLICES);
  for (let k = 0; k < SIGNATURE_SLICES; k++) {
    const [from, to] = sliceBounds(mix.length, k);
    const whole = rms(mix, from, to);
    share[k] = whole > 1e-4 ? Math.min(1, rms(lead, from, Math.min(to, lead.length)) / whole) : 0;
  }
  return share;
}
