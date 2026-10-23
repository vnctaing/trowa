import { TrowaError, type Options, type Score } from '../domain';
import { estimateKeyFifths, majorTonicToFifths } from './key';
import { applyDifficulty, foldIntoFlute, reduceToLine } from './melody';
import type { Detection } from './pitch';
import { estimateTempo, guessMeter, quantize, sixteenthSec, type Notation } from './quantize';

const MIN_MELODY_NOTES = 8;
const MIN_CONFIDENCE = 0.2;
const MIN_VOICED_FRACTION = 0.03;
const FULLY_VOICED_FRACTION = 0.5;
const PLAUSIBLE_NOTES_PER_SEC = [0.3, 8] as const;
const NOTATION: Record<Options['difficulty'], Notation> = {
  melody: { gridTicks: 2, legatoTicks: 4 },
  ornaments: { gridTicks: 1, legatoTicks: 4 },
};

function densityPlausibility(notesPerSec: number): number {
  const [low, high] = PLAUSIBLE_NOTES_PER_SEC;
  if (notesPerSec < low) return notesPerSec / low;
  if (notesPerSec > high) return high / notesPerSec;
  return 1;
}

export function buildScore(
  detection: Detection,
  options: Options,
  meta: Pick<Score, 'title' | 'source'>,
): Score {
  const line = reduceToLine(detection.notes, options.transpose);
  const first = line[0];
  const last = line.at(-1);
  const tooSparse = line.length < MIN_MELODY_NOTES || detection.voicedFraction < MIN_VOICED_FRACTION;
  if (first === undefined || last === undefined || tooSparse) throw new TrowaError('no_melody');

  const spanSec = last.onsetSec + last.durSec - first.onsetSec;
  const soundingSec = line.reduce((s, x) => s + x.durSec, 0);
  const voiced = Math.min(1, detection.voicedFraction / FULLY_VOICED_FRACTION);
  const coverage = soundingSec / spanSec;
  const confidence = (0.6 * voiced + 0.4 * coverage) * densityPlausibility(line.length / spanSec);
  if (confidence < MIN_CONFIDENCE) throw new TrowaError('no_melody');

  const bpm = options.tempoOverride ?? estimateTempo(line.map((x) => x.onsetSec));
  const notes = quantize(applyDifficulty(line, options.difficulty, sixteenthSec(bpm)), bpm, NOTATION[options.difficulty]);
  return {
    ...meta,
    bpm,
    ...guessMeter(notes),
    keyFifths: options.key === 'auto' ? estimateKeyFifths(notes) : options.key,
    notes,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export function transposeScore(score: Score, semitones: number): Score {
  const tonic = (((score.keyFifths * 7) % 12) + 12) % 12;
  return {
    ...score,
    keyFifths: majorTonicToFifths(tonic + semitones),
    notes: score.notes.map((n) => (n.midi === null ? n : { ...n, midi: foldIntoFlute(n.midi + semitones) })),
  };
}
