import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import midiPackage from '@tonejs/midi';
import { leadEmphasis } from '../../src/pipeline/separate';
import { frameToSec, LOWEST_MIDI, NOTE_BINS } from '../../src/pipeline/track';
import { decodeWav } from '../../src/pipeline/wav';
import { computeActivations, hasActivations, loadActivations, loadModel, saveActivations, type Activations } from './activations';
import { fBeta, measure, type Metrics } from './metric';
import { APPROACHES, candidate } from './run';
import type { Truth, TruthNote } from './synth';

const REAL_DIR = '.cache/real';
const MANIFEST = 'scripts/bench/real/manifest.json';
const SCORE_STEP_SEC = 0.03;
const AUDIO_STRIDE = 3;
const OFF_DIAGONAL_PENALTY = 0.1;
const REST_COST = 0.5;
const PC_LOW = 48;
const PC_HIGH = 96;
const FIT_ACTIVATION = 0.3;
const FIT_WINDOW_SEC = 15;
const ALIGNED_FIT = 0.5;

type Entry = {
  slug: string;
  tier: 1 | 2 | 3;
  title: string;
  composer: string;
  melodyPart: string;
  audio: { url: string; license: string; performer?: string; file: string };
  score: { url: string; license: string; file: string; format: string; track?: number | string; transpose?: number };
};

type Aligned = Truth & { fit: number; fitProfile: number[]; pathCost: number; slug: string };

function melodyFromMidi(entry: Entry): TruthNote[] {
  const { Midi } = midiPackage as typeof import('@tonejs/midi');
  const midi = new Midi(readFileSync(join(REAL_DIR, entry.slug, entry.score.file)));
  const wanted = entry.score.track ?? 0;
  const track =
    typeof wanted === 'number'
      ? midi.tracks[wanted]
      : midi.tracks.find(
          (t) => t.name.toLowerCase().includes(wanted.toLowerCase()) || t.instrument.name.toLowerCase().includes(wanted.toLowerCase()),
        );
  if (!track) throw new Error(`${entry.slug}: no track ${String(wanted)} in ${midi.tracks.map((t, i) => `${i}:${t.name}`).join(', ')}`);
  const notes = [...track.notes].sort((a, b) => a.time - b.time || b.midi - a.midi);
  const transpose = entry.score.transpose ?? 0;
  const end = Math.max(...notes.map((n) => n.time + n.duration));
  const steps = Math.ceil(end / SCORE_STEP_SEC) + 1;
  const top = new Int32Array(steps).fill(-1);
  notes.forEach((n, i) => {
    for (let s = Math.round(n.time / SCORE_STEP_SEC); s < Math.round((n.time + n.duration) / SCORE_STEP_SEC); s++) {
      const current = top[s]!;
      if (current < 0 || notes[current]!.midi < n.midi) top[s] = i;
    }
  });
  const out: TruthNote[] = [];
  let start = 0;
  for (let s = 1; s <= steps; s++) {
    if (s < steps && top[s] === top[start]) continue;
    const i = top[start]!;
    if (i >= 0) out.push({ midi: notes[i]!.midi + transpose, startSec: start * SCORE_STEP_SEC, endSec: s * SCORE_STEP_SEC });
    start = s;
  }
  return out;
}

function pitchClassRoll(a: Activations): { roll: Float32Array; steps: number } {
  const steps = Math.ceil(a.frameCount / AUDIO_STRIDE);
  const roll = new Float32Array(steps * 12);
  for (let j = 0; j < steps; j++) {
    for (let k = 0; k < AUDIO_STRIDE; k++) {
      const t = j * AUDIO_STRIDE + k;
      if (t >= a.frameCount) break;
      const row = a.frames.subarray(t * NOTE_BINS, (t + 1) * NOTE_BINS);
      for (let m = PC_LOW; m <= PC_HIGH; m++) {
        const v = row[m - LOWEST_MIDI]!;
        const at = j * 12 + (m % 12);
        if (v > roll[at]!) roll[at] = v;
      }
    }
  }
  return { roll, steps };
}

function align(melody: TruthNote[], a: Activations): { toSec: (midiSec: number) => number; pathCost: number } {
  const end = Math.max(...melody.map((n) => n.endSec));
  const scoreSteps = Math.ceil(end / SCORE_STEP_SEC) + 1;
  const refPc = new Int8Array(scoreSteps).fill(-1);
  for (const n of melody) {
    for (let s = Math.round(n.startSec / SCORE_STEP_SEC); s < Math.round(n.endSec / SCORE_STEP_SEC); s++) refPc[s] = n.midi % 12;
  }
  const { roll, steps: audioSteps } = pitchClassRoll(a);
  const cost = (i: number, j: number) => (refPc[i]! < 0 ? REST_COST : 1 - roll[j * 12 + refPc[i]!]!);

  const acc = new Float32Array(scoreSteps * audioSteps).fill(Infinity);
  const from = new Uint8Array(scoreSteps * audioSteps);
  acc[0] = cost(0, 0);
  for (let i = 0; i < scoreSteps; i++) {
    for (let j = 0; j < audioSteps; j++) {
      if (i === 0 && j === 0) continue;
      const c = cost(i, j);
      let best = Infinity;
      let via = 0;
      if (i > 0 && j > 0 && acc[(i - 1) * audioSteps + j - 1]! + c < best) {
        best = acc[(i - 1) * audioSteps + j - 1]! + c;
        via = 0;
      }
      if (i > 0 && acc[(i - 1) * audioSteps + j]! + c + OFF_DIAGONAL_PENALTY < best) {
        best = acc[(i - 1) * audioSteps + j]! + c + OFF_DIAGONAL_PENALTY;
        via = 1;
      }
      if (j > 0 && acc[i * audioSteps + j - 1]! + c + OFF_DIAGONAL_PENALTY < best) {
        best = acc[i * audioSteps + j - 1]! + c + OFF_DIAGONAL_PENALTY;
        via = 2;
      }
      acc[i * audioSteps + j] = best;
      from[i * audioSteps + j] = via;
    }
  }

  let j = 0;
  for (let k = 1; k < audioSteps; k++) if (acc[(scoreSteps - 1) * audioSteps + k]! < acc[(scoreSteps - 1) * audioSteps + j]!) j = k;
  const pathCost = acc[(scoreSteps - 1) * audioSteps + j]! / (scoreSteps + j);
  const audioOf = new Float32Array(scoreSteps).fill(-1);
  let i = scoreSteps - 1;
  while (i > 0 || j > 0) {
    if (audioOf[i]! < 0) audioOf[i] = j;
    const via = from[i * audioSteps + j]!;
    if (via === 0) {
      i--;
      j--;
    } else if (via === 1) i--;
    else j--;
  }
  audioOf[0] = 0;
  return {
    toSec: (midiSec) => frameToSec(audioOf[Math.min(scoreSteps - 1, Math.round(midiSec / SCORE_STEP_SEC))]! * AUDIO_STRIDE),
    pathCost: Math.round(pathCost * 1000) / 1000,
  };
}

function fitProfile(truth: Truth, a: Activations): number[] {
  const { roll } = pitchClassRoll(a);
  const hit: number[] = [];
  const total: number[] = [];
  for (const n of truth.notes) {
    for (let t = Math.round(n.startSec / frameToSec(1)); t * frameToSec(1) < n.endSec; t++) {
      const k = Math.floor(frameToSec(t) / FIT_WINDOW_SEC);
      total[k] = (total[k] ?? 0) + 1;
      if ((roll[Math.floor(t / AUDIO_STRIDE) * 12 + (n.midi % 12)] ?? 0) >= FIT_ACTIVATION) hit[k] = (hit[k] ?? 0) + 1;
    }
  }
  return total.map((n, k) => Math.round((1000 * (hit[k] ?? 0)) / n) / 1000);
}

function fitOf(profile: number[], truth: Truth): number {
  const weights = profile.map((_, k) => truth.notes.filter((n) => Math.floor(n.startSec / FIT_WINDOW_SEC) === k).length);
  const total = weights.reduce((s, w) => s + w, 0);
  return total === 0 ? 0 : Math.round((1000 * profile.reduce((s, f, k) => s + f * weights[k]!, 0)) / total) / 1000;
}

function alignedThroughSec(profile: number[], from: number): number {
  let k = Math.floor(from / FIT_WINDOW_SEC);
  while (k < profile.length && (profile[k] ?? 0) >= ALIGNED_FIT) k++;
  return k * FIT_WINDOW_SEC;
}

async function ensureActivations(entry: Entry): Promise<Activations> {
  const name = `real-${entry.slug}`;
  if (!hasActivations(name)) {
    const pcm = decodeWav(readFileSync(join(REAL_DIR, entry.slug, 'mix.wav')));
    if (!pcm || pcm.sampleRate !== 22050) throw new Error(`${entry.slug}: mix.wav must be 22050 Hz`);
    const started = performance.now();
    saveActivations(name, await computeActivations(leadEmphasis(pcm), loadModel()));
    console.error(`${name}: activations in ${((performance.now() - started) / 1000).toFixed(0)} s`);
  }
  return loadActivations(name);
}

async function truthFor(entry: Entry, a: Activations, refit: boolean): Promise<Aligned> {
  const path = join(REAL_DIR, entry.slug, 'truth.json');
  if (existsSync(path) && !refit) return JSON.parse(readFileSync(path, 'utf8'));
  const melody = melodyFromMidi(entry);
  const { toSec, pathCost } = align(melody, a);
  const notes = melody
    .map((n) => ({ midi: n.midi, startSec: toSec(n.startSec), endSec: toSec(n.endSec) }))
    .filter((n) => n.endSec > n.startSec);
  const truth: Aligned = {
    slug: entry.slug,
    bpm: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    notes,
    durationSec: a.durationSec,
    pathCost,
    fit: 0,
    fitProfile: [],
  };
  truth.fitProfile = fitProfile(truth, a);
  truth.fit = fitOf(truth.fitProfile, truth);
  writeFileSync(path, JSON.stringify(truth));
  return truth;
}

const f = (x: number) => x.toFixed(3);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

async function main() {
  const { values } = parseArgs({
    options: { refit: { type: 'boolean', default: false }, out: { type: 'string' }, only: { type: 'string' } },
  });
  const entries: Entry[] = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const lines: string[] = [];
  const say = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  const byTier: Record<string, Record<number, Metrics[]>> = {};
  const byTierOpening: Record<string, Record<number, Metrics[]>> = {};
  say(
    '| tier | track | approach | F0.5 | precision | recall | recall pc | wrong | octave | in rest | onset hit | notes/bar | align fit | align cost | aligned opening: F0.5 P/R |',
  );
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const entry of entries.filter((e) => !values.only || e.slug === values.only)) {
    const a = await ensureActivations(entry);
    const truth = await truthFor(entry, a, values.refit);
    const window: [number, number] = [truth.notes[0]!.startSec, truth.notes.at(-1)!.endSec];
    const alignedEnd = Math.min(window[1], alignedThroughSec(truth.fitProfile, window[0]));
    for (const approach of Object.values(APPROACHES)) {
      const c = candidate(`real-${entry.slug}`, approach);
      const m = measure(c, { ...truth, windowSec: window });
      const opening = alignedEnd > window[0] ? measure(c, { ...truth, windowSec: [window[0], alignedEnd] }) : null;
      byTier[approach.name] ??= {};
      (byTier[approach.name]![entry.tier] ??= []).push(m);
      if (opening) (byTierOpening[approach.name] ??= {})[entry.tier] = [...(byTierOpening[approach.name]![entry.tier] ?? []), opening];
      say(
        `| ${entry.tier} | ${entry.slug} | ${approach.name} | ${f(m.headline)} | ${f(m.precision)} | ${f(m.recall)} | ${f(m.recallPc)} | ${f(m.wrongNote)} | ${f(m.octave)} | ${f(m.restIntrusion)} | ${f(m.onsetHit)} | ${m.notesPerBar.median}/${m.notesPerBar.max} | ${f(truth.fit)} | ${f(truth.pathCost)} | ${opening ? `${Math.round(alignedEnd - window[0])} s: ${f(opening.headline)} ${f(opening.precision)}/${f(opening.recall)}` : 'none'} |`,
      );
    }
  }
  say('');
  for (const [label, groups] of [
    ['whole track', byTier],
    ['aligned opening', byTierOpening],
  ] as const) {
    for (const [approach, tiers] of Object.entries(groups)) {
      for (const [tier, ms] of Object.entries(tiers)) {
        const p = mean(ms.map((m) => m.precision));
        const r = mean(ms.map((m) => m.recall));
        say(
          `${label}, tier ${tier}, ${approach} (${ms.length}): F0.5 ${f(fBeta(p, r))} precision ${f(p)} recall ${f(r)} wrong ${f(mean(ms.map((m) => m.wrongNote)))} octave ${f(mean(ms.map((m) => m.octave)))} in-rest ${f(mean(ms.map((m) => m.restIntrusion)))}`,
        );
      }
    }
  }
  if (values.out) {
    mkdirSync(join(values.out, '..'), { recursive: true });
    writeFileSync(values.out, `${lines.join('\n')}\n`);
  }
}

await main();
