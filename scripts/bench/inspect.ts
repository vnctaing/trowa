import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { tickToSecMap } from './metric';
import { narutoTruth } from './naruto';
import { APPROACHES, candidate } from './run';
import { BENCH_DIR, type Truth } from './synth';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (midi: number) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    approach: { type: 'string', default: 'tracker' },
    from: { type: 'string', default: '0' },
    to: { type: 'string', default: '20' },
  },
});
const [name] = positionals;
if (!name) throw new Error('usage: inspect.ts <activation name> [--approach x] [--from sec] [--to sec]');
const truth: Truth = name.startsWith('naruto') ? narutoTruth() : JSON.parse(readFileSync(join(BENCH_DIR, `${name}.truth.json`), 'utf8'));
const approach = APPROACHES[values.approach]!;
const { line, score, timing } = candidate(name, approach);
const toSec = tickToSecMap(timing, score.bpm);
const from = Number(values.from);
const to = Number(values.to);
const span = (s: number, e: number) => `${s.toFixed(2)}-${e.toFixed(2)}`;

console.log(`truth (${truth.bpm} bpm)`);
for (const n of truth.notes) if (n.endSec > from && n.startSec < to) console.log(`  ${span(n.startSec, n.endSec)} ${nameOf(n.midi)}`);
console.log(`line`);
for (const n of line)
  if (n.onsetSec + n.durSec > from && n.onsetSec < to)
    console.log(`  ${span(n.onsetSec, n.onsetSec + n.durSec)} ${nameOf(n.midi)} amp ${n.amplitude.toFixed(2)} onset ${n.onset.toFixed(2)}`);
console.log(`score (${score.bpm} bpm, ${score.beatsPerBar}/${score.beatUnit})`);
for (const n of score.notes) {
  if (n.ornament === 'grace') continue;
  const s = toSec(n.startTick);
  const e = toSec(n.startTick + n.durTicks);
  if (e > from && s < to) console.log(`  ${span(s, e)} ${n.midi === null ? 'rest' : nameOf(n.midi)} tick ${n.startTick}+${n.durTicks}`);
}
