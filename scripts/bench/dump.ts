import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { leadEmphasis } from '../../src/pipeline/separate';
import { decodeWav } from '../../src/pipeline/wav';
import { computeActivations, hasActivations, loadModel, saveActivations } from './activations';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { filter: { type: 'boolean', default: false }, force: { type: 'boolean', default: false } },
});
const [name, wavPath] = positionals;
if (!name || !wavPath) {
  console.error('usage: npx tsx scripts/bench/dump.ts <name> <22050Hz mono wav> [--filter] [--force]');
  process.exit(2);
}
if (hasActivations(name) && !values.force) {
  console.log(`${name}: activations exist, pass --force to recompute`);
  process.exit(0);
}
const pcm = decodeWav(readFileSync(wavPath));
if (!pcm || pcm.sampleRate !== 22050) throw new Error(`${wavPath}: need a 22050 Hz WAV`);
const samples = values.filter ? leadEmphasis(pcm) : pcm.samples;
const started = performance.now();
const activations = await computeActivations(samples, loadModel());
saveActivations(name, activations);
console.log(
  `${name}: ${activations.frameCount} frames, ${activations.durationSec.toFixed(1)} s, ${((performance.now() - started) / 1000).toFixed(0)} s compute`,
);
