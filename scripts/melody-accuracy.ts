import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { TICKS_PER_QUARTER, type DetectedNote, type Options, type Score } from '../src/domain';
import type { Detection } from '../src/pipeline/pitch';
import { notate, type Timing } from '../src/pipeline/score';

const NOTES_DIR = '.cache/notes';
const REFERENCE_DIR = 'scripts/reference';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FRAME_SEC = 0.01;
const SLOT_BEATS = 0.5;
const TIMED_THROUGH_BAR = 32;
const ONSET_TOLERANCE_BEATS = 0.25;

const midiOf = (name: string) =>
  12 * (Number(name.slice(-1)) + 1) + LETTER[name[0]!]! + (name.includes('#') ? 1 : name.includes('b') ? -1 : 0);
const nameOf = (midi: number) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

type Confidence = 'sure' | 'approx' | 'unsure';
type RefNote = { midi: number | null; startBeat: number; beats: number; bar: number; section: number; confidence: Confidence };
type Reference = { beatsPerBar: number; bpm: number; timed: RefNote[]; untimed: { bar: number; pitches: number[] }[] };
type Alignment = { transpose: number; bpm: number; offsetSec: number; sectionShiftSec: Record<string, number>; fitOverlap: number };

function parseReference(text: string): Reference {
  const ref: Reference = { beatsPerBar: 4, bpm: 120, timed: [], untimed: [] };
  for (const raw of text.split('\n')) {
    const line = raw.startsWith('#') ? '' : raw.trim();
    if (!line) continue;
    const [head, kind, ...tokens] = line.split(/\s+/);
    if (head === 'meter') ref.beatsPerBar = Number(kind);
    else if (head === 'bpm') ref.bpm = Number(kind);
    else if (kind === 'untimed') ref.untimed.push({ bar: Number(head), pitches: tokens.map(midiOf) });
    else {
      const section = Number(head);
      let beat = (section - 1) * ref.beatsPerBar;
      for (const token of tokens) {
        const [pitch, length] = token.split(':');
        const beats = Number(length);
        ref.timed.push({
          midi: pitch === 'r' ? null : midiOf(pitch!),
          startBeat: beat,
          beats,
          bar: Math.floor(beat / ref.beatsPerBar) + 1,
          section,
          confidence: kind as Confidence,
        });
        beat += beats;
      }
    }
  }
  return ref;
}

type Roll = Map<number, Int32Array>;

function pianoRoll(notes: readonly DetectedNote[], durationSec: number): Roll {
  const frames = Math.ceil(durationSec / FRAME_SEC) + 1;
  const sounding = new Map<number, Uint8Array>();
  for (const n of notes) {
    const row = sounding.get(n.midi) ?? new Uint8Array(frames);
    sounding.set(n.midi, row);
    const end = Math.min(frames, Math.round((n.onsetSec + n.durSec) / FRAME_SEC));
    for (let f = Math.max(0, Math.round(n.onsetSec / FRAME_SEC)); f < end; f++) row[f] = 1;
  }
  const roll: Roll = new Map();
  for (const [midi, row] of sounding) {
    const prefix = new Int32Array(frames + 1);
    for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f]! + row[f]!;
    roll.set(midi, prefix);
  }
  return roll;
}

function framesSounding(roll: Roll, midi: number, startSec: number, endSec: number): number {
  const prefix = roll.get(midi);
  if (!prefix) return 0;
  const clamp = (sec: number) => Math.max(0, Math.min(prefix.length - 1, Math.round(sec / FRAME_SEC)));
  return prefix[clamp(endSec)]! - prefix[clamp(startSec)]!;
}

const beatSec = (bpm: number) => 60 / bpm;

function refSec(align: Alignment, section: number, beat: number): number {
  return align.offsetSec + (align.sectionShiftSec[section] ?? 0) + beat * beatSec(align.bpm);
}

function fitOverlap(roll: Roll, notes: readonly RefNote[], transpose: number, bpm: number, offsetSec: number): number {
  let hit = 0;
  for (const n of notes) {
    const start = offsetSec + n.startBeat * beatSec(bpm);
    hit += framesSounding(roll, (n.midi! + transpose) % 12, start, start + n.beats * beatSec(bpm));
  }
  return hit;
}

const pitchClasses = (notes: readonly DetectedNote[]) => notes.map((n) => ({ ...n, midi: (n.midi % 12) as DetectedNote['midi'] }));

function fitAlignment(ref: Reference, evidence: Roll): Alignment {
  const sounding = ref.timed.filter((n) => n.midi !== null);
  let best = { transpose: 0, bpm: ref.bpm, offsetSec: 0, hit: -1 };
  const consider = (transpose: number, bpm: number, offsetSec: number) => {
    const hit = fitOverlap(evidence, sounding, transpose, bpm, offsetSec);
    if (hit > best.hit) best = { transpose, bpm, offsetSec, hit };
  };
  for (let t = -6; t <= 6; t++) for (let bpm = 96; bpm <= 144; bpm += 0.5) for (let o = 0; o <= 30; o += 0.05) consider(t, bpm, o);
  const coarse = best;
  for (let bpm = coarse.bpm - 1; bpm <= coarse.bpm + 1; bpm += 0.05)
    for (let o = coarse.offsetSec - 0.1; o <= coarse.offsetSec + 0.1; o += 0.01) consider(coarse.transpose, bpm, o);

  const align: Alignment = { transpose: best.transpose, bpm: best.bpm, offsetSec: best.offsetSec, sectionShiftSec: {}, fitOverlap: 0 };
  const sections = [...new Set(sounding.map((n) => n.section))];
  for (const section of sections) {
    const notes = sounding.filter((n) => n.section === section);
    let bestShift = { shift: 0, hit: -1 };
    for (let shift = -1; shift <= 1.0001; shift += 0.01) {
      const hit = fitOverlap(evidence, notes, align.transpose, align.bpm, align.offsetSec + shift);
      if (hit > bestShift.hit || (hit === bestShift.hit && Math.abs(shift) < Math.abs(bestShift.shift))) bestShift = { shift, hit };
    }
    align.sectionShiftSec[section] = Math.round(bestShift.shift * 100) / 100;
  }
  const total = sounding.reduce((s, n) => s + (n.beats * beatSec(align.bpm)) / FRAME_SEC, 0);
  const hit = sections.reduce(
    (s, section) =>
      s +
      fitOverlap(
        evidence,
        sounding.filter((n) => n.section === section),
        align.transpose,
        align.bpm,
        align.offsetSec + (align.sectionShiftSec[section] ?? 0),
      ),
    0,
  );
  align.fitOverlap = Math.round((1000 * hit) / total) / 1000;
  align.bpm = Math.round(align.bpm * 100) / 100;
  align.offsetSec = Math.round(align.offsetSec * 100) / 100;
  return align;
}

type Slot = { note: RefNote; sec: number; beat: number; startSec: number; endSec: number };

function slots(ref: Reference, align: Alignment): Slot[] {
  const out: Slot[] = [];
  for (const note of ref.timed) {
    if (note.midi === null || note.bar > TIMED_THROUGH_BAR) continue;
    for (let b = note.startBeat; b < note.startBeat + note.beats - 1e-9; b += SLOT_BEATS) {
      const beat = b + Math.min(SLOT_BEATS, note.startBeat + note.beats - b) / 2;
      out.push({
        note,
        beat,
        sec: refSec(align, note.section, beat),
        startSec: refSec(align, note.section, b),
        endSec: refSec(align, note.section, Math.min(b + SLOT_BEATS, note.startBeat + note.beats)),
      });
    }
  }
  return out;
}

function interpolate(points: readonly { x: number; y: number }[], x: number): number {
  if (points.length === 1) return points[0]!.y;
  let i = 1;
  while (i < points.length - 1 && points[i]!.x < x) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  return a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x || 1);
}

function scoreTimeMap(timing: readonly Timing[], bpm: number) {
  const points = timing.map((t) => ({ sec: t.sec, tick: t.tick })).filter((p, i, all) => i === 0 || p.sec > all[i - 1]!.sec);
  const ticksPerSec = (bpm / 60) * TICKS_PER_QUARTER;
  const secToTick = (sec: number) =>
    points.length < 2 ? points[0]!.tick + (sec - points[0]!.sec) * ticksPerSec : interpolate(points.map((p) => ({ x: p.sec, y: p.tick })), sec);
  return { secToTick };
}

function pitchAtTick(score: Score, tick: number): number | null {
  for (const n of score.notes) {
    if (n.ornament === 'grace') continue;
    if (n.startTick <= tick && tick < n.startTick + n.durTicks) return n.midi;
  }
  return null;
}

const collapse = (xs: readonly number[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

function windowEdit(reference: readonly number[], ours: readonly number[]): number {
  let row = new Array<number>(ours.length + 1).fill(0);
  for (let i = 1; i <= reference.length; i++) {
    const next = [i];
    for (let j = 1; j <= ours.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (reference[i - 1] === ours[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return Math.min(...row);
}

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((1000 * part) / whole) / 1000);

function evaluate(fixture: string, detection: Detection & { durationSec: number }, ref: Reference, align: Alignment, options: Options) {
  const notated = notate(detection, options, { title: fixture, source: fixture });
  const { score, line, timing } = notated;
  const all = slots(ref, align);
  const rawRoll = pianoRoll(detection.notes, detection.durationSec);
  const lineRoll = pianoRoll(line, detection.durationSec);
  const { secToTick } = scoreTimeMap(timing, score.bpm);
  const want = (s: Slot) => s.note.midi! + align.transpose;
  const present = (roll: Roll, s: Slot, octaves: boolean) =>
    (octaves ? [-24, -12, 0, 12, 24] : [0]).some((k) => framesSounding(roll, want(s) + k, s.startSec, s.endSec) > 0);
  const scorePitch = (s: Slot) => pitchAtTick(score, secToTick(s.sec));

  const perSlot = all.map((s) => ({
    s,
    raw: present(rawRoll, s, false),
    rawOctave: present(rawRoll, s, true),
    line: present(lineRoll, s, false),
    lineOctave: present(lineRoll, s, true),
    score: scorePitch(s) === want(s),
    scoreOctave: scorePitch(s) !== null && (scorePitch(s)! - want(s)) % 12 === 0,
  }));

  const onsets = ref.timed.filter((n) => n.midi !== null && n.bar <= TIMED_THROUGH_BAR);
  const drift = onsets.map((n) => secToTick(refSec(align, n.section, n.startBeat)) / TICKS_PER_QUARTER - n.startBeat);
  let bestPhase = { c: 0, hits: -1 };
  for (const c of drift.map((d) => Math.round(d * 2) / 2)) {
    const hits = drift.filter((d) => Math.abs(d - c) <= ONSET_TOLERANCE_BEATS).length;
    if (hits > bestPhase.hits) bestPhase = { c, hits };
  }

  const scorePitches = score.notes.filter((n) => n.midi !== null && n.ornament !== 'grace');
  const pitchesBetween = (fromSec: number, toSec: number) =>
    scorePitches
      .filter((n) => {
        const sec = interpolate(timing.map((t) => ({ x: t.tick, y: t.sec })), n.startTick);
        return sec >= fromSec && sec < toSec;
      })
      .map((n) => n.midi as number);
  const lastTimed = ref.timed.at(-1)!;
  const untimedFromSec = refSec(align, lastTimed.section, lastTimed.startBeat + lastTimed.beats);
  const untimedRef = collapse(ref.untimed.flatMap((u) => u.pitches.map((p) => p + align.transpose)));
  const untimedOurs = collapse(pitchesBetween(untimedFromSec, Infinity));
  const timedRef = collapse(onsets.map((n) => n.midi! + align.transpose));
  const timedOurs = collapse(pitchesBetween(refSec(align, 1, 0) - 0.5, untimedFromSec));

  const bars = [...new Set(all.map((x) => x.note.bar))].map((bar) => {
    const inBar = perSlot.filter((x) => x.s.note.bar === bar);
    const barStart = refSec(align, inBar[0]!.s.note.section, (bar - 1) * ref.beatsPerBar);
    const barEnd = refSec(align, inBar[0]!.s.note.section, bar * ref.beatsPerBar);
    return {
      bar,
      confidence: inBar[0]!.s.note.confidence,
      reference: collapse(ref.timed.filter((n) => n.bar === bar && n.midi !== null).map((n) => n.midi! + align.transpose)).map(nameOf).join(' '),
      ours: collapse(pitchesBetween(barStart, barEnd)).map(nameOf).join(' '),
      raw: ratio(inBar.filter((x) => x.raw).length, inBar.length),
      line: ratio(inBar.filter((x) => x.line).length, inBar.length),
      score: ratio(inBar.filter((x) => x.score).length, inBar.length),
      scoreOctave: ratio(inBar.filter((x) => x.scoreOctave).length, inBar.length),
    };
  });

  const share = (pick: (x: (typeof perSlot)[number]) => boolean, filter: (x: (typeof perSlot)[number]) => boolean = () => true) =>
    ratio(perSlot.filter((x) => filter(x) && pick(x)).length, perSlot.filter(filter).length);
  const confident = (x: (typeof perSlot)[number]) => x.s.note.confidence !== 'unsure';
  return {
    fixture,
    bpm: score.bpm,
    tempoRatio: Math.round((1000 * score.bpm) / align.bpm) / 1000,
    slots: perSlot.length,
    rawRecall: share((x) => x.raw),
    rawRecallAnyOctave: share((x) => x.rawOctave),
    lineRecall: share((x) => x.line),
    lineRecallAnyOctave: share((x) => x.lineOctave),
    scoreBeatMatch: share((x) => x.score),
    scoreBeatMatchAnyOctave: share((x) => x.scoreOctave),
    scoreBeatMatchConfident: share((x) => x.score, confident),
    onsetsOnGrid: ratio(bestPhase.hits, drift.length),
    gridPhaseBeats: bestPhase.c,
    timedEdit: ratio(windowEdit(timedRef, timedOurs), timedRef.length),
    untimedEdit: ratio(windowEdit(untimedRef, untimedOurs), untimedRef.length),
    bars,
  };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fit: { type: 'boolean', default: false },
    bars: { type: 'boolean', default: false },
    json: { type: 'string' },
    bpm: { type: 'string' },
  },
});

const videoId = 'VGS9nrEwXmw';
const ref = parseReference(readFileSync(join(REFERENCE_DIR, `${videoId}.txt`), 'utf8'));
const alignmentPath = join(REFERENCE_DIR, `${videoId}.alignment.json`);
const load = (fixture: string) => JSON.parse(readFileSync(join(NOTES_DIR, `${fixture}.json`), 'utf8')) as Detection & { durationSec: number };

if (values.fit) {
  const sources = ['demucs', 'filter'].map((p) => load(`${videoId}-${p}`));
  const evidence = pianoRoll(pitchClasses(sources.flatMap((d) => d.notes)), Math.max(...sources.map((d) => d.durationSec)));
  const align = fitAlignment(ref, evidence);
  writeFileSync(alignmentPath, `${JSON.stringify(align, null, 1)}\n`);
  console.log(`wrote ${alignmentPath}`, JSON.stringify(align));
}
if (!existsSync(alignmentPath)) {
  console.error(`no ${alignmentPath}; run with --fit first`);
  process.exit(2);
}
const align: Alignment = JSON.parse(readFileSync(alignmentPath, 'utf8'));
const options: Options = { transpose: 0, key: 'auto', difficulty: 'melody', tempoOverride: values.bpm ? Number(values.bpm) : null };
const fixtures = positionals.length ? positionals : [`${videoId}-demucs`, `${videoId}-filter`];

let errors = 0;
const reports = [];
for (const fixture of fixtures) {
  let report;
  try {
    report = evaluate(fixture, load(fixture), ref, align, options);
  } catch (err) {
    errors++;
    console.log(`${fixture}: ${String(err)}`);
    continue;
  }
  reports.push(report);
  const { bars, ...head } = report;
  console.log(Object.entries(head).map(([k, v]) => `${k} ${v}`).join('  '));
  if (values.bars) {
    for (const b of bars) {
      console.log(
        `  bar ${String(b.bar).padStart(2)} ${b.confidence.padEnd(6)} raw ${b.raw.toFixed(2)} line ${b.line.toFixed(2)} score ${b.score.toFixed(2)}/${b.scoreOctave.toFixed(2)}  ref ${b.reference.padEnd(24)} ours ${b.ours}`,
      );
    }
  }
}
console.log(`reference slots per fixture ${reports[0]?.slots ?? 0}, fixtures ${fixtures.length}, reported ${reports.length}, errors ${errors}`);
if (values.json) writeFileSync(values.json, JSON.stringify(reports, null, 1));
