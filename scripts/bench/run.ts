import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { DetectedNote, Options } from '../../src/domain';
import { notate } from '../../src/pipeline/score';
import { trackLead } from '../../src/pipeline/track';
import { hasActivations, loadActivations, notesFromActivations, type Activations } from './activations';
import { reduceToLineBySalience } from './legacy-salience';
import { fBeta, measure, plausibility, type Candidate, type Judged, type Metrics } from './metric';
import { narutoTruth } from './naruto';
import { BENCH_DIR, fixtureName, SONGS, VARIANTS, type Truth, type Variant } from './synth';

export type Approach = { name: string; line: (a: Activations) => DetectedNote[] };

export const APPROACHES: Record<string, Approach> = {
  baseline: { name: 'baseline', line: (a) => reduceToLineBySalience(notesFromActivations(a), 0) },
  tracker: { name: 'tracker', line: (a) => trackLead(a) },
};

const OPTIONS: Options = { transpose: 0, key: 'auto', difficulty: 'melody', tempoOverride: null };

const cache = new Map<string, Activations>();
export function activations(name: string): Activations {
  let a = cache.get(name);
  if (!a) cache.set(name, (a = loadActivations(name)));
  return a;
}

export function candidate(activationName: string, approach: Approach): Candidate {
  const line = approach.line(activations(activationName));
  const notated = notate({ notes: [], line, voicedFraction: 1 }, OPTIONS, { title: activationName, source: activationName });
  return { line: notated.line, score: notated.score, timing: notated.timing };
}

const loadTruth = (name: string) => JSON.parse(readFileSync(join(BENCH_DIR, `${name}.truth.json`), 'utf8')) as Truth;

const mean = (xs: number[]) => (xs.length === 0 ? 0 : Math.round((1000 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 1000);
const fmt = (x: number) => x.toFixed(3);

function row(label: string, m: Metrics): string {
  const intr = `${m.intrusions.other}/${m.intrusions.octave}/${m.intrusions.rest}`;
  return `| ${label} | ${fmt(m.headline)} | ${fmt(m.precision)} | ${fmt(m.recall)} | ${fmt(m.recallPc)} | ${fmt(m.wrongNote)} | ${fmt(m.octave)} | ${fmt(m.restIntrusion)} | ${intr} | ${fmt(m.onsetHit)} | ${m.tempoRatio} | ${m.notesPerBar.median}/${m.notesPerBar.max} | ${fmt(m.sixteenthShare)} | ${m.exact ? 'yes' : ''} |`;
}

const HEADER =
  '| fixture | headline F0.5 | precision | recall | recall pc | wrong | octave | in rest | intrusions o/8/r | onset hit | tempo | notes/bar | 16ths | exact |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

if (process.argv[1]?.endsWith('run.ts')) main();

function main() {
  const { values } = parseArgs({
    options: {
      approach: { type: 'string', default: 'tracker' },
      set: { type: 'string', default: 'all' },
      out: { type: 'string' },
      label: { type: 'string' },
    },
  });

  const approach = APPROACHES[values.approach];
  if (!approach) throw new Error(`unknown approach ${values.approach}; known: ${Object.keys(APPROACHES).join(', ')}`);

  const lines: string[] = [];
  const results: Record<string, Metrics | ReturnType<typeof plausibility>> = {};
  const say = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  say(`## ${values.label ?? approach.name}\n`);

  if (values.set === 'all' || values.set === 'synth') {
    say(HEADER);
    const byVariant: Record<Variant, Metrics[]> = { solo: [], band: [], under: [] };
    const synthNames = [...SONGS.map((s) => s.name), 'twinkle'];
    for (const song of synthNames) {
      for (const variant of VARIANTS) {
        const name =
          song === 'twinkle'
            ? variant === 'solo'
              ? 'twinkle-solo'
              : variant === 'band'
                ? 'twinkle-bass'
                : null
            : fixtureName(song, variant);
        if (name === null || !hasActivations(name) || !existsSync(join(BENCH_DIR, `${name}.truth.json`))) continue;
        try {
          const m = measure(candidate(name, approach), loadTruth(name));
          results[name] = m;
          byVariant[variant].push(m);
          say(row(name, m));
        } catch (err) {
          say(`| ${name} | error: ${String(err).split('\n')[0]} |`);
        }
      }
    }
    say('');
    for (const variant of VARIANTS) {
      const ms = byVariant[variant];
      if (ms.length === 0) continue;
      const p = mean(ms.map((m) => m.precision));
      const r = mean(ms.map((m) => m.recall));
      say(
        `synth ${variant} (${ms.length}): headline ${fmt(fBeta(p, r))} precision ${fmt(p)} recall ${fmt(r)} wrong ${fmt(mean(ms.map((m) => m.wrongNote)))} octave ${fmt(mean(ms.map((m) => m.octave)))} in-rest ${fmt(mean(ms.map((m) => m.restIntrusion)))} onset-hit ${fmt(mean(ms.map((m) => m.onsetHit)))} exact ${ms.filter((m) => m.exact).length}/${ms.length}`,
      );
    }
    say('');
  }

  if (values.set === 'all' || values.set === 'naruto') {
    const truth = narutoTruth();
    const sure: Judged = { ...truth, skipSec: truth.unsureSec };
    say(HEADER);
    for (const name of ['naruto-filter', 'naruto-other', 'naruto-mix']) {
      if (!hasActivations(name)) continue;
      try {
        const m = measure(candidate(name, approach), truth);
        results[name] = m;
        say(row(name, m));
        const c = measure(candidate(name, approach), sure);
        say(row(`${name} (sure+approx bars)`, c));
      } catch (err) {
        say(`| ${name} | error: ${String(err).split('\n')[0]} |`);
      }
    }
    say('');
  }

  if (values.set === 'all' || values.set === 'rick') {
    if (hasActivations('rick-vocals')) {
      const p = plausibility(candidate('rick-vocals', approach).score);
      results['rick-vocals'] = p;
      say(
        `rick-vocals: notes ${p.notes} out-of-key ${fmt(p.outOfKey)} octave leaps ${p.octaveLeaps} notes/bar ${p.notesPerBar.median}/${p.notesPerBar.max} 16ths ${fmt(p.sixteenthShare)} bpm ${p.bpm} keyFifths ${p.keyFifths}`,
      );
    }
  }

  if (values.out) {
    mkdirSync(join(values.out, '..'), { recursive: true });
    writeFileSync(values.out, JSON.stringify({ approach: approach.name, results }, null, 1));
    writeFileSync(values.out.replace(/\.json$/, '.md'), `${lines.join('\n')}\n`);
  }
}
