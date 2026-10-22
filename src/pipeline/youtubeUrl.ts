const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const PATH_ID = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

export function parseVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : (PATH_ID.exec(url.pathname)?.[1] ?? null);
  }
  return id !== null && VIDEO_ID.test(id) ? id : null;
}
