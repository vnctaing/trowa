import type { Score } from '../domain';
import { midiToHz, secondsPerTick } from '../ui/music';

const PEAK = 0.26;
const SAMPLE_RATE = 32000;
const TAIL_SEC = 0.6;

let noise: AudioBuffer | null = null;

function breathNoise(ctx: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

function voice(ctx: BaseAudioContext, out: AudioNode, hz: number, start: number, dur: number): void {
  const end = start + dur;
  const release = Math.min(0.09, dur * 0.3);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(PEAK, start + Math.min(0.07, dur * 0.4));
  amp.gain.setTargetAtTime(PEAK * 0.82, start + 0.08, 0.2);
  amp.gain.setTargetAtTime(0, end - release, release / 3);
  amp.connect(out);

  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.value = hz;
  const edge = ctx.createOscillator();
  edge.type = 'triangle';
  edge.frequency.value = hz;
  const edgeGain = ctx.createGain();
  edgeGain.gain.value = 0.22;
  body.connect(amp);
  edge.connect(edgeGain).connect(amp);

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.1;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(hz * 0.005, start + Math.min(0.45, dur));
  vibrato.connect(depth);
  depth.connect(body.frequency);
  depth.connect(edge.frequency);

  const breath = ctx.createBufferSource();
  breath.buffer = breathNoise(ctx);
  breath.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = Math.min(9000, hz * 2.2);
  band.Q.value = 0.9;
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(0, start);
  breathGain.gain.linearRampToValueAtTime(0.09, start + 0.03);
  breathGain.gain.setTargetAtTime(0.025, start + 0.05, 0.08);
  breathGain.gain.setTargetAtTime(0, end - release, release / 3);
  breath.connect(band).connect(breathGain).connect(out);

  for (const node of [body, edge, vibrato]) {
    node.start(start);
    node.stop(end + 0.2);
  }
  breath.start(start, Math.random());
  breath.stop(end + 0.2);
}

export function renderFlute(score: Score): Promise<AudioBuffer> {
  const spt = secondsPerTick(score);
  const end = Math.max(0, ...score.notes.map((n) => (n.startTick + n.durTicks) * spt));
  const ctx = new OfflineAudioContext(1, Math.ceil((end + TAIL_SEC) * SAMPLE_RATE), SAMPLE_RATE);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  tone.connect(ctx.destination);

  for (const n of score.notes) {
    if (n.midi === null) continue;
    const dur = n.ornament === 'grace' ? 0.07 : n.durTicks * spt * 0.96;
    voice(ctx, tone, midiToHz(n.midi), n.startTick * spt, dur);
  }
  return ctx.startRendering();
}
