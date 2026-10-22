import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as tf from '@tensorflow/tfjs';
import { TrowaError, type Options, type QuantizedNote } from '../src/domain';
import { toMusicXml } from '../src/pipeline/musicxml';
import { detectNotes, PITCH_SAMPLE_RATE } from '../src/pipeline/pitch';
import { buildScore } from '../src/pipeline/score';
import { separateLead } from '../src/pipeline/separate';
import { decodeWav } from '../src/pipeline/wav';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string', default: 'http://localhost:5173' },
    out: { type: 'string' },
    title: { type: 'string' },
    transpose: { type: 'string', default: '0' },
    difficulty: { type: 'string', default: 'melody' },
  },
});
const input = positionals[0];
if (!input) {
  console.error('usage: npx tsx scripts/transcribe.ts <audio file> [--server URL] [--out score.musicxml]');
  process.exit(2);
}

function loadModel(): Promise<tf.GraphModel> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/@spotify/basic-pitch/model');
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

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (n: QuantizedNote) =>
  n.midi === null ? 'rest' : `${NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1}${n.ornament === 'grace' ? '(grace)' : ''}`;

const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;

const wav = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', input, '-ac', '1', '-ar', String(PITCH_SAMPLE_RATE), '-f', 'wav', '-'], {
  maxBuffer: 1 << 30,
});
const mix = decodeWav(wav);
if (!mix) throw new Error('ffmpeg did not produce a readable WAV');
console.log(`input       ${input} (${(mix.samples.length / mix.sampleRate).toFixed(2)} s, ${mix.sampleRate} Hz mono)`);

const lead = await separateLead(mix, { endpoint: `${values.server}/api/separate` });
console.log(`separation  ${lead.method} [${elapsed()}]`);

const detection = await detectNotes(loadModel(), lead.samples, () => {});
console.log(
  `detected    ${detection.notes.length} raw notes, voiced frames ${(detection.voicedFraction * 100).toFixed(1)}% [${elapsed()}]`,
);

const options: Options = {
  transpose: Number(values.transpose),
  key: 'auto',
  difficulty: values.difficulty === 'ornaments' ? 'ornaments' : 'melody',
  tempoOverride: null,
};
try {
  const score = buildScore(detection, options, { title: values.title ?? basename(input), source: basename(input) });
  const xml = toMusicXml(score);
  const sounding = score.notes.filter((n) => n.midi !== null);
  console.log(
    `score       bpm ${score.bpm}, time ${score.beatsPerBar}/${score.beatUnit}, keyFifths ${score.keyFifths}, confidence ${score.confidence}`,
  );
  console.log(`            ${sounding.length} notes, ${score.notes.length - sounding.length} rests, ${(xml.match(/<measure /g) ?? []).length} measures`);
  const ticksPerBar = score.beatsPerBar * (score.beatUnit === 4 ? 4 : 2);
  const bars = new Map<number, string[]>();
  for (const n of score.notes) {
    const bar = Math.floor(n.startTick / ticksPerBar);
    bars.set(bar, [...(bars.get(bar) ?? []), `${name(n)}/${n.durTicks}`]);
  }
  for (const [bar, notes] of [...bars].slice(0, 16)) console.log(`  bar ${String(bar + 1).padStart(3)}  ${notes.join(' ')}`);
  if (bars.size > 16) console.log(`  ... ${bars.size - 16} more bars`);
  if (values.out) {
    writeFileSync(values.out, xml);
    console.log(`musicxml    wrote ${values.out} (${xml.length} bytes)`);
  }
} catch (err) {
  if (!(err instanceof TrowaError)) throw err;
  console.log(`result      TrowaError('${err.kind}')`);
}
console.log(`done [${elapsed()}]`);
