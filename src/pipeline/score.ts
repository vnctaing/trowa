import type { Score } from '../domain';
import { majorTonicToFifths } from './key';
import { foldIntoFlute } from './melody';

export function transposeScore(score: Score, semitones: number): Score {
  const tonic = (((score.keyFifths * 7) % 12) + 12) % 12;
  return {
    ...score,
    keyFifths: majorTonicToFifths(tonic + semitones),
    notes: score.notes.map((n) => (n.midi === null ? n : { ...n, midi: foldIntoFlute(n.midi + semitones) })),
  };
}
