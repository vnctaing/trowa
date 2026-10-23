import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { measure, type Metrics } from './metric';
import { narutoTruth } from './naruto';
import { realSets } from './real';
import { APPROACHES, candidate } from './run';
import { BENCH_DIR, fixtureName, SONGS, VARIANTS, type Truth } from './synth';

type Row = { set: string; name: string; m: Metrics };

const f = (x: number) => x.toFixed(3);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function row(label: string, m: Metrics): string {
  const r = m.rhythm;
  return `| ${label} | ${f(m.headline)} | ${f(m.onsetHit)} | ${m.notesPerBar.median}/${m.notesPerBar.max} | ${f(r.refOffBeat)} | ${f(m.offBeat)} | ${f(m.tiedOverBeat)} | ${f(r.spuriousOffBeat)} | ${f(r.missedOffBeat)} | ${r.onsetBiasMs} | ${r.onsetSpreadMs} | ${r.matched} |`;
}

const HEADER =
  '| set | F0.5 | onset hit | notes/bar | ref off-beat | ours off-beat | ours tied over beat | spurious off (ref on, ours off) | missed off (ref off, ours on) | onset bias ms | onset IQR ms | matched |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

async function main() {
  const { values } = parseArgs({ options: { approach: { type: 'string', default: 'tracker' }, out: { type: 'string' } } });
  const approach = APPROACHES[values.approach];
  if (!approach) throw new Error(`unknown approach ${values.approach}`);
  const rows: Row[] = [];
  const synthNames = [...SONGS.map((s) => s.name), 'twinkle'];
  for (const song of synthNames) {
    for (const variant of VARIANTS) {
      const name =
        song === 'twinkle' ? (variant === 'solo' ? 'twinkle-solo' : variant === 'band' ? 'twinkle-bass' : null) : fixtureName(song, variant);
      if (name === null) continue;
      const truth: Truth = JSON.parse(readFileSync(join(BENCH_DIR, `${name}.truth.json`), 'utf8'));
      rows.push({ set: `synth ${variant}`, name, m: measure(candidate(name, approach), truth) });
    }
  }
  const naruto = narutoTruth();
  rows.push({ set: 'naruto', name: 'naruto-filter', m: measure(candidate('naruto-filter', approach), naruto) });
  for (const { entry, name, truth, window, alignedEnd } of await realSets()) {
    const c = candidate(name, approach);
    rows.push({ set: `real tier ${entry.tier}`, name: `${entry.slug} (whole)`, m: measure(c, { ...truth, windowSec: window }) });
    if (alignedEnd > window[0]) {
      rows.push({ set: `real tier ${entry.tier}`, name: `${entry.slug} (aligned opening)`, m: measure(c, { ...truth, windowSec: [window[0], alignedEnd] }) });
    }
  }

  const lines: string[] = [`## ${values.approach}`, '', HEADER, ...rows.map((r) => row(r.name, r.m)), ''];
  const sets = [...new Set(rows.map((r) => r.set))];
  lines.push('| set | n | F0.5 | onset hit | ref off-beat | ours off-beat | ours tied over beat | spurious off | missed off | onset bias ms |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const set of sets) {
    const ms = rows.filter((r) => r.set === set).map((r) => r.m);
    const avg = (pick: (m: Metrics) => number) => f(mean(ms.map(pick)));
    lines.push(
      `| ${set} | ${ms.length} | ${avg((m) => m.headline)} | ${avg((m) => m.onsetHit)} | ${avg((m) => m.rhythm.refOffBeat)} | ${avg((m) => m.offBeat)} | ${avg((m) => m.tiedOverBeat)} | ${avg((m) => m.rhythm.spuriousOffBeat)} | ${avg((m) => m.rhythm.missedOffBeat)} | ${Math.round(mean(ms.map((m) => m.rhythm.onsetBiasMs)))} |`,
    );
  }
  const text = `${lines.join('\n')}\n`;
  console.log(text);
  if (values.out) {
    mkdirSync(join(values.out, '..'), { recursive: true });
    writeFileSync(values.out, text);
    writeFileSync(values.out.replace(/\.md$/, '.json'), JSON.stringify(rows, null, 1));
  }
}

await main();
