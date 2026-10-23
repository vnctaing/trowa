import { DOMParser, type Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { Midi, QuantizedNote, Score } from '../domain';
import { toMusicXml } from './musicxml';

const note = (midi: number | null, startTick: number, durTicks: number): QuantizedNote => ({
  midi: midi as Midi | null,
  startTick,
  durTicks,
});

const score = (notes: QuantizedNote[], over: Partial<Score> = {}): Score => ({
  title: 'Twinkle & Co',
  source: 'test.wav',
  bpm: 100,
  beatsPerBar: 4,
  beatUnit: 4,
  keyFifths: 0,
  notes,
  confidence: 1,
  ...over,
});

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_level, msg) => void errors.push(msg) }).parseFromString(xml, 'text/xml');
  expect(errors).toEqual([]);
  return doc;
}

const children = (el: Element, name: string) => Array.from(el.getElementsByTagName(name));
const text = (el: Element, name: string) => el.getElementsByTagName(name)[0]?.textContent ?? null;

type Rendered = {
  pitch: string | null;
  duration: number;
  type: string | null;
  dots: number;
  ties: string[];
  grace: boolean;
  accidental: string | null;
};

function measures(xml: string): Rendered[][] {
  const doc = parse(xml);
  return children(doc.documentElement as unknown as Element, 'measure').map((m) =>
    children(m, 'note').map((n) => ({
      pitch: n.getElementsByTagName('rest').length
        ? null
        : `${text(n, 'step')}${text(n, 'alter') === '1' ? '#' : text(n, 'alter') === '-1' ? 'b' : ''}${text(n, 'octave')}`,
      duration: Number(text(n, 'duration') ?? 0),
      type: text(n, 'type'),
      dots: children(n, 'dot').length,
      ties: children(n, 'tie').map((t) => t.getAttribute('type') ?? ''),
      grace: children(n, 'grace').length > 0,
      accidental: text(n, 'accidental'),
    })),
  );
}

describe('toMusicXml', () => {
  it('splits a note crossing a barline into two tied notes', () => {
    const ms = measures(toMusicXml(score([note(null, 0, 12), note(60, 12, 8), note(null, 20, 12)])));
    expect(ms).toHaveLength(2);
    expect(ms[0]!.at(-1)).toMatchObject({ pitch: 'C4', duration: 4, type: 'quarter', ties: ['start'] });
    expect(ms[1]![0]).toMatchObject({ pitch: 'C4', duration: 4, type: 'quarter', ties: ['stop'] });
  });

  it('fills every measure to exactly the bar length, padding the last with rests', () => {
    for (const [beatsPerBar, beatUnit, barTicks] of [
      [4, 4, 16],
      [3, 4, 12],
      [6, 8, 12],
    ] as const) {
      const notes = [note(60, 0, 5), note(62, 5, 3), note(null, 8, 3), note(64, 11, 9), note(65, 20, 7)];
      const ms = measures(toMusicXml(score(notes, { beatsPerBar, beatUnit })));
      for (const m of ms) expect(m.reduce((s, x) => s + x.duration, 0)).toBe(barTicks);
      const sounding = ms.flat().filter((x) => x.pitch !== null && !x.ties.includes('stop'));
      expect(sounding.map((x) => x.pitch)).toEqual(['C4', 'D4', 'E4', 'F4']);
    }
  });

  it('writes non-standard lengths as tied standard values', () => {
    const ms = measures(toMusicXml(score([note(67, 0, 5), note(null, 5, 11)])));
    expect(ms[0]!.slice(0, 2)).toMatchObject([
      { pitch: 'G4', duration: 4, type: 'quarter', ties: ['start'] },
      { pitch: 'G4', duration: 1, type: '16th', ties: ['stop'] },
    ]);
  });

  it('writes a syncopated quarter inside a half bar as one untied quarter', () => {
    const ms = measures(toMusicXml(score([note(60, 0, 2), note(62, 2, 4), note(64, 6, 2), note(65, 8, 8)])));
    expect(ms[0]!.map((x) => [x.pitch, x.type, x.ties])).toEqual([
      ['C4', 'eighth', []],
      ['D4', 'quarter', []],
      ['E4', 'eighth', []],
      ['F4', 'half', []],
    ]);
  });

  it('ties a quarter that straddles the middle of a 4/4 bar', () => {
    const ms = measures(toMusicXml(score([note(60, 0, 6), note(62, 6, 4), note(64, 10, 6)])));
    expect(ms[0]!.filter((x) => x.pitch === 'D4').map((x) => [x.type, x.ties])).toEqual([
      ['eighth', ['start']],
      ['eighth', ['stop']],
    ]);
  });

  it('writes dotted values', () => {
    const ms = measures(toMusicXml(score([note(72, 0, 12), note(null, 12, 4)])));
    expect(ms[0]![0]).toMatchObject({ pitch: 'C5', duration: 12, type: 'half', dots: 1, ties: [] });
  });

  it('emits header metadata: title, source, part name, key, time, clef, tempo, divisions', () => {
    const xml = toMusicXml(score([note(60, 0, 16)], { keyFifths: -2, beatsPerBar: 3, bpm: 87.6 }));
    const doc = parse(xml);
    const root = doc.documentElement as unknown as Element;
    expect(root.getAttribute('version')).toBe('4.0');
    expect(text(root, 'work-title')).toBe('Twinkle & Co');
    expect(xml).toContain('test.wav');
    expect(text(root, 'part-name')).toBe('Flute');
    expect(text(root, 'divisions')).toBe('4');
    expect(text(root, 'fifths')).toBe('-2');
    expect([text(root, 'beats'), text(root, 'beat-type')]).toEqual(['3', '4']);
    expect([text(root, 'sign'), text(root, 'line')]).toEqual(['G', '2']);
    expect(text(root, 'per-minute')).toBe('88');
    expect(root.getElementsByTagName('sound')[0]?.getAttribute('tempo')).toBe('87.6');
  });

  it('spells black keys with sharps in sharp keys and flats in flat keys', () => {
    const sharp = measures(toMusicXml(score([note(66, 0, 16)], { keyFifths: 1 })));
    const flat = measures(toMusicXml(score([note(70, 0, 16)], { keyFifths: -1 })));
    expect(sharp[0]![0]).toMatchObject({ pitch: 'F#4', accidental: null });
    expect(flat[0]![0]).toMatchObject({ pitch: 'Bb4', accidental: null });
  });

  it('shows accidentals that differ from the key signature, once per measure', () => {
    const ms = measures(toMusicXml(score([note(66, 0, 4), note(66, 4, 4), note(65, 8, 4), note(66, 12, 4)])));
    expect(ms[0]!.map((x) => [x.pitch, x.accidental])).toEqual([
      ['F#4', 'sharp'],
      ['F#4', null],
      ['F4', 'natural'],
      ['F#4', 'sharp'],
    ]);
  });

  it('writes grace notes without duration before their principal note', () => {
    const ms = measures(
      toMusicXml(score([{ midi: 62 as Midi, startTick: 0, durTicks: 0, ornament: 'grace' }, note(60, 0, 16)])),
    );
    expect(ms[0]!.map((x) => [x.pitch, x.grace, x.duration])).toEqual([
      ['D4', true, 0],
      ['C4', false, 16],
    ]);
  });

  it('keeps a grace note after a rest without doubling the rest', () => {
    const ms = measures(
      toMusicXml(
        score([note(60, 0, 4), { midi: 62 as Midi, startTick: 8, durTicks: 0, ornament: 'grace' }, note(64, 8, 8)]),
      ),
    );
    expect(ms[0]!.map((x) => [x.pitch, x.duration])).toEqual([
      ['C4', 4],
      [null, 4],
      ['D4', 0],
      ['E4', 8],
    ]);
  });

  it('writes a single whole-measure rest for an empty score', () => {
    const ms = measures(toMusicXml(score([])));
    expect(ms).toEqual([[expect.objectContaining({ pitch: null, duration: 16 })]]);
  });
});
