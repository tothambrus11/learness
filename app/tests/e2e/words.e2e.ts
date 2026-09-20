/** The words screen and a word's own page, as a person uses them.
 *
 *  A word added from the search is a line in the list; the line is the way
 *  to the page about it (#42), and the page says what the card will: the
 *  spelling with its article, how it is said, what it means, and that it is
 *  up next. The same page reached by its address, with no list behind it,
 *  is the same page.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { findChromium } from './browser.js';
import { serveBuild } from './serve.js';
import type { Serving } from './serve.js';

const executablePath = findChromium();
const run = executablePath ? test : test.skip;

let site: Serving;
let browser: Browser;

beforeAll(async () => {
  if (!executablePath) return;
  site = await serveBuild();
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
});
afterAll(async () => { await browser?.close(); await site?.close(); });

async function openApp(width = 420): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('load', () => { if (errors.length) throw new Error(errors.join('\n')); });
  return page;
}

run('a word added from the search leads to a page that says what the card will', async () => {
  const page = await openApp();
  await page.goto(`${site.url}/words/`);
  await page.locator('input[type=text]').fill('train');
  await page.locator('.hits button', { hasText: 'Add' }).first().waitFor();
  /* A hit is the word and what it means. Its level in the catalogue's
     ranking was printed beside it, and meant nothing to the learner (#75). */
  expect(await page.locator('.hits').innerText()).not.toMatch(/level \d/);
  await page.locator('.hits button', { hasText: 'Add' }).first().click();
  await expect.poll(() => page.locator('.notice').innerText()).toContain('up next');

  /* The word in its row is the link. */
  await page.locator('.list a.word-link', { hasText: 'train' }).click();
  await page.waitForURL(/\/word\/\?k=train%7Cnoun/);
  await page.locator('h1.fr').waitFor();
  expect(await page.locator('h1.fr').innerText()).toBe('le train');
  expect(await page.locator('.ipa').innerText()).toBe('/tʁɛ̃/');
  expect(await page.locator('.head .status').innerText()).toBe('up next');
  expect(await page.locator('.ladders tbody tr').count()).toBe(1);
  /* The bar names the word, so the page says where you are. */
  expect(await page.locator('header').innerText()).toContain('le train');

  /* A verb the list has never seen, straight from its address: the same
     page, with its table, its sentences and what it governs — and a way to
     study it next. */
  await page.goto(`${site.url}/word/?k=parler%7Cverb`);
  await page.locator('h1.fr').waitFor();
  expect(await page.locator('h1.fr').innerText()).toBe('parler');
  expect(await page.locator('.chunks').innerText()).toContain('parler de qch');
  expect(await page.locator('.examples mark').first().innerText()).toBe('parle');
  await page.locator('button.toggle', { hasText: 'Forms' }).click();
  /* The table splits stem from ending, so the line is looked for by its pronoun and its ending. */
  expect(await page.locator('.tenses').first().innerText()).toMatch(/nous\s+parl\s*ons/);
  await page.locator('button', { hasText: 'Study it next' }).click();
  await expect.poll(() => page.locator('.head .status').innerText()).toBe('up next');

  /* A key nothing knows is said so, not a blank page. */
  await page.goto(`${site.url}/word/?k=nothing%7Cnoun`);
  await expect.poll(() => page.locator('main').innerText()).toContain('Nothing here knows');
  await page.context().close();
});

run('a long word with a long gloss and a note stays inside a phone\'s width', async () => {
  /* On a phone the list scrolled sideways (#72): the row is the text on the
     left and the controls on the right, and neither half could give — the
     text would not shrink below its longest word and the controls would not
     shrink at all — so a headword with no space in it pushed the remove
     button off the edge of the screen. Now the text takes what the controls
     leave, the gloss and the note wrap under the headword, a word too long
     for the line breaks rather than leaving it, and the controls stay on one
     line, on the screen. The record is the learner's own kind: pasted in
     under a lesson label, with a note. */
  const page = await openApp(390);
  await page.goto(`${site.url}/words/`);
  await page.locator('.list h2').waitFor();
  await page.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('words', 'readwrite');
      tx.objectStore('words').put({
        k: 'anticonstitutionnellement|adv', fr: 'anticonstitutionnellement',
        en: ['unconstitutionally', 'in a way that goes against the constitution',
          'the longest word in the dictionary, and a joke about it'],
        pos: 'adv', source: 'app', lesson: 'French A1 — Lesson 6',
        note: 'said of a law, never of a person; the teacher used it to make the class laugh',
        addedAt: Date.now(), updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
    };
  }));
  await page.reload();
  const remove = page.locator('.list button[aria-label^="Remove"]');
  await remove.waitFor();
  await page.waitForTimeout(200);

  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `the words screen scrolls sideways by ${sideways}px`).toBeLessThanOrEqual(0);
  /* The controls: inside the screen, and on one line. */
  const boxes = await page.locator('.list .controls > *').evaluateAll((nodes) =>
    nodes.map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, mid: r.top + r.height / 2 }; }));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  for (const b of boxes) {
    expect(b.l).toBeGreaterThanOrEqual(0);
    expect(b.r).toBeLessThanOrEqual(390);
    expect(Math.abs(b.mid - boxes[0]!.mid)).toBeLessThanOrEqual(1);
  }
  /* And the text is all still there, under the headword rather than cut. */
  const text = await page.locator('.list .word').innerText();
  expect(text).toContain('a joke about it');
  expect(text).toContain('the class laugh');
  /* The lesson the word was pasted in under is not on its row: it was the
     widest thing there and said nothing the learner wanted (#75). */
  expect(text).not.toContain('Lesson 6');
  await page.context().close();
});

run('a word of your own with no audio says so on its row, and the offer to make it asks before any download', async () => {
  /* The audio for your own words is made in the background by the voice on
     the device; this machine has none, so the backlog holds and the row
     reads exactly as it did before there was a backlog: "No audio yet", a
     button, and behind the button the question about the 380 MB — or the
     reason it cannot be fetched — never the download itself. */
  const page = await openApp();
  await page.goto(`${site.url}/words/`);
  await page.locator('.list h2').waitFor();
  await page.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('words', 'readwrite');
      tx.objectStore('words').put({
        k: 'natel|noun', fr: 'natel', en: ['mobile phone'], pos: 'noun', gender: 'm',
        source: 'app', addedAt: Date.now(), updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
    };
  }));
  await page.reload();
  const voice = page.locator('.list .voice');
  await voice.waitFor();
  expect(await voice.innerText()).toContain('No audio yet');
  await voice.locator('button', { hasText: 'Make audio' }).click();
  await expect.poll(() => voice.innerText()).toMatch(/MB|voice|offline|connection/i);
  const notNow = voice.locator('button', { hasText: 'Not now' });
  if (await notNow.count()) {
    await notNow.click();
    await expect.poll(() => voice.innerText()).toContain('No audio yet');
  }
  /* And the word's own page says the same, under its name. */
  await page.goto(`${site.url}/word/?k=natel%7Cnoun`);
  await page.locator('h1.fr').waitFor();
  expect(await page.locator('.head .voice').innerText()).toContain('No audio yet');
  await page.context().close();
});

