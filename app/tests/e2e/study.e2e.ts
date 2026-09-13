/** The app as a person meets it: a real browser, a real IndexedDB, the built
 *  bundle, and the catalogue served beside it.
 *
 *  These are the tests for the things a unit test cannot see — that the
 *  numbers on the home screen move after a sitting, that the audio plays when
 *  the card turns over, that the tab row does not shift when you tap it. Each
 *  of those was a bug, and each was invisible to everything below this line.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { findChromium } from './browser.js';
import { serveBuild } from './serve.js';
import type { Serving } from './serve.js';

const executablePath = findChromium();
const describeOrSkip = executablePath ? test : test.skip;

let site: Serving;
let browser: Browser;

beforeAll(async () => {
  if (!executablePath) {
    console.warn('No Chromium found: set CHROME_PATH to run the browser tests.');
    return;
  }
  site = await serveBuild();
  browser = await chromium.launch({
    executablePath,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

/** A fresh device: its own storage, and a record of every clip it played. */
async function openApp(): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addInitScript(() => {
    (window as unknown as { played: string[] }).played = [];
    /* eslint-disable-next-line typescript/unbound-method -- it is rebound below */
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playAndRecord(this: HTMLMediaElement) {
      (window as unknown as { played: string[] }).played.push(this.src.split('/').pop() ?? '');
      return play.call(this).catch(() => {});
    };
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('load', () => { if (errors.length) throw new Error(errors.join('\n')); });
  return { page, context };
}

const played = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { played: string[] }).played.slice());
const clearPlayed = (page: Page): Promise<void> =>
  page.evaluate(() => { (window as unknown as { played: string[] }).played.length = 0; });

/** Everything the card shows, without what the live card lets you do about
 *  it: the same word looked back at has the same face and no aids. */
const face = (page: Page): Promise<string> =>
  page.locator('section.card').evaluate((card) => {
    const copy = card.cloneNode(true) as HTMLElement;
    copy.querySelector('.aids')?.remove();
    return copy.textContent ?? '';
  });

/** Answer the card on screen Good, whatever it asks. Returns what it asked. */
async function answerOne(page: Page): Promise<string> {
  const asked = await page.locator('.task .verb').innerText();
  const input = page.locator('section.card input');
  if (await input.count()) {
    await input.fill('x');
    await page.locator('section.card button.primary').click();
  } else {
    await page.locator('button.wide').click();
  }
  await page.locator('.grades').waitFor();
  await page.waitForTimeout(350);
  return asked;
}

async function grade(page: Page): Promise<void> {
  await page.locator('.grades button', { hasText: 'Good' }).click();
  await page.waitForTimeout(250);
}

const stats = (page: Page): Promise<string[]> =>
  page.locator('.stat').allInnerTexts();

describeOrSkip('a sitting moves the numbers on the home screen', async () => {
  const { page, context } = await openApp();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  expect(await stats(page)).toEqual(
    expect.arrayContaining([expect.stringContaining('new left today')]));
  const before = await stats(page);

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  for (let i = 0; i < 3; i += 1) { await answerOne(page); await grade(page); }

  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  const after = await stats(page);
  expect(after).not.toEqual(before);
  expect((await page.locator('.links').innerText())).toContain('Today: 3 done');
  await context.close();
});

describeOrSkip('the day’s new words run out, and the sitting turns to review', async () => {
  const { page, context } = await openApp();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  /* Two new words a day, so the ceiling is reached inside one sitting. */
  await page.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ name: 'maxNewPerDay', value: 2 });
      tx.oncomplete = () => resolve();
    };
  }));

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  for (let i = 0; i < 2; i += 1) { await answerOne(page); await grade(page); }

  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  expect(await page.locator('.reason').innerText()).toContain('new words are done');
  await context.close();
});

describeOrSkip('every flip ends in the French, except where the card was the French',
  async () => {
    const { page, context } = await openApp();
    await page.goto(`${site.url}/study/`);
    await page.locator('section.card').waitFor();
    for (let i = 0; i < 4; i += 1) {
      await clearPlayed(page);
      const asked = await answerOne(page);
      const heard = await played(page);
      if (/Listen/.test(asked)) {
        expect(heard, `${asked} played the French again over its own answer`).toHaveLength(0);
      } else {
        expect(heard.length, `${asked} said nothing after the flip`).toBeGreaterThan(0);
      }
      await grade(page);
    }
    await context.close();
  });

describeOrSkip('a card you look back at shows everything it showed when you answered it',
  async () => {
    /* The verb's forms used to be drawn under the grading buttons, so pressing
       ← showed the card without them: the one card with something more on it
       than a word lost the part that made it worth looking back at. */
    const { page, context } = await openApp();
    await page.goto(`${site.url}/study/`);
    await page.locator('section.card').waitFor();

    /* Answer cards until the verb comes up, and stop with it revealed. */
    let forms = 0;
    for (let n = 0; n < 5 && !forms; n += 1) {
      await answerOne(page);
      forms = await page.locator('section.card .forms-toggle').count();
      if (!forms) await grade(page);
    }
    expect(forms, 'no verb came up in the whole sitting').toBe(1);

    /* Open them, so what is compared is the table itself and not a shut
       drawer. */
    await page.locator('section.card .forms-toggle').click();
    await page.locator('section.card .rows').waitFor();
    const live = await face(page);
    expect(live).toContain('parlons');

    await grade(page);
    await page.locator('.lookback button').click();
    await page.locator('.dir').waitFor();
    expect(await face(page)).toEqual(live);
    await context.close();
  });

describeOrSkip('a verb’s forms are said with their pronoun, one line at a time', async () => {
  /* A form on its own is not what anyone hears: "parle" is three spellings and
     one sound, and the pronoun is what tells them apart. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  let forms = 0;
  for (let n = 0; n < 5 && !forms; n += 1) {
    await answerOne(page);
    forms = await page.locator('section.card .forms-toggle').count();
    if (!forms) await grade(page);
  }
  await page.locator('section.card .forms-toggle').click();
  const line = page.locator('section.card button.f', { hasText: 'parlons' });
  await line.waitFor();
  expect(await line.getAttribute('aria-label')).toBe('Hear “nous parlons”');
  /* Nothing to play on a machine with no voice and no model; it must not
     throw, and the table must still be a table. */
  await line.hover();
  await line.click();
  await page.waitForTimeout(300);
  expect(await page.locator('section.card .rows .row').count()).toBeGreaterThan(5);
  await context.close();
});

describeOrSkip('a card whose recording is gone says so instead of going quiet', async () => {
  /* The recording 404s and this browser has no French voice, so there is
     nothing left to hear — which is exactly when the card has to say a word.
     It used to fail in the console: "Content-Type text/html is not supported",
     twice, and the button did nothing. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  let said = false;
  for (let n = 0; n < 6 && !said; n += 1) {
    await answerOne(page);
    said = await page.locator('section.card', { hasText: 'recording is missing' })
      .count() > 0 || await page.locator('section.card .incomplete').count() > 0;
    if (!said) await grade(page);
  }
  await page.locator('section.card .incomplete').first()
    .waitFor({ timeout: 10000 });
  expect(await page.locator('section.card .incomplete').first().innerText())
    .toContain('recording is missing');
  await context.close();
});

describeOrSkip('the tab row does not shift when a tab is lit', async () => {
  const { page, context } = await openApp();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${site.url}/`);
  await page.locator('nav.tabs a').first().waitFor();
  /* The links and the labels inside them: bolding the lit tab moved the row,
     and reserving the bold width without centring moved the words inside it. */
  const boxes = async (selector: string): Promise<number[]> =>
    page.locator(selector).evaluateAll((nodes) =>
      nodes.map((n) => Math.round(n.getBoundingClientRect().x * 100) / 100));

  /* The words themselves, not the boxes around them: the box is a fixed width
     by then, and the text inside it is what would slide. */
  const words = async (): Promise<number[]> =>
    page.locator('nav.tabs a span').evaluateAll((spans) => spans.map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      return Math.round(range.getBoundingClientRect().x * 10) / 10;
    }));

  const links = await boxes('nav.tabs a');
  const labels = await words();
  await page.locator('nav.tabs a', { hasText: 'Words' }).click();
  await page.locator('nav.tabs a.on', { hasText: 'Words' }).waitFor();
  expect(await boxes('nav.tabs a')).toEqual(links);
  /* The lit tab's own word does grow bolder and so does start a shade further
     left; every other one must not move at all. */
  const after = await words();
  expect(after.filter((_, i) => i !== 1)).toEqual(labels.filter((_, i) => i !== 1));
  await context.close();
});
