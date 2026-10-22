import { TrowaError, type ErrorKind } from '../domain';

export const ERROR_COPY: Record<ErrorKind, { title: string; body: string }> = {
  invalid_url: {
    title: 'That link didn’t lead to a song',
    body: 'Paste a full YouTube link (youtube.com/watch?v=… or youtu.be/…), or drop an MP3 or WAV file instead.',
  },
  private: {
    title: 'This video is private',
    body: 'Only its owner can play it, so we can’t listen to it either. Try a public upload of the same song.',
  },
  region_locked: {
    title: 'Not available from here',
    body: 'This video is blocked in the region our server listens from. Another upload of the song often works.',
  },
  too_long: {
    title: 'That track is longer than 8 minutes',
    body: 'Trowa writes sheets for single songs. Try a shorter cut, or trim the file to the part you want to play.',
  },
  no_melody: {
    title: 'We couldn’t hear a melody',
    body: 'The track seems to be mostly drums or texture, with no line a flute could carry. Try a song with a clear tune.',
  },
  decode_failed: {
    title: 'We couldn’t read that file',
    body: 'It may be damaged or in a format we don’t support yet. MP3 and WAV files work best.',
  },
  network: {
    title: 'The connection dropped',
    body: 'We lost touch with the server while working on your song. Check your connection and try again.',
  },
};

export type Failure = { kind: 'aborted' } | { kind: 'failed'; error: ErrorKind };

export function classify(err: unknown): Failure {
  if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'aborted' };
  if (err instanceof TrowaError) return { kind: 'failed', error: err.kind };
  reportUnexpected(err);
  return { kind: 'failed', error: 'network' };
}

function reportUnexpected(err: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[trowa] unexpected failure', err);
  navigator.sendBeacon('/api/client-error', `${navigator.userAgent}\n${detail}`);
}
