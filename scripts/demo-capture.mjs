import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [server, audio, out] = process.argv.slice(2);
if (!server || !audio || !out) {
  console.error('usage: node scripts/demo-capture.mjs <server> <audio.wav> <out dir>');
  process.exit(2);
}
const frames = join(out, 'frames');
mkdirSync(frames, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 0, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));

await page.goto(server, { waitUntil: 'networkidle0' });
await page.waitForSelector('.source-input');

let count = 0;
let recording = true;
const recorder = (async () => {
  while (recording) {
    const started = Date.now();
    const file = join(frames, `${String(count).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    count++;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 125 - (Date.now() - started))));
  }
})();
const mark = (name) => console.log(`${name} frame=${count} at=${Date.now()}`);

mark('input');
await new Promise((resolve) => setTimeout(resolve, 1500));
const picker = await page.$('input[type=file]');
await picker.uploadFile(audio);
const translate = await page.waitForSelector('.input-screen button.btn-primary', { timeout: 60_000 });
await new Promise((resolve) => setTimeout(resolve, 1500));
mark('translate');
await translate.click();
await page.waitForSelector('.result-screen .score-viewport:not(.is-rendering)', { timeout: 30 * 60_000 });
mark('result');
await new Promise((resolve) => setTimeout(resolve, 4000));
recording = false;
await recorder;
mark('end');

await page.screenshot({ path: join(out, 'result.png') });
const paperHeight = await page.evaluate(() => document.querySelector('.paper')?.scrollHeight ?? 0);
await page.setViewport({ width: 1100, height: paperHeight + 400, deviceScaleFactor: 2 });
await new Promise((resolve) => setTimeout(resolve, 1500));
await (await page.$('.paper')).screenshot({ path: join(out, 'sheet.png') });
console.log(`wrote ${count} frames to ${frames}`);
await browser.close();
