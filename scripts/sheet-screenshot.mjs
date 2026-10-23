import puppeteer from 'puppeteer-core';

const [server, source, out] = process.argv.slice(2);
if (!server || !source || !out) {
  console.error('usage: node scripts/sheet-screenshot.mjs <server> <youtube url> <out.png>');
  process.exit(2);
}
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 0, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
page.on('console', (m) => m.text().startsWith('[trowa]') && console.log(m.text()));
const started = Date.now();
await page.goto(server, { waitUntil: 'networkidle0' });
await page.waitForSelector('.source-input');
await page.type('.source-input', source);
await page.keyboard.press('Enter');
const translate = await page.waitForSelector('.input-screen button.btn-primary', { timeout: 60_000 });
await translate.click();
await page.waitForSelector('.result-screen .score-viewport:not(.is-rendering)', { timeout: 30 * 60_000 });
await new Promise((resolve) => setTimeout(resolve, Number(process.env.SETTLE_MS ?? 6000)));
const paper = await page.$('.paper');
await paper.screenshot({ path: out });
const summary = await page.evaluate(() => ({
  title: document.querySelector('.paper-title')?.textContent,
  measures: document.querySelectorAll('.score-viewport svg g.vf-measure').length,
}));
console.log(`wrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)} s`, JSON.stringify(summary));
await browser.close();
