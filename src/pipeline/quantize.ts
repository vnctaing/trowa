import { TICKS_PER_QUARTER, type QuantizedNote, type Score } from '../domain';
import type { MelodyNote } from './melody';

export type Meter = Pick<Score, 'beatsPerBar' | 'beatUnit'>;
export type Notation = { gridTicks: 1 | 2; legatoTicks: number };

const DETAILED: Notation = { gridTicks: 1, legatoTicks: 0 };

const ENVELOPE_STEP_SEC = 0.005;
const ONSET_SPREAD_SEC = 0.02;
const MIN_BPM = 50;
const MAX_BPM = 200;
const PREFERRED_BPM = 110;
const PHASE_LOCK_GAIN = 0.1;
const PHASE_STEPS = 48;
const PHASE_KERNEL_BEATS = 0.125;
const TRIPLE_METER_MARGIN = 1.25;
const METER_LEVEL_WEIGHTS = [1, 0.5, 0.25];

export function sixteenthSec(bpm: number): number {
  return 60 / bpm / TICKS_PER_QUARTER;
}

function onsetEnvelope(onsetsSec: readonly number[]): Float64Array {
  const first = Math.min(...onsetsSec);
  const spread = ONSET_SPREAD_SEC / ENVELOPE_STEP_SEC;
  const radius = Math.ceil(spread * 3);
  const length = Math.ceil((Math.max(...onsetsSec) - first) / ENVELOPE_STEP_SEC) + radius * 2 + 1;
  const env = new Float64Array(length);
  for (const onset of onsetsSec) {
    const center = (onset - first) / ENVELOPE_STEP_SEC + radius;
    for (let i = Math.floor(center - radius); i <= Math.ceil(center + radius); i++) {
      env[i] = env[i]! + Math.exp(-0.5 * ((i - center) / spread) ** 2);
    }
  }
  return env;
}

function autocorrelation(env: Float64Array, lag: number): number {
  let sum = 0;
  for (let i = 0; i + lag < env.length; i++) sum += env[i]! * env[i + lag]!;
  return sum;
}

export function estimateTempo(onsetsSec: readonly number[]): number {
  if (onsetsSec.length < 2) return PREFERRED_BPM;
  const env = onsetEnvelope(onsetsSec);
  const minLag = Math.floor(60 / MAX_BPM / ENVELOPE_STEP_SEC);
  const maxLag = Math.ceil(60 / MIN_BPM / ENVELOPE_STEP_SEC);
  const scores: number[] = [];
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    if (lag < minLag - 1) {
      scores.push(0);
      continue;
    }
    const bpm = 60 / (lag * ENVELOPE_STEP_SEC);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PREFERRED_BPM) / 0.9) ** 2);
    const periodicity = METER_LEVEL_WEIGHTS.reduce((sum, w, level) => sum + w * autocorrelation(env, lag * 2 ** level), 0);
    scores.push(periodicity * prior);
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag]! > scores[best]!) best = lag;

  const left = scores[best - 1] ?? 0;
  const right = scores[best + 1] ?? 0;
  const curvature = left - 2 * scores[best]! + right;
  const offset = curvature === 0 ? 0 : (0.5 * (left - right)) / curvature;
  const bpm = 60 / ((best + offset) * ENVELOPE_STEP_SEC);
  return Math.round(bpm * 100) / 100;
}

function beatPhaseSec(notes: readonly MelodyNote[], beatSec: number): number {
  const first = notes[0]!.onsetSec;
  const offsets = Array.from({ length: PHASE_STEPS }, (_, k) => k - PHASE_STEPS / 2).sort((a, b) => Math.abs(a) - Math.abs(b));
  let best = 0;
  let bestScore = -1;
  for (const offset of offsets) {
    const phase = (offset / PHASE_STEPS) * beatSec;
    let score = 0;
    for (const note of notes) {
      const beats = (note.onsetSec - first - phase) / beatSec;
      const distance = Math.abs(beats - Math.round(beats));
      score += Math.min(note.durSec, beatSec) * Math.exp(-0.5 * (distance / PHASE_KERNEL_BEATS) ** 2);
    }
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return best;
}

export function quantize(notes: readonly MelodyNote[], bpm: number, { gridTicks, legatoTicks }: Notation = DETAILED): QuantizedNote[] {
  const principal = notes.filter((x) => x.ornament !== 'grace');
  const first = principal[0];
  if (first === undefined) return [];
  const step = sixteenthSec(bpm);
  const beatSec = step * TICKS_PER_QUARTER;
  const phase = beatPhaseSec(principal, beatSec);
  const opensOnBeat = first.durSec >= beatSec;
  let origin = first.onsetSec + (phase > 0 && !opensOnBeat ? phase - beatSec : phase);

  type Placed = { midi: MelodyNote['midi']; start: number; end: number; graces: MelodyNote[] };
  const placed: Placed[] = [];
  let pendingGraces: MelodyNote[] = [];
  for (const note of notes) {
    if (note.ornament === 'grace') {
      pendingGraces.push(note);
      continue;
    }
    const snap = (sec: number) => gridTicks * Math.round((sec - origin) / step / gridTicks);
    const prev = placed[placed.length - 1];
    const snapped = snap(note.onsetSec);
    const start = prev ? Math.max(snapped, prev.start + gridTicks) : opensOnBeat ? 0 : snapped;
    if (start === snapped) origin += PHASE_LOCK_GAIN * (note.onsetSec - (origin + start * step));
    const end = Math.max(start + gridTicks, snap(note.onsetSec + note.durSec));
    placed.push({ midi: note.midi, start, end, graces: pendingGraces });
    pendingGraces = [];
  }

  const out: QuantizedNote[] = [];
  placed.forEach((note, i) => {
    const nextStart = placed[i + 1]?.start;
    let end = nextStart === undefined ? note.end : Math.min(note.end, nextStart);
    const articulationTarget = nextStart ?? Math.ceil(end / TICKS_PER_QUARTER) * TICKS_PER_QUARTER;
    const gap = articulationTarget - end;
    const detached = gap <= TICKS_PER_QUARTER && gap < Math.max(2, (end - note.start) / 2);
    if (gap > 0 && (gap <= legatoTicks || detached)) {
      end = articulationTarget;
    }
    for (const grace of note.graces) {
      out.push({ midi: grace.midi, startTick: note.start, durTicks: 0, ornament: 'grace' });
    }
    out.push({ midi: note.midi, startTick: note.start, durTicks: end - note.start });
    if (nextStart !== undefined && nextStart > end) {
      out.push({ midi: null, startTick: end, durTicks: nextStart - end });
    }
  });
  return out;
}

function downbeatStrength(notes: readonly QuantizedNote[], barTicks: number, phaseStep: number): number {
  const weight = new Array<number>(barTicks).fill(0);
  let total = 0;
  for (const note of notes) {
    if (note.midi === null || note.durTicks === 0) continue;
    const w = Math.min(note.durTicks, barTicks);
    weight[note.startTick % barTicks]! += w;
    total += w;
  }
  if (total === 0) return 0;
  let best = 0;
  for (let phase = 0; phase < barTicks; phase += phaseStep) best = Math.max(best, weight[phase]!);
  return (best / total) * (barTicks / TICKS_PER_QUARTER);
}

function positionWeight(notes: readonly QuantizedNote[], barTicks: number, positions: number[]): number {
  return notes
    .filter((x) => x.midi !== null && positions.includes(x.startTick % barTicks))
    .reduce((s, x) => s + x.durTicks, 0);
}

export function guessMeter(notes: readonly QuantizedNote[]): Meter {
  const quadruple = downbeatStrength(notes, 16, 2);
  const triple = downbeatStrength(notes, 12, 2);
  if (triple <= quadruple * TRIPLE_METER_MARGIN) return { beatsPerBar: 4, beatUnit: 4 };
  const compound = positionWeight(notes, 12, [6]) > positionWeight(notes, 12, [4, 8]);
  return compound ? { beatsPerBar: 6, beatUnit: 8 } : { beatsPerBar: 3, beatUnit: 4 };
}
