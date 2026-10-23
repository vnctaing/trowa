import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { GraphModel } from '@tensorflow/tfjs';
import type { DetectedNote, Midi } from '../domain';

const CONFIDENT_FRAME = 0.5;
const LOWEST_MIDI = 21;
const FRAME_SEC = 256 / 22050;

export type Detection = { notes: DetectedNote[]; voicedFraction: number };
export type FoundNotes = (notes: DetectedNote[], throughSec: number) => void;

function toDetected(events: ReturnType<typeof outputToNotesPoly>, onsets: number[][], frameOffset: number): DetectedNote[] {
  const onsetPeak = (frame: number, midi: number) =>
    Math.max(...[frame - 1, frame, frame + 1].map((f) => onsets[f]?.[midi - LOWEST_MIDI] ?? 0));
  const shifted = events.map((e) => ({ ...e, startFrame: e.startFrame + frameOffset }));
  return noteFramesToTime(shifted).map((e, i) => ({
    midi: e.pitchMidi as Midi,
    onsetSec: e.startTimeSeconds,
    durSec: e.durationSeconds,
    amplitude: e.amplitude,
    onset: onsetPeak(events[i]!.startFrame, e.pitchMidi),
  }));
}

export async function detectNotes(
  model: Promise<GraphModel>,
  samples: Float32Array,
  onProgress: (fraction: number) => void,
  onFound: FoundNotes,
): Promise<Detection> {
  const basicPitch = new BasicPitch(model);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await basicPitch.evaluateModel(
    samples,
    (f, o) => {
      const offset = frames.length;
      frames.push(...f);
      onsets.push(...o);
      onFound(toDetected(outputToNotesPoly(f, o), o, offset), frames.length * FRAME_SEC);
    },
    onProgress,
  );

  const voiced = frames.filter((row) => Math.max(...row) >= CONFIDENT_FRAME).length;
  const notes = toDetected(outputToNotesPoly(frames, onsets), onsets, 0);
  onProgress(1);
  return { notes, voicedFraction: frames.length === 0 ? 0 : voiced / frames.length };
}
