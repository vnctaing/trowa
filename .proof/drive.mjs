import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PW ?? 'playwright-core');
const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://localhost:5181/';
const YT = 'https://www.youtube.com/watch?v=Trowa000001';
const headless = !process.env.HEADED;
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};

function check(ok, message) {
  note(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ channel: 'chrome', headless });

async function session(name, { viewport = { width: 1440, height: 900 }, mobile = false, reduced = false, video = false } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    acceptDownloads: true,
    recordVideo: video ? { dir: join(OUT, 'video-tmp'), size: viewport } : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, errors, name };
}

const shot = (page, file, opts = {}) => page.screenshot({ path: join(OUT, file), ...opts });
const fps = (page) => page.$eval('#field', (c) => Number(c.dataset.fps ?? 0));
const phase = (page, p) => page.waitForSelector(`.translating-screen[data-phase="${p}"]`, { timeout: 20000 });

async function enterLink(page, url) {
  await page.fill('.source-input', url);
  await page.waitForSelector('.source-card', { timeout: 5000 });
}

async function desktopRun() {
  const s = await session('desktop', { video: true });
  const { page } = s;
  await page.goto(`${BASE}?fake`);
  await page.waitForTimeout(1500);
  await shot(page, '01-input-empty.png');
  await enterLink(page, YT);
  await page.click('.options-toggle');
  await page.click('.stepper button[aria-label="Transpose up a semitone"]');
  await page.click('.stepper button[aria-label="Transpose down a semitone"]');
  await page.click('.segmented button:text("With ornaments")');
  await page.click('.segmented button:text("Melody only")');
  await page.waitForTimeout(1100);
  await shot(page, '02-input-recognized-options.png');
  check((await page.textContent('.source-title')) === 'Ode to Joy', 'recognized card shows the looked-up title');

  await page.click('.source-card .btn-primary');
  const samples = [];
  await phase(page, 'extracting');
  await page.waitForTimeout(1400);
  await shot(page, '03-extracting-audio-reactive-cloud.png');
  await page.waitForTimeout(2400);
  await shot(page, '04-extracting-nebula.png');
  samples.push(['extracting', await fps(page)]);
  await phase(page, 'separating');
  await page.waitForTimeout(2600);
  await shot(page, '05-separating-two-streams.png');
  samples.push(['separating', await fps(page)]);
  await phase(page, 'detecting');
  await page.waitForTimeout(3400);
  await shot(page, '06-detecting-pitch-lanes.png');
  samples.push(['detecting', await fps(page)]);
  await phase(page, 'notating');
  await page.waitForTimeout(2600);
  await shot(page, '07-notating-staff.png');
  samples.push(['notating', await fps(page)]);
  await phase(page, 'landing');
  await page.waitForTimeout(2000);
  await shot(page, '08-first-bar-formation.png');
  samples.push(['landing', await fps(page)]);
  await page.waitForSelector('.result-screen', { timeout: 10000 });
  await page.waitForTimeout(450);
  await shot(page, '09-crossfade-to-result.png');
  await page.waitForTimeout(2200);
  await shot(page, '10-result.png', { fullPage: true });
  const particles = await page.$eval('#field', (c) => c.dataset.particles);
  note(`desktop (while recording video + screenshots) particles=${particles} fps ${samples.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  check(!(await page.isVisible('.paper-warning')), 'no low-confidence warning at confidence 0.86');

  await page.click('.result-actions button:text("Play")');
  await page.waitForTimeout(2300);
  const lit = await page.$$eval('.score-zoom .is-playing', (els) => els.length);
  await shot(page, '11-playback-highlight.png');
  check(lit > 0, `playback highlights the current note (${lit} lit groups)`);
  await page.click('.result-actions button:text("Stop")');

  const keyBefore = await page.textContent('.transpose output');
  await page.click('.transpose button[aria-label="Transpose up"]');
  await page.waitForTimeout(1200);
  const keyAfter = await page.textContent('.transpose output');
  await shot(page, '12-transposed-up.png', { fullPage: true });
  check(keyBefore === 'Original' && keyAfter === '+1 st', `transpose label moves ${keyBefore} -> ${keyAfter}`);
  await page.click('.transpose button[aria-label="Transpose down"]');
  await page.waitForTimeout(800);

  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('button:text("Download PDF")')]);
  await pdf.saveAs(join(OUT, 'score.pdf'));
  const [xml] = await Promise.all([page.waitForEvent('download'), page.click('button:text("MusicXML")')]);
  await xml.saveAs(join(OUT, 'score.musicxml'));
  note(`downloads: ${pdf.suggestedFilename()} (${statSync(join(OUT, 'score.pdf')).size} bytes), ${xml.suggestedFilename()}`);

  await page.click('button:text("Start over")');
  await page.waitForSelector('.input-screen');
  check(true, 'start over returns to the input screen');
  check(s.errors.length === 0, `desktop run has no console errors ${JSON.stringify(s.errors)}`);
  const video = await page.video()?.path();
  await s.context.close();
  return video;
}

async function perfRun(particles) {
  const s = await session('perf');
  const { page } = s;
  await page.goto(`${BASE}?fake&fakeMs=6000${particles ? `&particles=${particles}` : ''}`);
  await enterLink(page, YT);
  await page.click('.source-card .btn-primary');
  const rows = [];
  for (const p of ['extracting', 'separating', 'detecting', 'notating', 'landing']) {
    await phase(page, p);
    await page.waitForTimeout(p === 'landing' ? 1500 : 2200);
    const reads = [];
    for (let k = 0; k < (p === 'landing' ? 1 : 3); k++) {
      await page.waitForTimeout(p === 'landing' ? 300 : 1050);
      reads.push(await page.$eval('#field', (c) => [Number(c.dataset.fps), Number(c.dataset.drawMs)]));
    }
    rows.push([p, Math.min(...reads.map((r) => r[0])), Math.max(...reads.map((r) => r[1]))]);
  }
  const count = await page.$eval('#field', (c) => c.dataset.particles);
  note(`perf particles=${count}: ${rows.map(([p, f, d]) => `${p} minFps=${f} drawMs=${d}`).join(' | ')}`);
  await s.context.close();
  return rows;
}

async function quickRun(name, url, { file, waitFor }) {
  const s = await session(name);
  await s.page.goto(`${BASE}?fake&fakeMs=700`);
  await s.page.fill('.source-input', url);
  if (waitFor === 'error-at-lookup') {
    await s.page.waitForSelector('.error-screen');
  } else {
    await s.page.waitForSelector('.source-card');
    await s.page.click('.source-card .btn-primary');
    await s.page.waitForSelector(waitFor === 'result' ? '.result-screen' : '.error-screen', { timeout: 20000 });
  }
  await s.page.waitForTimeout(2400);
  await shot(s.page, file, { fullPage: true });
  const result = waitFor === 'result'
    ? await s.page.isVisible('.paper-warning')
    : await s.page.$eval('.error-screen', (e) => `${e.dataset.error}: ${e.querySelector('h1')?.textContent}`);
  await s.context.close();
  return result;
}

async function mobileRun() {
  const s = await session('mobile', { viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await page.goto(`${BASE}?fake&fakeMs=3000`);
  await page.waitForTimeout(800);
  await shot(page, '15-mobile-input.png');
  await enterLink(page, YT);
  await page.tap('.source-card .btn-primary');
  await phase(page, 'detecting');
  await page.waitForTimeout(2600);
  await shot(page, '16-mobile-translating-detecting.png');
  const mobileFps = await fps(page);
  const particles = await page.$eval('#field', (c) => c.dataset.particles);
  await phase(page, 'landing');
  await page.waitForTimeout(2000);
  await shot(page, '17-mobile-first-bar.png');
  await page.waitForSelector('.result-screen', { timeout: 10000 });
  await page.waitForTimeout(2600);
  await shot(page, '18-mobile-result.png');
  note(`mobile particles=${particles} fps(headless emulation)=${mobileFps}`);
  check(particles === '1200', 'narrow viewport uses 30% of the desktop particle count');

  const cdp = await page.context().newCDPSession(page);
  const box = await page.$eval('.score-viewport', (e) => {
    e.scrollIntoView({ block: 'start' });
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.max(r.top, 0) + Math.min(r.height, window.innerHeight) / 3 };
  });
  const touch = (type, spread) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [
        { x: box.x - spread, y: box.y, id: 1 },
        { x: box.x + spread, y: box.y, id: 2 },
      ],
    });
  await touch('touchStart', 30);
  for (let spread = 40; spread <= 90; spread += 10) await touch('touchMove', spread);
  await touch('touchEnd', 0);
  await page.waitForTimeout(400);
  const zoom = await page.$eval('.score-zoom', (e) => e.style.zoom);
  const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await shot(page, '19-mobile-pinch-zoomed.png');
  check(Number(zoom) > 2 && pageScale === 1, `pinch zooms the score (zoom=${zoom}) and not the page (scale=${pageScale})`);
  check(s.errors.length === 0, `mobile run has no console errors ${JSON.stringify(s.errors)}`);
  await s.context.close();
}

async function reducedRun() {
  const s = await session('reduced', { reduced: true });
  const { page } = s;
  await page.goto(`${BASE}?fake&fakeMs=3000`);
  await enterLink(page, YT);
  await page.click('.source-card .btn-primary');
  await phase(page, 'separating');
  await page.waitForTimeout(300);
  await shot(page, '20-reduced-motion-crossfade.png');
  await page.waitForTimeout(1000);
  const checksum = () =>
    page.$eval('#field', (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]) | 0;
      return { h, phase: document.querySelector('.translating-screen')?.dataset.phase };
    });
  const a = await checksum();
  await page.waitForTimeout(500);
  const b = await checksum();
  check(a.h === b.h && a.phase === b.phase, `reduced motion: settled ${a.phase} formation is pixel-static across 500ms`);
  await shot(page, '21-reduced-motion-separating.png');
  await phase(page, 'landing');
  await page.waitForTimeout(1800);
  await shot(page, '22-reduced-motion-first-bar.png');
  await s.context.close();
}

mkdirSync(OUT, { recursive: true });
const video = await desktopRun();
const perf = await perfRun();
check(perf.every(([, f]) => f >= 55), 'desktop 4000 particles: every stage holds >= 55 fps headless (min of three 1s windows, no recording)');
await perfRun(12000);
check((await quickRun('dense', `${YT}&dense`, { file: '13-low-confidence-warning.png', waitFor: 'result' })) === true, 'dense mix shows the low-confidence warning');
note(`error private -> ${await quickRun('private', 'https://youtu.be/private0001', { file: '14-error-private.png', waitFor: 'error-at-lookup' })}`);
note(`error drums -> ${await quickRun('drums', 'https://youtu.be/drums000001', { file: '14b-error-no-melody.png', waitFor: 'error' })}`);
await mobileRun();
await reducedRun();
note('closing browser');
await browser.close();
note('browser closed');

if (video) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '4', '-t', '24', '-i', video, '-vf',
    'fps=8,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    join(OUT, 'translation-run.gif')]);
  renameSync(video, join(OUT, 'translation-run.webm'));
  rmSync(join(OUT, 'video-tmp'), { recursive: true, force: true });
}
note(`artifacts: ${readdirSync(OUT).filter((f) => !f.endsWith('.mjs')).join(', ')}`);
