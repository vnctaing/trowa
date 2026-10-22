import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVideoId } from '../src/pipeline/youtubeUrl.ts';
import { classifyYtDlpFailure, parseYtDlpInfo, STATUS_FOR_ERROR } from './youtube.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const MODEL_DIR = join(ROOT, 'node_modules/@spotify/basic-pitch/model');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5173);
const DEV = process.argv.includes('--dev');
const TOOL_PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`;
const DEMUCS_ENABLED = process.env.TROWA_DEMUCS !== 'off';
const DEMUCS_ARGS = [
  '--python', '3.11',
  '--with', 'torch==2.5.1',
  '--with', 'torchaudio==2.5.1',
  '--with', 'soundfile',
  '--from', 'demucs==4.0.1',
  'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-d', 'cpu',
];
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wav': 'audio/wav',
};

class HttpError extends Error {
  constructor(status, kind) {
    super(kind);
    this.status = status;
    this.kind = kind;
  }
}

const trowaError = (kind) => new HttpError(STATUS_FOR_ERROR[kind] ?? 500, kind);

function run(cmd, args, { timeoutMs = 120_000, cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: TOOL_PATH } }, (err, stdout, stderr) =>
      resolvePromise({ ok: !err, stdout, stderr: String(stderr) + (err && !stderr ? String(err.message) : '') }),
    );
  });
}

const inFlight = new Map();
function once(key, task) {
  if (!inFlight.has(key)) inFlight.set(key, task().finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

function videoIdFrom(searchParams) {
  const id = parseVideoId(searchParams.get('url') ?? '');
  if (id === null) throw trowaError('invalid_url');
  return id;
}

async function youtubeInfo(videoId) {
  const cached = join(CACHE, 'youtube', `${videoId}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8'));
  return once(`info:${videoId}`, async () => {
    const { ok, stdout, stderr } = await run('yt-dlp', ['--no-update', '--no-playlist', '-J', `https://www.youtube.com/watch?v=${videoId}`], {
      timeoutMs: 60_000,
    });
    if (!ok) throw trowaError(classifyYtDlpFailure(stderr));
    let json;
    try {
      json = JSON.parse(stdout);
    } catch {
      throw trowaError('network');
    }
    const parsed = parseYtDlpInfo(json);
    if (parsed.error) throw trowaError(parsed.error);
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, JSON.stringify(parsed.info));
    return parsed.info;
  });
}

async function youtubeAudio(videoId) {
  await youtubeInfo(videoId);
  const dir = join(CACHE, 'youtube');
  const wav = join(dir, `${videoId}.wav`);
  if (existsSync(wav)) return wav;
  return once(`audio:${videoId}`, async () => {
    const work = join(dir, `${videoId}.download`);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const dl = await run(
      'yt-dlp',
      ['--no-update', '--no-playlist', '-f', 'bestaudio/best', '-o', join(work, 'source.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`],
      { timeoutMs: 600_000 },
    );
    if (!dl.ok) throw trowaError(classifyYtDlpFailure(dl.stderr));
    const tmp = join(work, 'audio.wav');
    const source = (await readdir(work)).find((f) => f.startsWith('source.'));
    if (!source) throw trowaError('network');
    const conv = await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(work, source), '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', tmp], {
      timeoutMs: 300_000,
    });
    if (!conv.ok) throw trowaError('network');
    await rename(tmp, wav);
    await rm(work, { recursive: true, force: true });
    return wav;
  });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'too_long');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function separateVocals(body) {
  if (!DEMUCS_ENABLED) throw new HttpError(501, 'separation_unavailable');
  const hash = createHash('sha1').update(body).digest('hex');
  const dir = join(CACHE, 'separate', hash);
  const stem = join(dir, 'lead.wav');
  if (existsSync(stem)) return stem;
  return once(`separate:${hash}`, async () => {
    await mkdir(dir, { recursive: true });
    const input = join(dir, 'mix.wav');
    await writeFile(input, body);
    const started = Date.now();
    const demucs = await run('uvx', [...DEMUCS_ARGS, '-o', dir, input], { timeoutMs: 30 * 60_000 });
    const vocals = join(dir, 'htdemucs', 'mix', 'vocals.wav');
    if (!demucs.ok || !existsSync(vocals)) {
      console.warn(`[separate] demucs failed: ${demucs.stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
      throw new HttpError(501, 'separation_unavailable');
    }
    const tmp = join(dir, 'lead.tmp.wav');
    const conv = await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', vocals, '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', tmp]);
    if (!conv.ok) throw new HttpError(501, 'separation_unavailable');
    await rename(tmp, stem);
    console.log(`[separate] demucs ${hash.slice(0, 8)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return stem;
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file, contentType) {
  const { size } = await stat(file);
  res.writeHead(200, { 'content-type': contentType, 'content-length': size, 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

function insideDir(dir, requestPath) {
  const file = normalize(join(dir, decodeURIComponent(requestPath)));
  return file.startsWith(dir) ? file : null;
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/youtube/info') return sendJson(res, 200, await youtubeInfo(videoIdFrom(url.searchParams)));
  if (route === 'GET /api/youtube/audio') return sendFile(res, await youtubeAudio(videoIdFrom(url.searchParams)), 'audio/wav');
  if (route === 'POST /api/separate') return sendFile(res, await separateVocals(await readBody(req)), 'audio/wav');
  throw new HttpError(404, 'not_found');
}

async function serveStatic(req, res, url) {
  const file = insideDir(DIST, url.pathname === '/' ? '/index.html' : url.pathname);
  const target = file && existsSync(file) && (await stat(file)).isFile() ? file : join(DIST, 'index.html');
  if (!existsSync(target)) throw new HttpError(404, 'not_found');
  return sendFile(res, target, MIME[extname(target)] ?? 'application/octet-stream');
}

const vite = DEV
  ? await (await import('vite')).createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' })
  : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/models/basic-pitch/')) {
      const file = insideDir(MODEL_DIR, url.pathname.slice('/models/basic-pitch'.length));
      if (!file || !existsSync(file)) throw new HttpError(404, 'not_found');
      return await sendFile(res, file, MIME[extname(file)] ?? 'application/octet-stream');
    }
    if (vite) return vite.middlewares(req, res);
    return await serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.kind });
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'network' });
  }
});

server.listen(PORT, () => console.log(`trowa ${DEV ? 'dev' : 'prod'} server on http://localhost:${PORT}`));
