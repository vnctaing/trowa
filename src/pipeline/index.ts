import type { Options, PipelineEvent, Score, Source } from '../domain';

export async function runPipeline(
  source: Source,
  options: Options,
  onEvent: (e: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<Score> {
  void source; void options; void onEvent; void signal;
  throw new Error('not implemented');
}

export function transposeScore(score: Score, semitones: number): Score {
  void semitones;
  return score;
}

export function toMusicXml(score: Score): string {
  void score;
  throw new Error('not implemented');
}

export type YoutubeInfo = { videoId: string; title: string; author: string; thumbnail: string; durationSec: number };

export async function lookupYoutube(url: string, signal?: AbortSignal): Promise<YoutubeInfo> {
  void url; void signal;
  throw new Error('not implemented');
}
