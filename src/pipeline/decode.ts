import { MAX_TRACK_SECONDS, TrowaError } from '../domain';
import type { MonoPcm } from './wav';

export const PITCH_SAMPLE_RATE = 22050;

export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  let buffer: AudioBuffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  } catch {
    throw new TrowaError('decode_failed');
  }
  if (buffer.length === 0) throw new TrowaError('decode_failed');
  if (buffer.duration > MAX_TRACK_SECONDS) throw new TrowaError('too_long');
  return buffer;
}

export async function toMonoPcm(buffer: AudioBuffer, sampleRate: number): Promise<MonoPcm> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * sampleRate), sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  node.start();
  const rendered = await ctx.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate };
}
