import { readFileSync } from 'node:fs';
import { DOMParser, type Element } from '@xmldom/xmldom';
import { decodeWav } from '../src/pipeline/wav';

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FRAME = 2048;
const THRESHOLD = 0.15;

type Expected = { midi: number; startSec: number; durSec: number };

const [wavPath, xmlPath] = process.argv.slice(2);
if (!wavPath || !xmlPath) {
  console.error('usage: npx tsx scripts/player-pitch-check.ts <rendered.wav> <score.musicxml>');
  process.exit(2);
}

function child(node: Element, name: string): Element | null {
  return node.getElementsByTagName(name)[0] ?? null;
}

function expectedNotes(xml: string): Expected[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const divisions = Number(doc.getElementsByTagName('divisions')[0]?.textContent);
  const tempo = Number(doc.getElementsByTagName('sound')[0]?.getAttribute('tempo'));
  const secPerDivision = 60 / tempo / divisions;
  const notes: Expected[] = [];
  let at = 0;
  for (const note of Array.from(doc.getElementsByTagName('note'))) {
    if (child(note, 'grace')) continue;
    const dur = Number(child(note, 'duration')?.textContent) * secPerDivision;
    const pitch = child(note, 'pitch');
    const tiedFromPrevious = Array.from(note.getElementsByTagName('tie')).some((t) => t.getAttribute('type') === 'stop');
    if (pitch) {
      const midi =
        (Number(child(pitch, 'octave')?.textContent) + 1) * 12 +
        (STEP_SEMITONES[child(pitch, 'step')?.textContent ?? 'C'] ?? 0) +
        Number(child(pitch, 'alter')?.textContent ?? 0);
      const last = notes[notes.length - 1];
      if (tiedFromPrevious && last) last.durSec += dur;
      else notes.push({ midi, startSec: at, durSec: dur });
    }
    at += dur;
  }
  return notes;
}

function detectMidi(samples: Float32Array, sampleRate: number, centerSec: number): number | null {
  const start = Math.max(0, Math.round(centerSec * sampleRate) - FRAME / 2);
  const frame = samples.subarray(start, start + FRAME);
  if (frame.length < FRAME) return null;
  const maxLag = Math.floor(sampleRate / 200);
  const diff = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < FRAME - maxLag; i++) {
      const d = frame[i]! - frame[i + lag]!;
      sum += d * d;
    }
    diff[lag] = sum;
  }
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += diff[lag]!;
    diff[lag] = (diff[lag]! * lag) / (running || 1);
  }
  let best = 3;
  while (best < maxLag && diff[best]! >= THRESHOLD) best++;
  if (best >= maxLag) return null;
  while (best < maxLag - 1 && diff[best + 1]! < diff[best]!) best++;
  const [a, b, c] = [diff[best - 1]!, diff[best]!, diff[best + 1]!];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const hz = sampleRate / (best + shift);
  return 69 + 12 * Math.log2(hz / 440);
}

const pcm = decodeWav(readFileSync(wavPath));
if (!pcm) throw new Error(`${wavPath} is not a PCM WAV`);
const notes = expectedNotes(readFileSync(xmlPath, 'utf8'));
let matched = 0;
const rows = notes.map((n, i) => {
  const detected = detectMidi(pcm.samples, pcm.sampleRate, n.startSec + Math.min(n.durSec / 2, 0.2));
  const ok = detected !== null && Math.round(detected) === n.midi;
  if (ok) matched++;
  return `${String(i + 1).padStart(3)}  ${n.startSec.toFixed(2).padStart(6)}s  expected ${n.midi}  detected ${detected === null ? '  -  ' : detected.toFixed(2)}  ${ok ? 'ok' : 'MISS'}`;
});
console.log(`${wavPath}: ${pcm.samples.length / pcm.sampleRate}s at ${pcm.sampleRate} Hz`);
console.log(rows.join('\n'));
console.log(`${matched}/${notes.length} notes match the score pitch (${((matched / notes.length) * 100).toFixed(1)}%)`);
process.exit(matched === notes.length ? 0 : 1);
