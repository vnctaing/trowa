import { TICKS_PER_QUARTER, type DetectedNote, type QuantizedNote, type Score } from '../../src/domain';
import type { Timing } from '../../src/pipeline/score';
import type { Truth, TruthNote } from './synth';

const FRAME_SEC = 0.01;
const ONSET_TOLERANCE_SEC = 0.08;
const PRECISION_WEIGHT = 0.5;
const BEAT_TOLERANCE = 0.06;

export type Candidate = { line: readonly DetectedNote[]; score: Score; timing: readonly Timing[] };
export type Intrusions = { other: number; octave: number; rest: number };

export type Metrics = {
  precision: number;
  recall: number;
  headline: number;
  precisionPc: number;
  recallPc: number;
  wrongNote: number;
  octave: number;
  restIntrusion: number;
  intrusions: Intrusions;
  linePrecision: number;
  lineRecall: number;
  onsetHit: number;
  tempoRatio: number;
  notes: number;
  notesPerBar: { median: number; max: number };
  sixteenthShare: number;
  offBeat: number;
  tiedOverBeat: number;
  rhythm: Rhythm;
  exact: boolean;
};

export type Rhythm = {
  matched: number;
  refOffBeat: number;
  spuriousOffBeat: number;
  missedOffBeat: number;
  onsetBiasMs: number;
  onsetSpreadMs: number;
};

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((1000 * part) / whole) / 1000);

function frameGrid(window: [number, number]): { frames: number; at: (sec: number) => number } {
  const [from, to] = window;
  return { frames: Math.ceil((to - from) / FRAME_SEC), at: (sec) => Math.round((sec - from) / FRAME_SEC) };
}

function paint(
  frames: number,
  at: (sec: number) => number,
  spans: readonly { midi: number; startSec: number; endSec: number }[],
): Int16Array {
  const out = new Int16Array(frames).fill(-1);
  for (const s of spans) {
    for (let f = Math.max(0, at(s.startSec)); f < Math.min(frames, at(s.endSec)); f++) out[f] = s.midi;
  }
  return out;
}

export function tickToSecMap(timing: readonly Timing[], bpm: number): (tick: number) => number {
  const points = timing.filter((p, i) => i === 0 || p.tick > timing[i - 1]!.tick);
  const secPerTick = 60 / bpm / TICKS_PER_QUARTER;
  return (tick) => {
    if (points.length === 0) return tick * secPerTick;
    if (tick <= points[0]!.tick) return points[0]!.sec + (tick - points[0]!.tick) * secPerTick;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (tick <= b.tick) return a.sec + ((tick - a.tick) * (b.sec - a.sec)) / (b.tick - a.tick);
    }
    const last = points.at(-1)!;
    return last.sec + (tick - last.tick) * secPerTick;
  };
}

function scoreSpans(score: Score, timing: readonly Timing[]) {
  const toSec = tickToSecMap(timing, score.bpm);
  return score.notes
    .filter((n) => n.midi !== null && n.ornament !== 'grace')
    .map((n) => ({ midi: n.midi!, startSec: toSec(n.startTick), endSec: toSec(n.startTick + n.durTicks), note: n }));
}

function compare(ref: Int16Array, out: Int16Array, skip: Uint8Array) {
  let outSounding = 0;
  let refSounding = 0;
  let exact = 0;
  let pc = 0;
  let wrong = 0;
  let octave = 0;
  let rest = 0;
  for (let f = 0; f < ref.length; f++) {
    if (skip[f]) continue;
    const r = ref[f]!;
    const o = out[f]!;
    if (r >= 0) refSounding++;
    if (o < 0) continue;
    outSounding++;
    if (r < 0) rest++;
    else if (r === o) exact++;
    else if ((r - o) % 12 === 0) octave++;
    else wrong++;
    if (r >= 0 && (r - o) % 12 === 0) pc++;
  }
  return {
    precision: ratio(exact, outSounding),
    recall: ratio(exact, refSounding),
    precisionPc: ratio(pc, outSounding),
    recallPc: ratio(pc, refSounding),
    wrongNote: ratio(wrong, outSounding),
    octave: ratio(octave, outSounding),
    restIntrusion: ratio(rest, outSounding),
  };
}

export function fBeta(precision: number, recall: number, beta = PRECISION_WEIGHT): number {
  if (precision + recall === 0) return 0;
  const b2 = beta * beta;
  return Math.round((1000 * (1 + b2) * precision * recall) / (b2 * precision + recall)) / 1000;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const beatTicksOf = (score: Score) => (score.beatUnit === 8 ? (TICKS_PER_QUARTER * 3) / 2 : TICKS_PER_QUARTER);
const onOurBeat = (score: Score, tick: number) => tick % beatTicksOf(score) === 0;

function onRefBeat(truth: Truth, note: TruthNote): boolean {
  const group = truth.beatUnit === 8 ? 3 : 1;
  const phase = note.beat % group;
  return Math.min(phase, group - phase) < BEAT_TOLERANCE;
}

function readability(score: Score) {
  const sounding = score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace');
  const barTicks = score.beatsPerBar * (score.beatUnit === 4 ? TICKS_PER_QUARTER : TICKS_PER_QUARTER / 2);
  const beatTicks = beatTicksOf(score);
  const bars = new Map<number, number>();
  for (const n of sounding) {
    const bar = Math.floor(n.startTick / barTicks);
    bars.set(bar, (bars.get(bar) ?? 0) + 1);
  }
  const counts = [...bars.values()];
  const offBeat = sounding.filter((n) => !onOurBeat(score, n.startTick));
  const nextBeat = (tick: number) => (Math.floor(tick / beatTicks) + 1) * beatTicks;
  return {
    notes: sounding.length,
    notesPerBar: { median: median(counts), max: Math.max(0, ...counts) },
    sixteenthShare: ratio(sounding.filter((n) => n.durTicks === 1).length, sounding.length),
    offBeat: ratio(offBeat.length, sounding.length),
    tiedOverBeat: ratio(offBeat.filter((n) => n.startTick + n.durTicks > nextBeat(n.startTick)).length, sounding.length),
  };
}

function rhythm(score: Score, timing: readonly Timing[], truth: Truth, refOnsets: readonly TruthNote[]): Rhythm {
  const refOff = refOnsets.filter((n) => !onRefBeat(truth, n)).length;
  const matches = refOnsets.flatMap((n) => {
    const nearest = timing.reduce<Timing | null>(
      (best, t) => (Math.abs(t.sec - n.startSec) < Math.abs((best?.sec ?? Infinity) - n.startSec) ? t : best),
      null,
    );
    if (nearest === null || Math.abs(nearest.sec - n.startSec) > ONSET_TOLERANCE_SEC) return [];
    return [{ refOn: onRefBeat(truth, n), oursOn: onOurBeat(score, nearest.tick), errorSec: nearest.sec - n.startSec }];
  });
  const errors = matches.map((m) => m.errorSec * 1000);
  const q = (p: number) => {
    const s = [...errors].sort((a, b) => a - b);
    return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  };
  return {
    matched: matches.length,
    refOffBeat: ratio(refOff, refOnsets.length),
    spuriousOffBeat: ratio(matches.filter((m) => m.refOn && !m.oursOn).length, matches.length),
    missedOffBeat: ratio(matches.filter((m) => !m.refOn && m.oursOn).length, matches.length),
    onsetBiasMs: Math.round(median(errors)),
    onsetSpreadMs: Math.round(q(0.75) - q(0.25)),
  };
}

function exactMatch(score: Score, truth: Truth): boolean {
  const ticksPerBeat = TICKS_PER_QUARTER / (truth.beatUnit / 4);
  const beatSec = 60 / truth.bpm;
  const expected = truth.notes.map((n) => [n.midi, Math.round(((n.endSec - n.startSec) / beatSec) * ticksPerBeat)]);
  const ours = score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace').map((n) => [n.midi, n.durTicks]);
  return JSON.stringify(expected) === JSON.stringify(ours);
}

export type Judged = Truth & { windowSec?: [number, number]; skipSec?: readonly [number, number][] };

export function measure(candidate: Candidate, truth: Judged): Metrics {
  const window = truth.windowSec ?? [0, truth.durationSec];
  const { frames, at } = frameGrid(window);
  const skip = new Uint8Array(frames);
  for (const [from, to] of truth.skipSec ?? []) for (let f = Math.max(0, at(from)); f < Math.min(frames, at(to)); f++) skip[f] = 1;
  const ref = paint(frames, at, truth.notes);
  const spans = scoreSpans(candidate.score, candidate.timing);
  const out = paint(frames, at, spans);
  const line = paint(
    frames,
    at,
    candidate.line.map((n) => ({ midi: n.midi, startSec: n.onsetSec, endSec: n.onsetSec + n.durSec })),
  );
  const scoreLevel = compare(ref, out, skip);
  const lineLevel = compare(ref, line, skip);

  const intrusions: Intrusions = { other: 0, octave: 0, rest: 0 };
  for (const s of spans) {
    const from = Math.max(0, at(s.startSec));
    const to = Math.min(frames, at(s.endSec));
    if (to <= from || skip[from] || skip[to - 1]) continue;
    const tally = { exact: 0, other: 0, octave: 0, rest: 0 };
    for (let f = from; f < to; f++) {
      const r = ref[f]!;
      if (r < 0) tally.rest++;
      else if (r === s.midi) tally.exact++;
      else if ((r - s.midi) % 12 === 0) tally.octave++;
      else tally.other++;
    }
    const worst = (['other', 'octave', 'rest'] as const).reduce((a, b) => (tally[b] > tally[a] ? b : a));
    if (tally[worst] > tally.exact) intrusions[worst]++;
  }

  const onsets = spans.map((s) => s.startSec);
  const refOnsets = truth.notes.filter((n) => n.startSec >= window[0] && n.startSec < window[1] && !skip[at(n.startSec)]);
  const hit = refOnsets.filter((n) => onsets.some((o) => Math.abs(o - n.startSec) <= ONSET_TOLERANCE_SEC)).length;
  const truthQuarterBpm = truth.bpm * (truth.beatUnit === 8 ? 0.5 : 1);

  return {
    ...scoreLevel,
    headline: fBeta(scoreLevel.precision, scoreLevel.recall),
    intrusions,
    linePrecision: lineLevel.precision,
    lineRecall: lineLevel.recall,
    onsetHit: ratio(hit, refOnsets.length),
    tempoRatio: Math.round((1000 * candidate.score.bpm) / truthQuarterBpm) / 1000,
    ...readability(candidate.score),
    rhythm: rhythm(candidate.score, candidate.timing, truth, refOnsets),
    exact: exactMatch(candidate.score, truth),
  };
}

const DIATONIC = [0, 2, 4, 5, 7, 9, 11];

export function plausibility(score: Score) {
  const tonic = (((score.keyFifths * 7) % 12) + 12) % 12;
  const inKey = (n: QuantizedNote) => DIATONIC.includes((((n.midi! - tonic) % 12) + 12) % 12);
  const sounding = score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace');
  const ticks = sounding.reduce((s, n) => s + n.durTicks, 0);
  let leaps = 0;
  sounding.forEach((n, i) => {
    const prev = sounding[i - 1];
    if (prev && Math.abs(n.midi! - prev.midi!) >= 12) leaps++;
  });
  return {
    outOfKey: ratio(
      sounding.filter((n) => !inKey(n)).reduce((s, n) => s + n.durTicks, 0),
      ticks,
    ),
    octaveLeaps: leaps,
    bpm: score.bpm,
    keyFifths: score.keyFifths,
    ...readability(score),
  };
}
