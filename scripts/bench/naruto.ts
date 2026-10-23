import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Truth, TruthNote } from './synth';

const REFERENCE_DIR = 'scripts/reference';
export const NARUTO_ID = 'VGS9nrEwXmw';
const TIMED_THROUGH_BAR = 32;
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (name: string) =>
  12 * (Number(name.slice(-1)) + 1) + LETTER[name[0]!]! + (name.includes('#') ? 1 : name.includes('b') ? -1 : 0);

export type Confidence = 'sure' | 'approx' | 'unsure';
type Alignment = { transpose: number; bpm: number; offsetSec: number; sectionShiftSec: Record<string, number> };

export type NarutoTruth = Omit<Truth, 'notes'> & {
  notes: (TruthNote & { bar: number; confidence: Confidence })[];
  windowSec: [number, number];
  unsureSec: [number, number][];
};

export function narutoTruth(): NarutoTruth {
  const text = readFileSync(join(REFERENCE_DIR, `${NARUTO_ID}.txt`), 'utf8');
  const align: Alignment = JSON.parse(readFileSync(join(REFERENCE_DIR, `${NARUTO_ID}.alignment.json`), 'utf8'));
  let beatsPerBar = 4;
  const beatSec = 60 / align.bpm;
  const secAt = (section: number, beat: number) => align.offsetSec + (align.sectionShiftSec[section] ?? 0) + beat * beatSec;
  const notes: NarutoTruth['notes'] = [];
  const unsureSec: [number, number][] = [];
  let endSec = 0;
  for (const raw of text.split('\n')) {
    const line = raw.startsWith('#') ? '' : raw.trim();
    if (!line) continue;
    const [head, kind, ...tokens] = line.split(/\s+/);
    if (head === 'meter') beatsPerBar = Number(kind);
    if (head === 'meter' || head === 'bpm' || kind === 'untimed') continue;
    const section = Number(head);
    let beat = (section - 1) * beatsPerBar;
    const sectionBeats = tokens.reduce((s, t) => s + Number(t.split(':')[1]), 0);
    if (kind === 'unsure') unsureSec.push([secAt(section, beat), secAt(section, beat + sectionBeats)]);
    for (const token of tokens) {
      const [pitch, length] = token.split(':');
      const beats = Number(length);
      const bar = Math.floor(beat / beatsPerBar) + 1;
      if (bar <= TIMED_THROUGH_BAR) {
        endSec = Math.max(endSec, secAt(section, beat + beats));
        if (pitch !== 'r') {
          notes.push({
            midi: midiOf(pitch!) + align.transpose,
            startSec: secAt(section, beat),
            endSec: secAt(section, beat + beats),
            beat,
            bar,
            confidence: kind as Confidence,
          });
        }
      }
      beat += beats;
    }
  }
  return { bpm: align.bpm, beatsPerBar, beatUnit: 4, notes, durationSec: endSec, windowSec: [secAt(1, 0), endSec], unsureSec };
}
