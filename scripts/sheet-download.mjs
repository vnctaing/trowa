import { existsSync, readdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const [server, source, outDir] = process.argv.slice(2);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  protocolTimeout: 0,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const client = await page.createCDPSession();
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
page.on('console', (m) => m.text().startsWith('[trowa]') && console.log(m.text()));
await page.goto(server, { waitUntil: 'networkidle0' });
await page.waitForSelector('.source-input');
await page.type('.source-input', source);
await page.keyboard.press('Enter');
const translate = await page.waitForSelector('.input-screen button.btn-primary', { timeout: 60_000 });
await translate.click();
await page.waitForSelector('.result-screen .score-viewport:not(.is-rendering)', { timeout: 30 * 60_000 });
const clickButton = async (text) => {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t), text);
  await handle.click();
};
await clickButton('MusicXML');
const started = Date.now();
while (Date.now() - started < 120_000) {
  await new Promise((r) => setTimeout(r, 1000));
  const enabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Audio');
    return b && !b.disabled;
  });
  if (enabled) break;
}
await clickButton('Audio');
await new Promise((r) => setTimeout(r, 8000));
console.log(
  'downloads:',
  readdirSync(outDir)
    .filter((f) => /\.(wav|musicxml)$/.test(f))
    .join(', '),
);
await browser.close();
