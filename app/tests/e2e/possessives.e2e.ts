/** The possessives sheet, as a person uses it: the table beside the work on
 *  a wide screen, the exercises beside it.
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

async function openApp(width: number, height: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('load', () => { if (errors.length) throw new Error(errors.join('\n')); });
  return page;
}

run('the table beside the exercises fits the window, and scrolls to its last line', async () => {
  /* Its padding sat outside its max-height, so the last notes were below
     the window and its own scroll stopped short of them (#107). A short
     window, so the table has to scroll at all. */
  const page = await openApp(1200, 560);
  await page.goto(`${site.url}/possessives/`);
  const aside = page.locator('aside#possessive-table');
  await aside.waitFor();
  const fit = await aside.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const box = el.getBoundingClientRect();
    return { bottom: box.bottom, window: window.innerHeight, scrolls: el.scrollHeight > el.clientHeight,
      atEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) <= 1 };
  });
  expect(fit.scrolls, 'the window is short enough for the table to scroll').toBe(true);
  expect(fit.bottom).toBeLessThanOrEqual(fit.window);
  expect(fit.atEnd).toBe(true);
  /* The last note's last example is on screen once scrolled to. */
  const last = page.locator('aside#possessive-table .notes li').last().locator('.eg-btn').last();
  const box = await last.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(560);
  await page.context().close();
});

/** A card answered once, straight into the app's own database. */
const studied = (page: Page, key: string): Promise<void> =>
  page.evaluate((k) => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('cards', 'readwrite');
      tx.objectStore('cards').put({
        id: `${k}|written|recognise`, key: k, channel: 'written', rung: 'recognise', retired: false,
        due: new Date(Date.now() + 86_400_000), stability: 1, difficulty: 5, elapsed_days: 0,
        scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2,
        last_review: new Date(), updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
    };
  }), key);

run('the exercises are made of the nouns you have studied, and a noun says what it is when pointed at', async () => {
  /* The drills were all the sheet's own nouns, whatever the learner had
     studied, and a noun gave no clue to its meaning or gender (#110). */
  const page = await openApp(1200, 900);
  await page.goto(`${site.url}/possessives/`);
  await page.locator('section.exercise').first().waitFor();
  await studied(page, 'train|noun');
  await studied(page, 'pont|noun');
  await page.reload();
  await page.locator('section.exercise').first().waitFor();
  /* The whole table, from memory, takes its masculine noun from the studied. */
  const table = page.locator('section.exercise', { hasText: 'Le tableau' });
  const noun = table.locator('.noun').first();
  expect(await noun.innerText()).toMatch(/^(train|pont)\b/);
  /* The instruction is the task, not the nouns (they read as the answers). */
  expect(await table.locator('.instruction').innerText()).not.toMatch(/train|pont/);
  const name = (await noun.innerText()).split('\n')[0]!.trim();
  await noun.hover();
  const gloss = noun.locator('.gloss');
  await gloss.waitFor({ state: 'visible' });
  expect(await gloss.innerText()).toMatch(/ · (masculine|feminine)( plural)?$/);
  if (name === 'train') expect(await gloss.innerText()).toBe('train · masculine');
  if (name === 'pont') expect(await gloss.innerText()).toBe('bridge · masculine');
  await page.context().close();
});
