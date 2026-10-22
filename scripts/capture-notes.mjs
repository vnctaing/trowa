import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [target, separation = 'demucs', server = 'http://localhost:5320'] = process.argv.slice(2);
if (!target || !['demucs', 'filter'].includes(separation)) {
  console.error('usage: node scripts/capture-notes.mjs <youtubeId | /path/to/file.wav> [demucs|filter] [server]');
  process.exit(2);
}
const isWav = target.endsWith('.wav');
const name = isWav ? target.split('/').pop().replace(/\.wav$/, '') : target;
const out = join('.cache/notes', `${name}-${separation}.json`);
if (existsSync(out) && !process.env.FORCE) {
  console.log(`${out} exists, set FORCE=1 to recapture`);
  process.exit(0);
}

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 0, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => console.log(`console.${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
const query = new URLSearchParams({ mode: 'capture', sep: separation, ...(isWav ? { wav: target } : { yt: target }) });
const started = Date.now();
await page.goto(`${server}/scripts/browser-harness.html?${query}`);
await page.waitForFunction('window.__done === true', { timeout: 30 * 60_000, polling: 1000 });
const capture = await page.evaluate(() => window.__capture ?? null);
await browser.close();
if (!capture) {
  console.error('capture failed, see console output above');
  process.exit(1);
}
mkdirSync('.cache/notes', { recursive: true });
writeFileSync(out, JSON.stringify(capture));
console.log(`wrote ${out}: ${capture.notes.length} notes, ${capture.durationSec.toFixed(1)} s audio, ${((Date.now() - started) / 1000).toFixed(1)} s`);
