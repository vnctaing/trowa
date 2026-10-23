import type { MonoPcm } from './wav';

const LEAD_LOW_HZ = 200;
const LEAD_HIGH_HZ = 4000;

function biquad(samples: Float32Array, sampleRate: number, kind: 'highpass' | 'lowpass', hz: number): Float32Array {
  const w = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const [b0, b1, b2] = kind === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export function leadEmphasis({ samples, sampleRate }: MonoPcm): Float32Array {
  const high = biquad(biquad(samples, sampleRate, 'highpass', LEAD_LOW_HZ), sampleRate, 'highpass', LEAD_LOW_HZ);
  return biquad(biquad(high, sampleRate, 'lowpass', LEAD_HIGH_HZ), sampleRate, 'lowpass', LEAD_HIGH_HZ);
}

export async function requestStem(wav: ArrayBuffer, endpoint: string): Promise<ArrayBuffer | null> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav }).catch(() => null);
  return response?.ok ? response.arrayBuffer() : null;
}
