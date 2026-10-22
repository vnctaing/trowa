import type { GraphModel } from '@tensorflow/tfjs';
import { TrowaError, type Options, type PipelineEvent, type Score, type Source } from '../domain';
import { throwIfAborted } from './abort';
import { decodeAudio, PITCH_SAMPLE_RATE, toMonoPcm } from './decode';
import { buildScore } from './score';
import { separateLead } from './separate';
import { downloadYoutubeAudio } from './youtube';

export { toMusicXml } from './musicxml';
export { transposeScore } from './score';
export { lookupYoutube, type YoutubeInfo } from './youtube';

const MODEL_URL = '/models/basic-pitch/model.json';
const SEPARATE_URL = '/api/separate';

let model: Promise<GraphModel> | null = null;
function basicPitchModel(): Promise<GraphModel> {
  if (model === null) {
    model = import('@tensorflow/tfjs').then((tf) => tf.loadGraphModel(MODEL_URL)).catch(() => {
      model = null;
      throw new TrowaError('network');
    });
  }
  return model;
}

async function sourceBytes(source: Source, onEvent: (e: PipelineEvent) => void, signal?: AbortSignal) {
  if (source.kind === 'youtube') {
    return downloadYoutubeAudio(source.url, (fraction) => onEvent({ type: 'progress', stage: 'extracting', fraction }), signal);
  }
  return source.file.arrayBuffer().catch(() => {
    throw new TrowaError('decode_failed');
  });
}

function describeSource(source: Source): string {
  return source.kind === 'youtube' ? `${source.author} · youtube.com/watch?v=${source.videoId}` : source.file.name;
}

export async function runPipeline(
  source: Source,
  options: Options,
  onEvent: (e: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<Score> {
  throwIfAborted(signal);
  const modelReady = basicPitchModel();
  modelReady.catch(() => {});

  onEvent({ type: 'stage', stage: 'extracting' });
  const buffer = await decodeAudio(await sourceBytes(source, onEvent, signal));
  throwIfAborted(signal);
  onEvent({ type: 'audio', buffer });
  const mix = await toMonoPcm(buffer, PITCH_SAMPLE_RATE);
  throwIfAborted(signal);

  onEvent({ type: 'stage', stage: 'separating' });
  const lead = await separateLead(mix, { endpoint: SEPARATE_URL, signal });
  console.info(`[trowa] lead separation: ${lead.method}`);
  throwIfAborted(signal);

  onEvent({ type: 'stage', stage: 'detecting' });
  const { detectNotes } = await import('./pitch');
  const detection = await detectNotes(
    modelReady,
    lead.samples,
    (fraction) => onEvent({ type: 'progress', stage: 'detecting', fraction }),
    signal,
  );
  onEvent({ type: 'notes', notes: detection.notes });

  onEvent({ type: 'stage', stage: 'notating' });
  return buildScore(detection, options, { title: source.title, source: describeSource(source) });
}
