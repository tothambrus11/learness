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

async function openApp(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
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
