import { describe, expect, it } from 'vitest';
import { MAX_TRACK_SECONDS as DOMAIN_MAX } from '../src/domain';
import { classifyYtDlpFailure, MAX_TRACK_SECONDS, parseYtDlpInfo } from './youtube.js';

describe('classifyYtDlpFailure', () => {
  it.each([
    ['ERROR: [youtube] yZIXLfi8CZQ: Private video. If the owner of this video has granted you access, please sign in.', 'private'],
    ['ERROR: [youtube] abc: Join this channel to get access to members-only content', 'private'],
    ['ERROR: [youtube] abc: The uploader has not made this video available in your country', 'region_locked'],
    ['ERROR: [youtube] abc: This video is not available in your country (geo restricted)', 'region_locked'],
    ['ERROR: [youtube] aaaaaaaaaaa: This video is unavailable', 'invalid_url'],
    ['ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader', 'invalid_url'],
    ['ERROR: [youtube] abc: Unable to download API page: <urlopen error timed out>', 'network'],
  ])('maps %j to %s', (stderr, kind) => {
    expect(classifyYtDlpFailure(stderr)).toBe(kind);
  });
});

describe('parseYtDlpInfo', () => {
  const base = { id: 'dQw4w9WgXcQ', title: 'Song', channel: 'Artist', thumbnail: 'https://i.ytimg.com/x.jpg', duration: 213 };

  it('maps yt-dlp JSON to the info shape', () => {
    expect(parseYtDlpInfo(base)).toEqual({
      info: { videoId: 'dQw4w9WgXcQ', title: 'Song', author: 'Artist', thumbnail: 'https://i.ytimg.com/x.jpg', durationSec: 213 },
    });
  });

  it('rejects tracks longer than the domain limit as too_long', () => {
    expect(MAX_TRACK_SECONDS).toBe(DOMAIN_MAX);
    expect(parseYtDlpInfo({ ...base, duration: DOMAIN_MAX })).toHaveProperty('info');
    expect(parseYtDlpInfo({ ...base, duration: DOMAIN_MAX + 1 })).toEqual({ error: 'too_long' });
  });

  it('rejects live streams and malformed JSON as invalid_url', () => {
    expect(parseYtDlpInfo({ ...base, is_live: true })).toEqual({ error: 'invalid_url' });
    expect(parseYtDlpInfo({ title: 'x' })).toEqual({ error: 'invalid_url' });
    expect(parseYtDlpInfo(null)).toEqual({ error: 'invalid_url' });
  });
});
