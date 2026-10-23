import type { DetectedNote, Midi } from '../domain';

export const FRAME_SEC = 256 / 22050;
export const LOWEST_MIDI = 21;
export const NOTE_BINS = 88;
const WINDOW_FRAMES = 172;
const WINDOW_OFFSET_SEC = FRAME_SEC * (WINDOW_FRAMES - (22050 * 2 - 256) / 256) + 0.0018;

export const frameToSec = (frame: number) => frame * FRAME_SEC - WINDOW_OFFSET_SEC * Math.floor(frame / WINDOW_FRAMES);

export type Activations = { frameCount: number; frames: Float32Array; onsets: Float32Array };

const LOW_MIDI = 43;
const HIGH_MIDI = 96;
const VOICED_THRESHOLD = 0.25;
const HEIGHT_PER_OCTAVE = 0.6;
const CHANGE_COST = 3;
const LEAP_COST_PER_OCTAVE = 3;
const VOICING_COST = 3;
const REGISTER_WINDOW_SEC = 3;
const REGISTER_QUANTILE = 0.7;
const REGISTER_MARGIN = 7;
const REGISTER_COST = 3;
const ONSET_SPLIT = 0.5;
const ONSET_RISE = 0.3;
const MIN_NOTE_FRAMES = 3;
const PITCHES = HIGH_MIDI - LOW_MIDI + 1;
const UNVOICED = PITCHES;
const STATES = PITCHES + 1;

function transition(from: number, to: number): number {
  if (from === to) return 0;
  if (from === UNVOICED || to === UNVOICED) return -VOICING_COST;
  return -(CHANGE_COST + (LEAP_COST_PER_OCTAVE * Math.min(Math.abs(from - to), 12)) / 12);
}

function viterbi(a: Activations, register: Float32Array | null): Int16Array {
  const n = a.frameCount;
  const emission = new Float64Array(STATES);
  const score = new Float64Array(STATES);
  const next = new Float64Array(STATES);
  const back = new Int16Array(n * STATES);

  for (let t = 0; t < n; t++) {
    const row = a.frames.subarray(t * NOTE_BINS, (t + 1) * NOTE_BINS);
    const center = register?.[t] ?? -1;
    for (let s = 0; s < PITCHES; s++) {
      const midi = s + LOW_MIDI;
      const act = row[midi - LOWEST_MIDI] ?? 0;
      const height = act >= VOICED_THRESHOLD ? (HEIGHT_PER_OCTAVE * (midi - 60)) / 12 : 0;
      const drift = center < 0 ? 0 : (REGISTER_COST * Math.max(0, Math.abs(midi - center) - REGISTER_MARGIN)) / 12;
      emission[s] = Math.log(act + 1e-3) + height - drift;
    }
    emission[UNVOICED] = Math.log(VOICED_THRESHOLD);

    let bestState = 0;
    for (let s = 1; s < STATES; s++) if (score[s]! > score[bestState]!) bestState = s;
    for (let to = 0; to < STATES; to++) {
      let best = score[to]!;
      let from = to;
      const consider = (f: number) => {
        const v = score[f]! + transition(f, to);
        if (v > best) {
          best = v;
          from = f;
        }
      };
      consider(bestState);
      if (to !== UNVOICED) {
        for (let d = 1; d <= 12; d++) {
          if (to - d >= 0) consider(to - d);
          if (to + d < PITCHES) consider(to + d);
        }
        consider(UNVOICED);
      }
      next[to] = best + emission[to]!;
      back[t * STATES + to] = from;
    }
    score.set(next);
  }

  const path = new Int16Array(n);
  let s = 0;
  for (let i = 1; i < STATES; i++) if (score[i]! > score[s]!) s = i;
  for (let t = n - 1; t >= 0; t--) {
    path[t] = s === UNVOICED ? -1 : s + LOW_MIDI;
    s = back[t * STATES + s]!;
  }
  return path;
}

function registerOf(path: Int16Array): Float32Array {
  const half = Math.round(REGISTER_WINDOW_SEC / FRAME_SEC);
  const out = new Float32Array(path.length).fill(-1);
  const counts = new Int32Array(128);
  let voiced = 0;
  const add = (t: number, sign: 1 | -1) => {
    const m = path[t]!;
    if (m < 0) return;
    counts[m] = counts[m]! + sign;
    voiced += sign;
  };
  for (let t = 0; t < Math.min(path.length, half); t++) add(t, 1);
  for (let t = 0; t < path.length; t++) {
    if (t + half < path.length) add(t + half, 1);
    if (t - half - 1 >= 0) add(t - half - 1, -1);
    if (voiced === 0) continue;
    let seen = 0;
    for (let m = 0; m < 128; m++) {
      seen += counts[m]!;
      if (seen >= REGISTER_QUANTILE * voiced) {
        out[t] = m;
        break;
      }
    }
  }
  return out;
}

function segment(a: Activations, path: Int16Array): DetectedNote[] {
  const notes: DetectedNote[] = [];
  const onsetAt = (t: number, midi: number) => a.onsets[t * NOTE_BINS + midi - LOWEST_MIDI] ?? 0;
  const actAt = (t: number, midi: number) => a.frames[t * NOTE_BINS + midi - LOWEST_MIDI] ?? 0;
  let start = 0;
  const flush = (end: number) => {
    const midi = path[start]!;
    if (midi < 0 || end - start < MIN_NOTE_FRAMES) return;
    let sum = 0;
    for (let t = start; t < end; t++) sum += actAt(t, midi);
    const onsetSec = frameToSec(start);
    const onset = Math.max(onsetAt(Math.max(0, start - 1), midi), onsetAt(start, midi), onsetAt(start + 1, midi));
    notes.push({ midi: midi as Midi, onsetSec, durSec: frameToSec(end) - onsetSec, amplitude: sum / (end - start), onset });
  };
  for (let t = 1; t <= path.length; t++) {
    const midi = path[t] ?? -2;
    const same = midi === path[start];
    const rearticulated =
      same &&
      midi >= 0 &&
      t - start >= MIN_NOTE_FRAMES &&
      onsetAt(t, midi) >= ONSET_SPLIT &&
      onsetAt(t, midi) - Math.min(...[1, 2, 3, 4, 5].map((k) => onsetAt(Math.max(0, t - k), midi))) >= ONSET_RISE &&
      onsetAt(t, midi) >= onsetAt(t - 1, midi) &&
      onsetAt(t, midi) > onsetAt(t + 1, midi);
    if (same && !rearticulated) continue;
    flush(t);
    start = t;
  }
  return notes;
}

export function trackLead(a: Activations): DetectedNote[] {
  if (a.frameCount === 0) return [];
  return segment(a, viterbi(a, registerOf(viterbi(a, null))));
}
