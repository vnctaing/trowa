import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { TICKS_PER_QUARTER, type Options, type QuantizedNote, type Score } from '../src/domain';
import { toMusicXml } from '../src/pipeline/musicxml';
import type { Detection } from '../src/pipeline/pitch';
import { buildScore } from '../src/pipeline/score';

const NOTES_DIR = '.cache/notes';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const midiOf = (name: string) => {
  const octave = Number(name.slice(-1));
  const accidental = name.includes('#') ? 1 : name.includes('b') ? -1 : 0;
  return 12 * (octave + 1) + LETTER[name[0]!]! + accidental;
};
const nameOf = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const REFERENCE: Record<string, { pitches: number[]; bpm: number; keyFifths: number }> = {
  VGS9nrEwXmw: {
    pitches: (
      'F#5 E5 D5 C5 E5 A5 B5 F#5 G4 B4 G5 F#5 D5 G4 B4 G5 F#5 B4 B4 G5 E5 B4 ' + 'G5 F#5 G5 A5 D5 B5 A5 E5'
    )
      .split(' ')
      .map(midiOf),
    bpm: 120,
    keyFifths: 1,
  },
};

const TWINKLE_LINE = 'C4:4 C4:4 G4:4 G4:4 A4:4 A4:4 G4:8 F4:4 F4:4 E4:4 E4:4 D4:4 D4:4 C4:8';
const TWINKLE: { midi: number; ticks: number }[] = [TWINKLE_LINE, 'G4:4 G4:4 F4:4 F4:4 E4:4 E4:4 D4:8', 'G4:4 G4:4 F4:4 F4:4 E4:4 E4:4 D4:8', TWINKLE_LINE]
  .join(' ')
  .split(' ')
  .map((token) => {
    const [name, ticks] = token.split(':');
    return { midi: midiOf(name!), ticks: Number(ticks) };
  });

function editDistance(a: readonly number[], b: readonly number[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

function bestWindowDistance(reference: readonly number[], ours: readonly number[]): { distance: number; at: number } {
  let row = new Array<number>(ours.length + 1).fill(0);
  for (let i = 1; i <= reference.length; i++) {
    const next = [i];
    for (let j = 1; j <= ours.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (reference[i - 1] === ours[j - 1] ? 0 : 1));
    }
    row = next;
  }
  let at = 0;
  for (let j = 1; j <= ours.length; j++) if (row[j]! < row[at]!) at = j;
  return { distance: row[at]!, at };
}

type Head = { bar: number; type: string; dotted: boolean; tieStart: boolean; rest: boolean };

function headsFromXml(xml: string): { heads: Head[]; bars: number } {
  const heads: Head[] = [];
  const measures = xml.split('<measure ').slice(1);
  measures.forEach((measure, bar) => {
    for (const note of measure.match(/<note>.*?<\/note>/g) ?? []) {
      if (note.includes('<grace')) continue;
      heads.push({
        bar,
        type: note.includes('measure="yes"') ? 'whole' : (/<type>(.*?)<\/type>/.exec(note)?.[1] ?? '?'),
        dotted: note.includes('<dot/>'),
        tieStart: note.includes('<tie type="start"/>'),
        rest: note.includes('<rest'),
      });
    }
  });
  return { heads, bars: measures.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((1000 * part) / whole) / 10);

function octaveJumpsInPhrases(notes: readonly QuantizedNote[]): number {
  let jumps = 0;
  let previous: number | null = null;
  for (const note of notes) {
    if (note.ornament === 'grace') continue;
    if (note.midi === null) {
      if (note.durTicks >= TICKS_PER_QUARTER) previous = null;
      continue;
    }
    if (previous !== null && Math.abs(note.midi - previous) >= 12) jumps++;
    previous = note.midi;
  }
  return jumps;
}

export type Report = ReturnType<typeof report>;

function report(fixture: string, score: Score, xml: string) {
  const { heads, bars } = headsFromXml(xml);
  const sounding = heads.filter((h) => !h.rest);
  const perBar = Array.from({ length: bars }, (_, bar) => sounding.filter((h) => h.bar === bar).length);
  const byType = (type: string) => pct(sounding.filter((h) => h.type === type).length, sounding.length);
  const pitches = score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace').map((n) => n.midi as number);
  const videoId = fixture.split('-').slice(0, -1).join('-');
  const reference = REFERENCE[videoId];
  const opening = reference ? pitches.slice(0, reference.pitches.length) : [];
  const window = reference ? bestWindowDistance(reference.pitches, pitches.slice(0, 300)) : null;
  const twinkle = videoId.startsWith('twinkle')
    ? Math.round(score.bpm) === 100 &&
      score.beatsPerBar === 4 &&
      score.keyFifths === 0 &&
      JSON.stringify(score.notes.filter((n) => n.midi !== null).map((n) => ({ midi: n.midi, ticks: n.durTicks }))) ===
        JSON.stringify(TWINKLE)
    : null;
  return {
    fixture,
    bpm: score.bpm,
    meter: `${score.beatsPerBar}/${score.beatUnit}`,
    keyFifths: score.keyFifths,
    bars,
    notes: score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace').length,
    heads: sounding.length,
    headsPerBarMedian: median(perBar),
    headsPerBarMax: Math.max(0, ...perBar),
    pct16th: byType('16th'),
    pct8th: byType('eighth'),
    pctQuarter: byType('quarter'),
    pctHalf: byType('half'),
    pctWhole: byType('whole'),
    pctDotted: pct(sounding.filter((h) => h.dotted).length, sounding.length),
    tiesPerBar: Math.round((100 * sounding.filter((h) => h.tieStart).length) / Math.max(1, bars)) / 100,
    symbolsPerBar: Math.round((100 * heads.length) / Math.max(1, bars)) / 100,
    restsPerBar: Math.round((100 * heads.filter((h) => h.rest).length) / Math.max(1, bars)) / 100,
    octaveJumps: octaveJumpsInPhrases(score.notes),
    rangeLow: pitches.length ? nameOf(Math.min(...pitches)) : '-',
    rangeHigh: pitches.length ? nameOf(Math.max(...pitches)) : '-',
    openingEdit: reference ? editDistance(opening, reference.pitches) : null,
    openingEditPitchClass: reference ? editDistance(opening.map((p) => p % 12), reference.pitches.map((p) => p % 12)) : null,
    bestWindowEdit: window?.distance ?? null,
    bestWindowEndsAtNote: window?.at ?? null,
    twinkleExact: twinkle,
    opening: pitches.slice(0, 30).map(nameOf).join(' '),
  };
}

function firstBars(score: Score, count: number): string[] {
  const barTicks = score.beatsPerBar * (score.beatUnit === 4 ? TICKS_PER_QUARTER : TICKS_PER_QUARTER / 2);
  const bars = new Map<number, string[]>();
  for (const n of score.notes) {
    const bar = Math.floor(n.startTick / barTicks);
    if (bar >= count) break;
    const label = n.midi === null ? 'r' : `${nameOf(n.midi)}${n.ornament === 'grace' ? '(g)' : ''}`;
    bars.set(bar, [...(bars.get(bar) ?? []), `${label}/${n.durTicks}`]);
  }
  return [...bars].map(([bar, notes]) => `  bar ${String(bar + 1).padStart(3)}  ${notes.join(' ')}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    difficulty: { type: 'string', default: 'melody' },
    bars: { type: 'string', default: '0' },
    json: { type: 'string' },
    xml: { type: 'string' },
    summary: { type: 'boolean', default: false },
  },
});
const options: Options = {
  transpose: 0,
  key: 'auto',
  difficulty: values.difficulty === 'ornaments' ? 'ornaments' : 'melody',
  tempoOverride: null,
};
const fixtures = positionals.length
  ? positionals
  : readdirSync(NOTES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

const rows: Report[] = [];
let errors = 0;
for (const fixture of fixtures) {
  const detection: Detection = JSON.parse(readFileSync(join(NOTES_DIR, `${fixture}.json`), 'utf8'));
  let score: Score;
  try {
    score = buildScore(detection, options, { title: fixture, source: fixture });
  } catch (err) {
    errors++;
    console.log(`${fixture}: ${String(err)}`);
    continue;
  }
  const xml = toMusicXml(score);
  if (values.xml) writeFileSync(join(values.xml, `${fixture}-${options.difficulty}.musicxml`), xml);
  const row = report(fixture, score, xml);
  rows.push(row);
  if (values.summary) {
    const short = row.pct16th + row.pct8th;
    console.log(
      [row.fixture.padEnd(26), `bpm ${row.bpm}`, `key ${row.keyFifths}`, `bars ${row.bars}`, `heads ${row.heads}`, `med ${row.headsPerBarMedian}`, `max ${row.headsPerBarMax}`,
        `16th ${row.pct16th}%`, `<=8th ${Math.round(short * 10) / 10}%`, `ties ${row.tiesPerBar}`, `sym/bar ${row.symbolsPerBar}`, `rests ${row.restsPerBar}`, `oct ${row.octaveJumps}`,
        row.openingEdit === null ? '' : `edit ${row.openingEdit}/${row.bestWindowEdit}`, row.twinkleExact === null ? '' : `twinkle ${row.twinkleExact}`].join('  '),
    );
    continue;
  }
  console.log(`\n== ${fixture} (${options.difficulty}, ${detection.notes.length} detected notes)`);
  for (const [k, v] of Object.entries(row)) if (k !== 'fixture' && v !== null) console.log(`  ${k.padEnd(22)} ${v}`);
  if (Number(values.bars) > 0) for (const line of firstBars(score, Number(values.bars))) console.log(line);
}
console.log(`\nfixtures ${fixtures.length}, reported ${rows.length}, errors ${errors}`);
if (values.json) writeFileSync(values.json, JSON.stringify(rows, null, 1));
