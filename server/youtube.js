export const MAX_TRACK_SECONDS = 8 * 60;

const ERROR_PATTERNS = [
  ['private', /private video|sign in if you've been granted access|members-only|join this channel/i],
  ['region_locked', /available in your country|geo.?restrict|blocked it in your country|available in your region/i],
  ['private', /sign in to confirm your age|age.?restricted|inappropriate for some users/i],
  ['invalid_url', /video unavailable|this video is unavailable|has been removed|does not exist|incomplete youtube id|unsupported url|is not a valid url/i],
];

export const STATUS_FOR_ERROR = {
  invalid_url: 400,
  private: 403,
  too_long: 413,
  region_locked: 451,
  network: 502,
};

export function classifyYtDlpFailure(stderr) {
  for (const [kind, pattern] of ERROR_PATTERNS) if (pattern.test(stderr)) return kind;
  return 'network';
}

export function parseYtDlpInfo(json) {
  if (typeof json?.id !== 'string' || typeof json?.title !== 'string') return { error: 'invalid_url' };
  if (json.is_live === true) return { error: 'invalid_url' };
  const durationSec = Number(json.duration);
  if (!Number.isFinite(durationSec)) return { error: 'invalid_url' };
  if (durationSec > MAX_TRACK_SECONDS) return { error: 'too_long' };
  return {
    info: {
      videoId: json.id,
      title: json.title,
      author: json.channel ?? json.uploader ?? '',
      thumbnail: json.thumbnail ?? `https://i.ytimg.com/vi/${json.id}/hqdefault.jpg`,
      durationSec,
    },
  };
}
