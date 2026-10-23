import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';
import type { DetectedNote, Midi } from '../../src/domain';
export { LOWEST_MIDI, NOTE_BINS };

import { LOWEST_MIDI, NOTE_BINS, type Activations as LeadActivations } from '../../src/pipeline/track';

export const ACTIVATIONS_DIR = '.cache/activations';
export const CONTOUR_BINS = 264;

export type Activations = LeadActivations & { durationSec: number; contours: Float32Array };

export function loadModel(): Promise<tf.GraphModel> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/@spotify/basic-pitch/model');
  const json = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
  const weights = readFileSync(join(dir, json.weightsManifest[0].paths[0]));
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest[0].weights,
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
    }),
  );
}

function flatten(rows: number[][], width: number): Float32Array {
  const out = new Float32Array(rows.length * width);
  rows.forEach((row, i) => out.set(row, i * width));
  return out;
}

export async function computeActivations(samples: Float32Array, model = loadModel()): Promise<Activations> {
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await new BasicPitch(model).evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    () => {},
  );
  return {
    frameCount: frames.length,
    durationSec: samples.length / 22050,
    frames: flatten(frames, NOTE_BINS),
    onsets: flatten(onsets, NOTE_BINS),
    contours: flatten(contours, CONTOUR_BINS),
  };
}

export function saveActivations(name: string, a: Activations): void {
  mkdirSync(ACTIVATIONS_DIR, { recursive: true });
  writeFileSync(join(ACTIVATIONS_DIR, `${name}.json`), JSON.stringify({ frameCount: a.frameCount, durationSec: a.durationSec }));
  const all = new Float32Array(a.frames.length + a.onsets.length + a.contours.length);
  all.set(a.frames, 0);
  all.set(a.onsets, a.frames.length);
  all.set(a.contours, a.frames.length + a.onsets.length);
  writeFileSync(join(ACTIVATIONS_DIR, `${name}.f32`), new Uint8Array(all.buffer));
}

export function hasActivations(name: string): boolean {
  return existsSync(join(ACTIVATIONS_DIR, `${name}.f32`));
}

export function loadActivations(name: string): Activations {
  const head = JSON.parse(readFileSync(join(ACTIVATIONS_DIR, `${name}.json`), 'utf8')) as { frameCount: number; durationSec: number };
  const bytes = readFileSync(join(ACTIVATIONS_DIR, `${name}.f32`));
  const all = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const n = head.frameCount;
  return {
    ...head,
    frames: all.slice(0, n * NOTE_BINS),
    onsets: all.slice(n * NOTE_BINS, 2 * n * NOTE_BINS),
    contours: all.slice(2 * n * NOTE_BINS, 2 * n * NOTE_BINS + n * CONTOUR_BINS),
  };
}

function unflatten(flat: Float32Array, width: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < flat.length; i += width) rows.push(Array.from(flat.subarray(i, i + width)));
  return rows;
}

export function notesFromActivations(a: Activations): DetectedNote[] {
  const frames = unflatten(a.frames, NOTE_BINS);
  const onsets = unflatten(a.onsets, NOTE_BINS);
  const events = outputToNotesPoly(frames, onsets);
  const onsetPeak = (frame: number, midi: number) =>
    Math.max(...[frame - 1, frame, frame + 1].map((f) => onsets[f]?.[midi - LOWEST_MIDI] ?? 0));
  return noteFramesToTime(events).map((e, i) => ({
    midi: e.pitchMidi as Midi,
    onsetSec: e.startTimeSeconds,
    durSec: e.durationSeconds,
    amplitude: e.amplitude,
    onset: onsetPeak(events[i]!.startFrame, e.pitchMidi),
  }));
}
