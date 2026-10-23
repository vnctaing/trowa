import {
  STAGES,
  TICKS_PER_QUARTER,
  TrowaError,
  type DetectedNote,
  type Midi,
  type Options,
  type PipelineEvent,
  type QuantizedNote,
  type Score,
  type Source,
} from '../domain';
import type { YoutubeInfo } from '../pipeline';
import { measureTicks, midiToHz, secondsPerTick, spell } from '../ui/music';

const [G4, A4, B4, C5, D5, D4] = [67, 69, 71, 72, 74, 62] as Midi[];
type Bar = readonly (readonly [Midi | undefined, number])[];

const PHRASE_A: readonly Bar[] = [
  [[B4, 4], [B4, 4], [C5, 4], [D5, 4]],
  [[D5, 4], [C5, 4], [B4, 4], [A4, 4]],
  [[G4, 4], [G4, 4], [A4, 4], [B4, 4]],
];
const ODE_TO_JOY: readonly Bar[] = [
  ...PHRASE_A,
  [[B4, 6], [A4, 2], [A4, 8]],
  ...PHRASE_A,
  [[A4, 6], [G4, 2], [G4, 8]],
  [[A4, 4], [A4, 4], [B4, 4], [G4, 4]],
  [[A4, 4], [B4, 2], [C5, 2], [B4, 4], [G4, 4]],
  [[A4, 4], [B4, 2], [C5, 2], [B4, 4], [A4, 4]],
  [[G4, 4], [A4, 4], [D4, 8]],
  ...PHRASE_A,
  [[A4, 6], [G4, 2], [G4, 8]],
];

function odeToJoy(): QuantizedNote[] {
  const notes: QuantizedNote[] = [];
  let tick = 0;
  for (const bar of ODE_TO_JOY) {
    for (const [midi, durTicks] of bar) {
      if (midi !== undefined) notes.push({ midi, startTick: tick, durTicks });
      tick += durTicks;
    }
  }
  return notes;
}

function param(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

const FAILURES: readonly [string, ConstructorParameters<typeof TrowaError>[0]][] = [
  ['private', 'private'],
  ['long', 'too_long'],
  ['region', 'region_locked'],
  ['offline', 'network'],
];

const FAKE_THUMBNAIL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#2b3550"/><stop offset="1" stop-color="#7a5a2a"/></linearGradient></defs>' +
    '<rect width="160" height="90" fill="url(#g)"/><text x="80" y="58" font-family="Georgia" font-size="34" ' +
    'text-anchor="middle" fill="#f7f3ea" font-style="italic">IX</text></svg>',
)}`;

const VIDEO_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

export async function lookupYoutube(url: string, signal?: AbortSignal): Promise<YoutubeInfo> {
  await wait(450, signal);
  const failure = FAILURES.find(([needle]) => url.includes(needle));
  if (failure) throw new TrowaError(failure[1]);
  const videoId = VIDEO_ID.exec(url)?.[1];
  if (!videoId) throw new TrowaError('invalid_url');
  return {
    videoId,
    title: url.includes('dense') ? 'Ode to Joy (full orchestra, live)' : 'Ode to Joy',
    author: 'Ludwig van Beethoven',
    thumbnail: FAKE_THUMBNAIL,
    durationSec: 32,
  };
}

function sourceText(source: Source): string {
  return source.kind === 'youtube' ? `${source.url} ${source.title}` : source.file.name;
}

function synthesize(score: Score): AudioBuffer {
  const sampleRate = 22050;
  const spt = secondsPerTick(score);
  const totalTicks = Math.max(...score.notes.map((n) => n.startTick + n.durTicks));
  const length = Math.ceil((totalTicks * spt + 1) * sampleRate);
  const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  const add = (startSec: number, durSec: number, sample: (t: number) => number) => {
    const from = Math.floor(startSec * sampleRate);
    const to = Math.min(length, from + Math.floor(durSec * sampleRate));
    for (let i = from; i < to; i++) data[i] = (data[i] ?? 0) + sample((i - from) / sampleRate);
  };
  for (const n of score.notes) {
    if (n.midi === null) continue;
    const hz = midiToHz(n.midi);
    const dur = n.durTicks * spt;
    add(n.startTick * spt, dur, (t) => {
      const env = Math.min(1, t / 0.03) * Math.max(0, 1 - t / dur) ** 0.5;
      const w = 2 * Math.PI * hz * t;
      return 0.22 * env * (Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w));
    });
  }
  const beat = TICKS_PER_QUARTER * spt;
  for (let b = 0; b * beat < totalTicks * spt; b++) {
    add(b * beat, 0.25, (t) => 0.5 * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 14));
    add(b * beat + beat / 2, 0.06, (t) => 0.08 * (Math.random() * 2 - 1) * Math.exp(-t * 60));
    const bassHz = midiToHz(b % 4 < 2 ? 43 : 38);
    add(b * beat, beat * 0.9, (t) => 0.12 * Math.sin(2 * Math.PI * bassHz * t) * Math.exp(-t * 2));
  }
  return buffer;
}

function normalizeFifths(fifths: number): number {
  const f = ((fifths % 12) + 12) % 12;
  return f > 6 ? f - 12 : f;
}

export function transposeScore(score: Score, semitones: number): Score {
  return {
    ...score,
    keyFifths: normalizeFifths(score.keyFifths + semitones * 7),
    notes: score.notes.map((n) => (n.midi === null ? n : { ...n, midi: (n.midi + semitones) as Midi })),
  };
}

export async function runPipeline(
  source: Source,
  options: Options,
  onEvent: (e: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<Score> {
  const stageMs = Number(param('fakeMs') ?? 4500);
  const text = sourceText(source);
  const base: Score = {
    title: source.title,
    source: source.kind === 'youtube' ? `${source.author} · YouTube` : source.file.name,
    bpm: options.tempoOverride ?? 120,
    beatsPerBar: 4,
    beatUnit: 4,
    keyFifths: 1,
    notes: odeToJoy(),
    confidence: text.includes('dense') ? 0.38 : 0.86,
  };
  const score = transposeScore(base, options.transpose);
  const steps = 16;
  for (const { id } of STAGES) {
    onEvent({ type: 'stage', stage: id });
    for (let s = 1; s <= steps; s++) {
      await wait(stageMs / steps, signal);
      onEvent({ type: 'progress', stage: id, fraction: s / steps });
      if (id === 'extracting' && s === 3) onEvent({ type: 'audio', buffer: synthesize(base) });
      if (id === 'detecting' && s === 6) {
        if (text.includes('drums')) throw new TrowaError('no_melody');
        const spt = secondsPerTick(score);
        const notes: DetectedNote[] = score.notes.flatMap((n) =>
          n.midi === null
            ? []
            : [{ midi: n.midi, onsetSec: n.startTick * spt, durSec: n.durTicks * spt, amplitude: 0.7, onset: 0.9 }],
        );
        onEvent({ type: 'notes', notes });
      }
    }
  }
  return score;
}

const NOTE_TYPES: readonly [number, string, boolean][] = [
  [16, 'whole', false],
  [12, 'half', true],
  [8, 'half', false],
  [6, 'quarter', true],
  [4, 'quarter', false],
  [3, 'eighth', true],
  [2, 'eighth', false],
  [1, '16th', false],
];

function splitDuration(ticks: number): (typeof NOTE_TYPES)[number][] {
  const parts: (typeof NOTE_TYPES)[number][] = [];
  let left = ticks;
  while (left > 0) {
    const part = NOTE_TYPES.find(([t]) => t <= left) ?? NOTE_TYPES[NOTE_TYPES.length - 1]!;
    parts.push(part);
    left -= part[0];
  }
  return parts;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Event = { midi: Midi | null; ticks: number; tieStart: boolean; tieStop: boolean; grace: boolean };

function noteXml(e: Event, keyFifths: number): string {
  const head = e.grace ? '<grace slash="yes"/>' : '';
  if (e.midi === null) {
    return splitDuration(e.ticks)
      .map(([t, type, dot]) => `<note><rest/><duration>${t}</duration><type>${type}</type>${dot ? '<dot/>' : ''}</note>`)
      .join('');
  }
  const s = spell(e.midi, keyFifths);
  const pitch = `<pitch><step>${s.letter}</step>${s.alter ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave}</octave></pitch>`;
  if (e.grace) return `<note>${head}${pitch}<type>eighth</type></note>`;
  const parts = splitDuration(e.ticks);
  return parts
    .map(([t, type, dot], i) => {
      const stop = i > 0 || e.tieStop;
      const start = i < parts.length - 1 || e.tieStart;
      const ties = `${stop ? '<tie type="stop"/>' : ''}${start ? '<tie type="start"/>' : ''}`;
      const tied = `${stop ? '<tied type="stop"/>' : ''}${start ? '<tied type="start"/>' : ''}`;
      return `<note>${pitch}<duration>${t}</duration>${ties}<type>${type}</type>${dot ? '<dot/>' : ''}${tied ? `<notations>${tied}</notations>` : ''}</note>`;
    })
    .join('');
}

export function toMusicXml(score: Score): string {
  const bar = measureTicks(score);
  const sounding = score.notes.filter((n) => !n.ornament).sort((a, b) => a.startTick - b.startTick);
  const end = Math.max(bar, ...sounding.map((n) => n.startTick + n.durTicks));
  const barCount = Math.ceil(end / bar);
  const measures: string[] = [];
  for (let m = 0; m < barCount; m++) {
    const from = m * bar;
    const to = from + bar;
    const events: Event[] = [];
    let cursor = from;
    for (const n of sounding) {
      const s = Math.max(n.startTick, from);
      const e = Math.min(n.startTick + n.durTicks, to);
      if (e <= s || s < cursor) continue;
      if (s > cursor) events.push({ midi: null, ticks: s - cursor, tieStart: false, tieStop: false, grace: false });
      for (const g of score.notes) {
        if (g.ornament === 'grace' && g.startTick === n.startTick && s === n.startTick) {
          events.push({ midi: g.midi, ticks: 0, tieStart: false, tieStop: false, grace: true });
        }
      }
      events.push({
        midi: n.midi,
        ticks: e - s,
        tieStop: n.midi !== null && s > n.startTick,
        tieStart: n.midi !== null && e < n.startTick + n.durTicks,
        grace: false,
      });
      cursor = e;
    }
    if (cursor < to) events.push({ midi: null, ticks: to - cursor, tieStart: false, tieStop: false, grace: false });
    const attributes =
      m === 0
        ? `<attributes><divisions>${TICKS_PER_QUARTER}</divisions><key><fifths>${score.keyFifths}</fifths></key>` +
          `<time><beats>${score.beatsPerBar}</beats><beat-type>${score.beatUnit}</beat-type></time>` +
          `<clef><sign>G</sign><line>2</line></clef></attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
          `<per-minute>${Math.round(score.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(score.bpm)}"/></direction>`
        : '';
    measures.push(`<measure number="${m + 1}">${attributes}${events.map((e) => noteXml(e, score.keyFifths)).join('')}</measure>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">` +
    `<score-partwise version="3.1"><work><work-title>${escapeXml(score.title)}</work-title></work>` +
    `<identification><creator type="composer">${escapeXml(score.source)}</creator></identification>` +
    `<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>` +
    `<part id="P1">${measures.join('')}</part></score-partwise>`
  );
}
