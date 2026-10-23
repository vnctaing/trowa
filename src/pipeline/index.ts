import { TrowaError, type Options, type PipelineEvent, type Score, type Source } from '../domain';
import { throwIfAborted } from './abort';
import { Analysis } from './analysis';
import { decodeAudio, PITCH_SAMPLE_RATE, toMonoPcm } from './decode';
import { buildScore } from './score';
import { downloadYoutubeAudio } from './youtube';

export { toMusicXml } from './musicxml';
export { transposeScore } from './score';
export { lookupYoutube, type YoutubeInfo } from './youtube';

const MODEL_URL = '/models/basic-pitch/model.json';
const SEPARATE_URL = '/api/separate';

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
  const analysis = new Analysis(signal);
  try {
    const backend = analysis.load(MODEL_URL);
    backend.then((name) => console.info(`[trowa] pitch backend: ${name} (worker)`), () => {});

    onEvent({ type: 'stage', stage: 'extracting' });
    const buffer = await decodeAudio(await sourceBytes(source, onEvent, signal));
    throwIfAborted(signal);
    onEvent({ type: 'audio', buffer });
    const signature = await analysis.hold(await toMonoPcm(buffer, PITCH_SAMPLE_RATE));
    throwIfAborted(signal);
    onEvent({ type: 'signature', signature });

    onEvent({ type: 'stage', stage: 'separating' });
    onEvent({ type: 'lead', lead: { method: 'filter', share: await analysis.emphasize() } });
    const demucsShare = await analysis.demucs(SEPARATE_URL);
    if (demucsShare !== null) onEvent({ type: 'lead', lead: { method: 'demucs', share: demucsShare } });
    console.info(`[trowa] lead separation: ${demucsShare === null ? 'filter' : 'demucs'}`);
    throwIfAborted(signal);

    onEvent({ type: 'stage', stage: 'detecting' });
    const detection = await analysis.detect(
      (fraction) => onEvent({ type: 'progress', stage: 'detecting', fraction }),
      (notes, throughSec) => onEvent({ type: 'notesFound', notes, throughSec }),
    );
    throwIfAborted(signal);
    onEvent({ type: 'notes', notes: detection.notes });

    onEvent({ type: 'stage', stage: 'notating' });
    return buildScore(detection, options, { title: source.title, source: describeSource(source) });
  } finally {
    analysis.close();
  }
}
