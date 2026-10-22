import { TrowaError, type ErrorKind } from '../domain';
import { throwIfAborted } from './abort';
import { parseVideoId } from './youtubeUrl';

export type YoutubeInfo = { videoId: string; title: string; author: string; thumbnail: string; durationSec: number };

const ERROR_KINDS: ReadonlySet<string> = new Set<ErrorKind>([
  'invalid_url',
  'private',
  'region_locked',
  'too_long',
  'no_melody',
  'decode_failed',
  'network',
]);

function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === 'string' && ERROR_KINDS.has(value);
}

async function request(path: string, signal: AbortSignal | undefined): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { signal });
  } catch {
    throwIfAborted(signal);
    throw new TrowaError('network');
  }
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  const kind = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
  throw new TrowaError(isErrorKind(kind) ? kind : 'network');
}

function parseInfo(body: unknown): YoutubeInfo {
  if (typeof body !== 'object' || body === null) throw new TrowaError('network');
  const b = body as Record<string, unknown>;
  const { videoId, title, author, thumbnail, durationSec } = b;
  if (
    typeof videoId !== 'string' ||
    typeof title !== 'string' ||
    typeof author !== 'string' ||
    typeof thumbnail !== 'string' ||
    typeof durationSec !== 'number'
  ) {
    throw new TrowaError('network');
  }
  return { videoId, title, author, thumbnail, durationSec };
}

const query = (url: string) => `url=${encodeURIComponent(url)}`;

export async function lookupYoutube(url: string, signal?: AbortSignal): Promise<YoutubeInfo> {
  if (parseVideoId(url) === null) throw new TrowaError('invalid_url');
  const response = await request(`/api/youtube/info?${query(url)}`, signal);
  return parseInfo(await response.json().catch(() => null));
}

export async function downloadYoutubeAudio(
  url: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await request(`/api/youtube/audio?${query(url)}`, signal);
  const total = Number(response.headers.get('content-length'));
  const reader = response.body?.getReader();
  if (!reader || !Number.isFinite(total) || total <= 0) return response.arrayBuffer();
  const bytes = new Uint8Array(total);
  let received = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes.set(chunk.value.subarray(0, total - received), received);
      received += chunk.value.length;
      onProgress(Math.min(1, received / total));
    }
  } catch {
    throwIfAborted(signal);
    throw new TrowaError('network');
  }
  return bytes.buffer;
}
