import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { GraphModel } from '@tensorflow/tfjs';
import type { DetectedNote, Midi } from '../domain';
import { throwIfAborted } from './abort';

const CONFIDENT_FRAME = 0.5;
const LOWEST_MIDI = 21;

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

  const raw = outputToNotesPoly(frames, onsets);
  const onsetPeak = (frame: number, midi: number) =>
    Math.max(...[frame - 1, frame, frame + 1].map((f) => onsets[f]?.[midi - LOWEST_MIDI] ?? 0));
  const voiced = frames.filter((row) => Math.max(...row) >= CONFIDENT_FRAME).length;
  onProgress(1);
  return {
    notes: noteFramesToTime(raw).map((e, i) => ({
      midi: e.pitchMidi as Midi,
      onsetSec: e.startTimeSeconds,
      durSec: e.durationSeconds,
      amplitude: e.amplitude,
      onset: onsetPeak(raw[i]!.startFrame, e.pitchMidi),
    })),
    voicedFraction: frames.length === 0 ? 0 : voiced / frames.length,
  };
}
