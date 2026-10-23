import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav } from '../../src/pipeline/wav';

export const BENCH_DIR = '.cache/bench';
const RATE = 22050;
const LEAD_IN_SEC = 1;
const TAIL_SEC = 1.5;

export type TruthNote = { midi: number; startSec: number; endSec: number };
export type Truth = { bpm: number; beatsPerBar: number; beatUnit: number; notes: TruthNote[]; durationSec: number };

type Timbre = 'flute' | 'vocal';
type Triad = { root: number; minor: boolean };
type Song = {
  name: string;
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  timbre: Timbre;
  chords: Triad[];
  melody: string;
};

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midiOf = (name: string) =>
  12 * (Number(name.slice(-1)) + 1) + SEMITONE[name[0]!]! + (name.includes('#') ? 1 : name.includes('b') ? -1 : 0);
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const triad = (root: string, minor = false): Triad => ({ root: SEMITONE[root[0]!]! + (root.includes('#') ? 1 : 0), minor });

export const SONGS: readonly Song[] = [
  {
    name: 'ode',
    bpm: 108,
    beatsPerBar: 4,
    beatUnit: 4,
    timbre: 'flute',
    chords: [triad('D'), triad('G'), triad('A'), triad('B', true)],
    melody:
      'F#5:1 F#5:1 G5:1 A5:1 A5:1 G5:1 F#5:1 E5:1 D5:1 D5:1 E5:1 F#5:1 F#5:1.5 E5:0.5 E5:2 ' +
      'F#5:1 F#5:1 G5:1 A5:1 A5:1 G5:1 F#5:1 E5:1 D5:1 D5:1 E5:1 F#5:1 E5:1.5 D5:0.5 D5:2 ' +
      'E5:1 E5:1 F#5:1 D5:1 E5:1 F#5:0.5 G5:0.5 F#5:1 D5:1 E5:1 F#5:0.5 G5:0.5 F#5:1 E5:1 D5:1 E5:1 A4:2 ' +
      'F#5:1 F#5:1 G5:1 A5:1 A5:1 G5:1 F#5:1 E5:1 D5:1 D5:1 E5:1 F#5:1 E5:1.5 D5:0.5 D5:2',
  },
  {
    name: 'grace',
    bpm: 72,
    beatsPerBar: 3,
    beatUnit: 4,
    timbre: 'vocal',
    chords: [triad('G'), triad('C'), triad('D'), triad('E', true)],
    melody:
      'r:2 D4:1 G4:2 B4:0.5 G4:0.5 B4:2 A4:1 G4:2 E4:1 D4:2 D4:1 G4:2 B4:0.5 G4:0.5 B4:2 A4:1 D5:3 ' +
      'D5:2 B4:1 D5:1.5 B4:0.5 D5:0.5 B4:0.5 G4:2 D4:1 E4:2 G4:0.5 E4:0.5 D4:2 D4:1 G4:2 B4:0.5 G4:0.5 B4:2 A4:1 G4:3',
  },
  {
    name: 'greensleeves',
    bpm: 150,
    beatsPerBar: 6,
    beatUnit: 8,
    timbre: 'flute',
    chords: [triad('A', true), triad('G'), triad('F'), triad('E'), triad('C')],
    melody:
      'r:4 A4:2 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:3 ' +
      'A4:2 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:1.5 B4:0.5 A4:1 G#4:1.5 F#4:0.5 G#4:1 A4:3 A4:3 ' +
      'G5:3 G5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:3 ' +
      'G5:3 G5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:1.5 B4:0.5 A4:1 G#4:1.5 F#4:0.5 G#4:1 A4:3 A4:1',
  },
  {
    name: 'scarborough',
    bpm: 100,
    beatsPerBar: 3,
    beatUnit: 4,
    timbre: 'vocal',
    chords: [triad('D', true), triad('C'), triad('F'), triad('G'), triad('A', true)],
    melody:
      'D5:2 D5:1 A5:2 A5:1 E5:1.5 F5:0.5 E5:1 D5:3 A5:2 C6:1 D6:2 C6:1 A5:1 B5:1 G5:1 A5:3 ' +
      'D6:2 D6:1 D6:2 C6:1 A5:1 A5:1 A5:1 G5:1 F5:1 E5:1 D5:2 A5:1 G5:2 F5:1 E5:1 D5:1 C5:1 D5:3',
  },
  {
    name: 'frere',
    bpm: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    timbre: 'flute',
    chords: [triad('G'), triad('D')],
    melody:
      'G5:1 A5:1 B5:1 G5:1 G5:1 A5:1 B5:1 G5:1 B5:1 C6:1 D6:2 B5:1 C6:1 D6:2 ' +
      'D6:0.5 E6:0.5 D6:0.5 C6:0.5 B5:1 G5:1 D6:0.5 E6:0.5 D6:0.5 C6:0.5 B5:1 G5:1 G5:1 D5:1 G5:2 G5:1 D5:1 G5:2',
  },
  {
    name: 'birthday',
    bpm: 96,
    beatsPerBar: 3,
    beatUnit: 4,
    timbre: 'vocal',
    chords: [triad('C'), triad('F'), triad('G')],
    melody:
      'r:2 G4:0.75 G4:0.25 A4:1 G4:1 C5:1 B4:2 G4:0.75 G4:0.25 A4:1 G4:1 D5:1 C5:2 G4:0.75 G4:0.25 ' +
      'G5:1 E5:1 C5:1 B4:1 A4:1 F5:0.75 F5:0.25 E5:1 C5:1 D5:1 C5:2 r:1',
  },
  {
    name: 'auldlang',
    bpm: 84,
    beatsPerBar: 4,
    beatUnit: 4,
    timbre: 'flute',
    chords: [triad('G'), triad('C'), triad('D'), triad('E', true)],
    melody:
      'r:3 D4:1 G4:1.5 F#4:0.5 G4:1 B4:1 A4:1.5 G4:0.5 A4:1 B4:0.5 A4:0.5 G4:1.5 G4:0.5 B4:1 D5:1 E5:3 E5:1 ' +
      'D5:1.5 B4:0.5 B4:1 G4:1 A4:1.5 G4:0.5 A4:1 B4:0.5 A4:0.5 G4:1.5 E4:0.5 E4:1 D4:1 G4:3 r:1',
  },
  {
    name: 'saints',
    bpm: 132,
    beatsPerBar: 4,
    beatUnit: 4,
    timbre: 'vocal',
    chords: [triad('C'), triad('F'), triad('G')],
    melody:
      'r:1 C5:1 E5:1 F5:1 G5:4 C5:1 E5:1 F5:1 G5:4 C5:1 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2 D5:4 ' +
      'E5:1 E5:1 D5:1 C5:1.5 C5:0.5 E5:2 G5:1 G5:1 G5:0.5 F5:1.5 E5:1 F5:1 G5:2 E5:2 C5:2 D5:2 C5:2',
  },
];

const TWINKLE_BAR = 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2';
const TWINKLE = `${TWINKLE_BAR} G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 ${TWINKLE_BAR}`;

export function twinkleTruth(): Truth {
  const events = parseMelody(TWINKLE, 60 / 100);
  const last = events.at(-1)!;
  const notes = events.map((e) => ({ midi: e.midi!, startSec: e.startSec, endSec: e.startSec + e.durSec }));
  return { bpm: 100, beatsPerBar: 4, beatUnit: 4, notes, durationSec: last.startSec + last.durSec + 1 };
}

export type Variant = 'solo' | 'band' | 'under';
export const VARIANTS: readonly Variant[] = ['solo', 'band', 'under'];

type Event = { midi: number | null; startSec: number; durSec: number };

function parseMelody(melody: string, beatSec: number): Event[] {
  let t = LEAD_IN_SEC;
  return melody.split(/\s+/).map((token) => {
    const [pitch, beats] = token.split(':');
    const durSec = Number(beats) * beatSec;
    const event = { midi: pitch === 'r' ? null : midiOf(pitch!), startSec: t, durSec };
    t += durSec;
    return event;
  });
}

function seededNoise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

type Partials = readonly number[];
const FLUTE: Partials = [1, 0.3, 0.12, 0.05];
const VOCAL: Partials = [1, 0.8, 0.55, 0.4, 0.28, 0.18, 0.1];
const PIANO: Partials = [1, 0.5, 0.3, 0.2, 0.1];

function addTone(
  out: Float32Array,
  startSec: number,
  durSec: number,
  midi: number,
  gain: number,
  partials: Partials,
  shape: { attackSec: number; decaySec: number | null; vibratoHz: number; vibratoCents: number; breath?: () => number },
) {
  const f0 = hz(midi);
  const start = Math.round(startSec * RATE);
  const length = Math.round(durSec * RATE);
  let phase = 0;
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / RATE;
    const vibrato = 2 ** ((shape.vibratoCents / 1200) * Math.sin(2 * Math.PI * shape.vibratoHz * t) * Math.min(1, t / 0.3));
    phase += (2 * Math.PI * f0 * vibrato) / RATE;
    const release = Math.min(1, (durSec - t) / 0.03);
    const envelope = Math.min(1, t / shape.attackSec) * release * (shape.decaySec === null ? 1 : Math.exp(-t / shape.decaySec));
    let wave = 0;
    partials.forEach((a, k) => (wave += a * Math.sin(phase * (k + 1))));
    if (shape.breath) wave += 0.03 * shape.breath();
    out[start + i]! += gain * envelope * wave;
  }
}

function leadShape(timbre: Timbre, breath: () => number) {
  return timbre === 'flute'
    ? { attackSec: 0.03, decaySec: null, vibratoHz: 5.5, vibratoCents: 8, breath }
    : { attackSec: 0.06, decaySec: null, vibratoHz: 6, vibratoCents: 20 };
}

const PIANO_SHAPE = { attackSec: 0.005, decaySec: 0.7, vibratoHz: 0, vibratoCents: 0 };
const BASS_SHAPE = { attackSec: 0.01, decaySec: 0.5, vibratoHz: 0, vibratoCents: 0 };

function chordPitches(chord: Triad): number[] {
  return [0, chord.minor ? 3 : 4, 7].map((x) => (chord.root + x) % 12);
}

function chordForBar(song: Song, events: readonly Event[], barStart: number, barEnd: number): Triad {
  let best = { chord: song.chords[0]!, cover: -1 };
  for (const chord of song.chords) {
    const classes = chordPitches(chord);
    let cover = 0;
    for (const e of events) {
      if (e.midi === null) continue;
      const overlap = Math.min(barEnd, e.startSec + e.durSec) - Math.max(barStart, e.startSec);
      if (overlap > 0 && classes.includes(e.midi % 12)) cover += overlap;
    }
    if (cover > best.cover) best = { chord, cover };
  }
  return best.chord;
}

function addDrums(out: Float32Array, beatSec: number, fromSec: number, toSec: number) {
  const noise = seededNoise(7);
  const eighth = beatSec / 2;
  for (let step = 0; fromSec + step * eighth < toSec; step++) {
    const start = Math.round((fromSec + step * eighth) * RATE);
    const isKick = step % 4 === 0;
    const isSnare = step % 4 === 2;
    for (let i = 0; i < RATE * 0.25 && start + i < out.length; i++) {
      const t = i / RATE;
      let v = 0.12 * noise() * Math.exp(-t / 0.02);
      if (isKick) v += 0.7 * Math.sin(2 * Math.PI * (50 * t + 60 * 0.05 * (1 - Math.exp(-t / 0.05)))) * Math.exp(-t / 0.12);
      if (isSnare) v += 0.4 * noise() * Math.exp(-t / 0.08);
      out[start + i]! += v;
    }
  }
}

function reverb(dry: Float32Array): Float32Array {
  const combs = [558, 594, 638, 678].map((delay) => ({ delay, buffer: new Float32Array(delay), index: 0 }));
  const allpasses = [112, 278].map((delay) => ({ delay, buffer: new Float32Array(delay), index: 0 }));
  const out = new Float32Array(dry.length);
  for (let i = 0; i < dry.length; i++) {
    const x = dry[i]!;
    let wet = 0;
    for (const c of combs) {
      const y = c.buffer[c.index]!;
      c.buffer[c.index] = x + 0.78 * y;
      c.index = (c.index + 1) % c.delay;
      wet += y;
    }
    wet /= combs.length;
    for (const a of allpasses) {
      const buffered = a.buffer[a.index]!;
      const y = -wet + buffered;
      a.buffer[a.index] = wet + 0.5 * buffered;
      a.index = (a.index + 1) % a.delay;
      wet = y;
    }
    out[i] = x + 0.3 * wet;
  }
  return out;
}

function softLimit(samples: Float32Array): Float32Array {
  return samples.map((x) => Math.tanh(x));
}

export function renderSong(song: Song, variant: Variant): { samples: Float32Array; truth: Truth } {
  const beatSec = 60 / song.bpm / (song.beatUnit / 4);
  const events = parseMelody(song.melody, beatSec);
  const endSec = events.at(-1)!.startSec + events.at(-1)!.durSec;
  const durationSec = endSec + TAIL_SEC;
  const out = new Float32Array(Math.ceil(durationSec * RATE));
  const breath = seededNoise(3);
  for (const e of events) {
    if (e.midi === null) continue;
    const gap = song.timbre === 'flute' ? 0.06 : 0.02;
    addTone(out, e.startSec, e.durSec - gap, e.midi, 0.25, song.timbre === 'flute' ? FLUTE : VOCAL, leadShape(song.timbre, breath));
  }

  if (variant !== 'solo') {
    const barSec = beatSec * song.beatsPerBar;
    const leadOctave = Math.floor(
      events.filter((e) => e.midi !== null).reduce((s, e) => s + e.midi! * e.durSec, 0) /
        events.filter((e) => e.midi !== null).reduce((s, e) => s + e.durSec, 0) /
        12,
    );
    for (let barStart = LEAD_IN_SEC; barStart < endSec; barStart += barSec) {
      const chord = chordForBar(song, events, barStart, barStart + barSec);
      const classes = chordPitches(chord);
      const chordMidis = classes.map((pc) => 48 + pc);
      for (let beat = 0; beat < song.beatsPerBar; beat += 2) {
        const at = barStart + beat * beatSec;
        for (const m of chordMidis) addTone(out, at, 2 * beatSec - 0.05, m, 0.09, PIANO, PIANO_SHAPE);
        addTone(out, at, 2 * beatSec - 0.05, 36 + classes[0]!, 0.22, [1, 0.4], BASS_SHAPE);
      }
      if (variant === 'under') {
        const under = classes.map((pc) => 12 * (leadOctave - 1) + pc);
        const eighth = beatSec / 2;
        for (let k = 0; barStart + k * eighth < Math.min(endSec, barStart + barSec); k++) {
          addTone(out, barStart + k * eighth, eighth * 0.95, under[k % under.length]!, 0.42, PIANO, { ...PIANO_SHAPE, decaySec: 0.4 });
        }
      }
    }
    addDrums(out, beatSec, LEAD_IN_SEC, endSec);
  }

  const samples = softLimit(variant === 'solo' ? out : reverb(out));
  const notes = events.filter((e) => e.midi !== null).map((e) => ({ midi: e.midi!, startSec: e.startSec, endSec: e.startSec + e.durSec }));
  return { samples, truth: { bpm: song.bpm, beatsPerBar: song.beatsPerBar, beatUnit: song.beatUnit, notes, durationSec } };
}

export const fixtureName = (song: string, variant: Variant) => `${song}-${variant}`;

if (process.argv[1]?.endsWith('synth.ts')) {
  mkdirSync(BENCH_DIR, { recursive: true });
  for (const song of SONGS) {
    for (const variant of VARIANTS) {
      const { samples, truth } = renderSong(song, variant);
      const name = fixtureName(song.name, variant);
      writeFileSync(join(BENCH_DIR, `${name}.wav`), encodeWav({ samples, sampleRate: RATE }));
      writeFileSync(join(BENCH_DIR, `${name}.truth.json`), JSON.stringify(truth));
      console.log(`${name}: ${truth.notes.length} notes, ${truth.durationSec.toFixed(1)} s`);
    }
  }
  for (const name of ['twinkle-solo', 'twinkle-bass']) writeFileSync(join(BENCH_DIR, `${name}.truth.json`), JSON.stringify(twinkleTruth()));
}
