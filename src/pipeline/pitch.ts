import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { GraphModel } from '@tensorflow/tfjs';
import type { DetectedNote, Midi } from '../domain';
import { throwIfAborted } from './abort';

export const PITCH_SAMPLE_RATE = 22050;
const CONFIDENT_FRAME = 0.5;

export type Detection = { notes: DetectedNote[]; voicedFraction: number };

export async function detectNotes(
  model: Promise<GraphModel>,
  samples: Float32Array,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Detection> {
  const basicPitch = new BasicPitch(model);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await basicPitch.evaluateModel(
    samples,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    (fraction) => {
      throwIfAborted(signal);
      onProgress(fraction);
    },
  );
  throwIfAborted(signal);

  const events = noteFramesToTime(outputToNotesPoly(frames, onsets));
  const voiced = frames.filter((row) => Math.max(...row) >= CONFIDENT_FRAME).length;
  onProgress(1);
  return {
    notes: events.map((e) => ({
      midi: e.pitchMidi as Midi,
      onsetSec: e.startTimeSeconds,
      durSec: e.durationSeconds,
      amplitude: e.amplitude,
    })),
    voicedFraction: frames.length === 0 ? 0 : voiced / frames.length,
  };
}
