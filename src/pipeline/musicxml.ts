import { TICKS_PER_QUARTER, type Midi, type QuantizedNote, type Score } from '../domain';

type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
type Spelled = { step: Step; alter: -1 | 0 | 1; octave: number };

const SHARP_SPELLING: readonly [Step, 0 | 1][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_SPELLING: readonly [Step, 0 | -1][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const NOTE_VALUES: readonly { ticks: number; type: string; dots: 0 | 1 }[] = [
  { ticks: 16, type: 'whole', dots: 0 },
  { ticks: 12, type: 'half', dots: 1 },
  { ticks: 8, type: 'half', dots: 0 },
  { ticks: 6, type: 'quarter', dots: 1 },
  { ticks: 4, type: 'quarter', dots: 0 },
  { ticks: 3, type: 'eighth', dots: 1 },
  { ticks: 2, type: 'eighth', dots: 0 },
  { ticks: 1, type: '16th', dots: 0 },
];

const ACCIDENTAL_NAME = { [-1]: 'flat', 0: 'natural', 1: 'sharp' } as const;

function spell(midi: Midi, keyFifths: number): Spelled {
  const [step, alter] = (keyFifths < 0 ? FLAT_SPELLING : SHARP_SPELLING)[midi % 12]!;
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

function keySignatureAlters(keyFifths: number): Map<Step, -1 | 0 | 1> {
  const alters = new Map<Step, -1 | 0 | 1>();
  if (keyFifths > 0) for (const s of SHARP_ORDER.slice(0, keyFifths)) alters.set(s, 1);
  if (keyFifths < 0) for (const s of FLAT_ORDER.slice(0, -keyFifths)) alters.set(s, -1);
  return alters;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

type Meter = { barTicks: number; beatTicks: number };

function onBeatGrid(ticks: number, pos: number, { beatTicks }: Meter): boolean {
  if (ticks >= beatTicks) return pos % beatTicks === 0;
  const undotted = 2 ** Math.floor(Math.log2(ticks));
  const staysInBeat = Math.floor(pos / beatTicks) === Math.floor((pos + ticks - 1) / beatTicks);
  return staysInBeat && pos % undotted === 0;
}

function isSyncopation(ticks: number, pos: number, { barTicks, beatTicks }: Meter): boolean {
  const halfBar = barTicks / 2;
  const straddlesHalfBar = barTicks === 4 * beatTicks && pos < halfBar && pos + ticks > halfBar;
  return beatTicks === TICKS_PER_QUARTER && pos % 2 === 0 && (ticks === 4 || ticks === 6) && !straddlesHalfBar;
}

function decompose(posInBar: number, length: number, meter: Meter, sounding: boolean) {
  const fits = (ticks: number, pos: number) => onBeatGrid(ticks, pos, meter) || (sounding && isSyncopation(ticks, pos, meter));
  const pieces: (typeof NOTE_VALUES)[number][] = [];
  let pos = posInBar;
  let left = length;
  while (left > 0) {
    const value = NOTE_VALUES.find((v) => v.ticks <= left && fits(v.ticks, pos)) ?? NOTE_VALUES.at(-1)!;
    pieces.push(value);
    pos += value.ticks;
    left -= value.ticks;
  }
  return pieces;
}

type Piece =
  | { kind: 'sound'; midi: Midi; ticks: number; tieStart: boolean; tieStop: boolean }
  | { kind: 'rest'; ticks: number }
  | { kind: 'grace'; midi: Midi };

function layoutMeasures(notes: readonly QuantizedNote[], meter: Meter): Piece[][] {
  const { barTicks } = meter;
  const timed = notes.filter((x) => x.ornament !== 'grace');
  const endTick = timed.reduce((end, x) => Math.max(end, x.startTick + x.durTicks), 0);
  const barCount = Math.max(1, Math.ceil(endTick / barTicks));
  const bars: Piece[][] = Array.from({ length: barCount }, () => []);

  const place = (startTick: number, durTicks: number, midi: Midi | null) => {
    const pieces: { bar: number; ticks: number }[] = [];
    let pos = startTick;
    while (pos < startTick + durTicks) {
      const bar = Math.floor(pos / barTicks);
      const segment = Math.min(startTick + durTicks, (bar + 1) * barTicks) - pos;
      for (const v of decompose(pos - bar * barTicks, segment, meter, midi !== null)) pieces.push({ bar, ticks: v.ticks });
      pos += segment;
    }
    pieces.forEach(({ bar, ticks }, i) => {
      bars[bar]!.push(
        midi === null
          ? { kind: 'rest', ticks }
          : { kind: 'sound', midi, ticks, tieStart: i < pieces.length - 1, tieStop: i > 0 },
      );
    });
  };

  let cursor = 0;
  for (const note of notes) {
    if (note.startTick > cursor) {
      place(cursor, note.startTick - cursor, null);
      cursor = note.startTick;
    }
    if (note.ornament === 'grace') {
      if (note.midi !== null) bars[Math.min(Math.floor(note.startTick / barTicks), barCount - 1)]!.push({ kind: 'grace', midi: note.midi });
      continue;
    }
    place(note.startTick, note.durTicks, note.midi);
    cursor = note.startTick + note.durTicks;
  }
  if (cursor < barCount * barTicks) place(cursor, barCount * barTicks - cursor, null);
  return bars;
}

type AccidentalState = { keyAlters: Map<Step, -1 | 0 | 1>; shown: Map<string, number> };

function noteXml(piece: Piece, keyFifths: number, state: AccidentalState, barTicks: number, wholeBarRest: boolean): string {
  if (piece.kind === 'rest') {
    if (wholeBarRest) return `<note><rest measure="yes"/><duration>${barTicks}</duration><voice>1</voice></note>`;
    const v = NOTE_VALUES.find((x) => x.ticks === piece.ticks)!;
    return `<note><rest/><duration>${piece.ticks}</duration><voice>1</voice><type>${v.type}</type>${'<dot/>'.repeat(v.dots)}</note>`;
  }
  const { step, alter, octave } = spell(piece.midi, keyFifths);
  const slot = `${step}${octave}`;
  const isContinuation = piece.kind === 'sound' && piece.tieStop;
  const current = state.shown.get(slot) ?? state.keyAlters.get(step) ?? 0;
  const accidental = !isContinuation && current !== alter ? `<accidental>${ACCIDENTAL_NAME[alter]}</accidental>` : '';
  state.shown.set(slot, alter);
  const pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
  if (piece.kind === 'grace') {
    return `<note><grace slash="yes"/>${pitch}<voice>1</voice><type>eighth</type>${accidental}</note>`;
  }
  const v = NOTE_VALUES.find((x) => x.ticks === piece.ticks)!;
  const ties = [piece.tieStop && 'stop', piece.tieStart && 'start'].filter((t): t is string => Boolean(t));
  const tieXml = ties.map((t) => `<tie type="${t}"/>`).join('');
  const tiedXml = ties.length ? `<notations>${ties.map((t) => `<tied type="${t}"/>`).join('')}</notations>` : '';
  return `<note>${pitch}<duration>${piece.ticks}</duration>${tieXml}<voice>1</voice><type>${v.type}</type>${'<dot/>'.repeat(v.dots)}${accidental}${tiedXml}</note>`;
}

export function toMusicXml(score: Score): string {
  const barTicks = score.beatsPerBar * (score.beatUnit === 4 ? TICKS_PER_QUARTER : TICKS_PER_QUARTER / 2);
  const beatTicks = score.beatUnit === 8 ? (TICKS_PER_QUARTER * 3) / 2 : TICKS_PER_QUARTER;
  const bars = layoutMeasures(score.notes, { barTicks, beatTicks });
  const keyAlters = keySignatureAlters(score.keyFifths);
  const bpm = Math.round(score.bpm);
  const title = escapeXml(score.title);
  const source = escapeXml(score.source);

  const measureXml = bars.map((pieces, i) => {
    const state: AccidentalState = { keyAlters, shown: new Map() };
    const wholeBarRest = pieces.every((p) => p.kind === 'rest');
    const body = (wholeBarRest ? pieces.slice(0, 1) : pieces)
      .map((p) => noteXml(p, score.keyFifths, state, barTicks, wholeBarRest))
      .join('\n      ');
    const attributes =
      i === 0
        ? `<attributes><divisions>${TICKS_PER_QUARTER}</divisions><key><fifths>${score.keyFifths}</fifths><mode>major</mode></key><time><beats>${score.beatsPerBar}</beats><beat-type>${score.beatUnit}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>
      `
        : '';
    const barline = i === bars.length - 1 ? '\n      <barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    return `    <measure number="${i + 1}">
      ${attributes}${body}${barline}
    </measure>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <identification>
    <encoding><software>Trowa</software></encoding>
    <source>${source}</source>
  </identification>
  <credit page="1"><credit-type>title</credit-type><credit-words justify="center" valign="top">${title}</credit-words></credit>
  <credit page="1"><credit-type>subtitle</credit-type><credit-words justify="center" valign="top">${source}</credit-words></credit>
  <part-list>
    <score-part id="P1">
      <part-name>Flute</part-name>
      <score-instrument id="P1-I1"><instrument-name>Flute</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>74</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${measureXml.join('\n')}
  </part>
</score-partwise>
`;
}
