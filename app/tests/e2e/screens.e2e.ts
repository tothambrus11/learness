/** A picture of every exercise the app can deal, front and back.
 *
 *  Not a test of anything: a record. Set SCREENSHOTS_DIR and this file walks
 *  a sitting seeded with one card on each rung of the two new channels and
 *  the cloze rung, and writes a PNG of each face at phone width. Without the
 *  variable it does nothing, so the browser suite stays a suite.
 */
import { afterAll, beforeAll, test } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { findChromium } from './browser.js';
import { serveBuild } from './serve.js';
import type { Serving } from './serve.js';

const dir = process.env.SCREENSHOTS_DIR;
const executablePath = findChromium();
const run = dir && executablePath ? test : test.skip;

let site: Serving;
let browser: Browser;

beforeAll(async () => {
  if (!dir || !executablePath) return;
  await mkdir(dir, { recursive: true });
  site = await serveBuild();
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
});
afterAll(async () => { await browser?.close(); await site?.close(); });

const seed = (page: Page, key: string, channel: string, rung: string): Promise<void> =>
  page.evaluate((c) => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('cards', 'readwrite');
      tx.objectStore('cards').put({
        id: `${c.key}|${c.channel}|${c.rung}`, key: c.key, channel: c.channel, rung: c.rung,
        retired: false,
        due: new Date(Date.now() - 60_000), stability: 0, difficulty: 0, elapsed_days: 0,
        scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0,
        last_review: null, updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
    };
  }), { key, channel, rung });

/** Open a grammar bit, as the Grammar screen does: a form card is dealt only
 *  in a tense the learner has opened (GRAMMAR.md), so the verb's two rungs
 *  need theirs open before they can be walked. */
const openBit = (page: Page, id: string): Promise<void> =>
  page.evaluate((b) => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('bits', 'readwrite');
      tx.objectStore('bits').put({ id: b.id, openedAt: Date.now(), updatedAt: Date.now(), v: 1 });
      tx.oncomplete = () => resolve();
    };
  }), { id });

const setting = (page: Page, name: string, value: unknown): Promise<void> =>
  page.evaluate((s) => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ name: s.name, value: s.value });
      tx.oncomplete = () => resolve();
    };
  }), { name, value });

/** Each face to record: how to recognise the card by its task strip, what to
 *  do on its front before the back is worth a picture, and the file name. */
const FACES: { name: string; task: RegExp; front: (page: Page) => Promise<void> }[] = [
  { name: 'meet', task: /Meet it/, front: async (p) => { await p.locator('button.wide').click(); } },
  { name: 'choose', task: /Tap the word/, front: async (p) => {
    /* The sous card: a wrong tap first, so the retry is in the picture. */
    await p.locator('section.card .option', { hasText: /^sur/ }).click();
    await p.screenshot({ path: join(dir!, 'choose-retry.png'), fullPage: true });
    await p.locator('section.card .option', { hasText: /^sous/ }).click();
  } },
  { name: 'fill', task: /Fill the gap/, front: async (p) => {
    /* The dans card, answered with the English in mind: "on the train". */
    await p.locator('section.card input').fill('sur');
    await p.locator('section.card button.primary').click();
  } },
  { name: 'tense', task: /when is it/, front: async (p) => {
    /* "Elle a parlé": the imparfait first, so the retry is in the picture. */
    await p.locator('section.card .option', { hasText: /going on/ }).click();
    await p.screenshot({ path: join(dir!, 'tense-retry.png'), fullPage: true });
    await p.locator('section.card .option', { hasText: /done, once/ }).click();
  } },
  { name: 'voice', task: /Say the form/, front: async (p) => { await p.locator('button.wide').click(); } },
];

/** Deal the seeded cards, photographing each face in FACES as it comes up. */
async function walk(page: Page, faces: typeof FACES): Promise<void> {
  const left = new Set(faces.map((f) => f.name));
  for (let n = 0; n < 12 && left.size; n += 1) {
    await page.locator('section.card').waitFor();
    const asked = await page.locator('.task .verb').innerText();
    const face = faces.find((f) => left.has(f.name) && f.task.test(asked));
    if (face) {
      await page.screenshot({ path: join(dir!, `${face.name}-front.png`), fullPage: true });
      await face.front(page);
      await page.locator('.grades').waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir!, `${face.name}-back.png`), fullPage: true });
      left.delete(face.name);
    } else {
      /* A card that is not one of ours: answer it and move on. */
      const input = page.locator('section.card input');
      if (await input.count()) {
        await input.fill('x');
        await page.locator('section.card button.primary').click();
      } else if (await page.locator('section.card .option').count()) {
        await page.locator('section.card .option').first().click();
      } else {
        await page.locator('button.wide').click();
      }
      await page.locator('.grades').waitFor();
    }
    await page.locator('.grades button', { hasText: 'Good' }).click();
    await page.waitForTimeout(250);
  }
  if (left.size) throw new Error(`never dealt: ${[...left].join(', ')}`);
}

run('every new exercise, front and back, at phone width', async () => {
  /* One word per rung: a word has one active card per channel, so the three
     function words take the three sense rungs, and the one verb takes the
     two form rungs one sitting at a time. */
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  await setting(page, 'maxNewPerDay', 0);
  await seed(page, 'sur|prep', 'sense', 'meet');
  await seed(page, 'sous|prep', 'sense', 'choose');
  await seed(page, 'dans|prep', 'sense', 'fill');
  /* The which-time card needs its two times open, the voice card a tense
     with a form to say; nothing is asked in a tense that is not. */
  for (const id of ['V.pc', 'V.imparfait', 'V.pres-er']) await openBit(page, id);
  await seed(page, 'parler|verb', 'form', 'tense');
  await page.goto(`${site.url}/study/`);
  await walk(page, FACES.filter((f) => f.name !== 'voice'));

  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  await page.screenshot({ path: join(dir!, 'home.png'), fullPage: true });
  await seed(page, 'parler|verb', 'form', 'voice');
  await page.goto(`${site.url}/study/`);
  await walk(page, FACES.filter((f) => f.name === 'voice'));
  await context.close();
});

run('a word’s own page, for a verb and for a little word', async () => {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  for (const [name, key] of [['word-verb', 'parler%7Cverb'], ['word-function', 'sur%7Cprep']]) {
    await page.goto(`${site.url}/word/?k=${key}`);
    await page.locator('h1.fr').waitFor();
    const forms = page.locator('button.toggle', { hasText: 'Forms' });
    if (await forms.count()) await forms.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir!, `${name}.png`), fullPage: true });
  }
  await context.close();
});

run('starting a tense on the Grammar screen is what lets the next form card ask it', async () => {
  /* The complaint the gate answers: a verb's card asked for the imparfait
     of a learner who had never met it. Now nothing is asked until the
     learner has started the tense here, and what they start is what the
     card asks. */
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  await setting(page, 'maxNewPerDay', 0);
  await seed(page, 'parler|verb', 'form', 'voice');
  await page.locator('a[href$="/grammar/"]', { hasText: /pick a tense to start/ }).waitFor();

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card, .finished, .empty, main').first().waitFor();
  const asked = await page.locator('.task .verb').count();
  if (asked) {
    const task = await page.locator('.task .verb').innerText();
    if (/Say the form/.test(task)) throw new Error('a form card was dealt with no tense started');
  }

  await page.goto(`${site.url}/grammar/`);
  /* By the row's tense, not its text: every row below the présent names it
     in its "builds on" line. */
  await page.locator('li[data-tense="pres"] button.primary', { hasText: 'Start' }).click();
  await page.locator('li[data-tense="pres"] .tag.on').waitFor();
  await page.screenshot({ path: join(dir!, 'grammar.png'), fullPage: true });
  /* A group of drills unfolds, and a bit's lesson opens under its row with
     the way to start it at its foot. */
  await page.locator('h3 button.fold', { hasText: 'Saying no' }).click();
  await page.locator('li[data-rule="G.pas"] button.name').click();
  await page.locator('li[data-rule="G.pas"] .lesson button.primary', { hasText: 'Start this bit' }).waitFor();
  await page.screenshot({ path: join(dir!, 'grammar-lesson.png'), fullPage: true });

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  await page.locator('.task .verb', { hasText: /Say the form/ }).waitFor();
  const card = await page.locator('section.card').innerText();
  if (!/Présent/.test(card)) throw new Error(`the form card asks something other than the présent: ${card}`);

  await page.goto(`${site.url}/`);
  await page.locator('a[href$="/grammar/"]', { hasText: /1 tense open/ }).waitFor();
  await context.close();
});
