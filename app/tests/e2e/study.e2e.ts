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
 *  it: the same word looked back at has the same face, no aids and no pencil. */
const face = (page: Page): Promise<string> =>
  page.locator('section.card').evaluate((card) => {
    const copy = card.cloneNode(true) as HTMLElement;
    copy.querySelector('.aids')?.remove();
    copy.querySelector('.tools')?.remove();
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
    await page.getByRole('button', { name: 'Previous card' }).click();
    await page.locator('.dir').waitFor();
    expect(await face(page)).toEqual(live);

    /* And one button per way: the bar above the card steps older and newer,
       and the row below it only continues. The row used to step too, so ←
       and → were each drawn beside two buttons on one screen (#63). */
    const hints = await page.locator('kbd').allInnerTexts();
    /* ← is drawn only while there is an older card to step to, and the bar's
       own button is disabled exactly when there is not. */
    const canOlder = await page.getByRole('button', { name: 'Previous card' }).isEnabled();
    expect(hints.filter((h) => h === '←'), 'one button steps back').toHaveLength(canOlder ? 1 : 0);
    expect(hints.filter((h) => h === '→'), 'one button steps forward').toHaveLength(1);
    expect(hints.filter((h) => h === 'space'), 'one button continues').toHaveLength(1);
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
  /* And a tense whole, from the speaker at its head (#49): pressed, and
     pressed again to stop, with as little to hear as the line had. */
  const whole = page.locator('section.card button.hear', { hasText: '' }).first();
  expect(await whole.getAttribute('aria-label')).toBe('Hear the whole Présent');
  await whole.click();
  await whole.click();
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

  /* And it is written down, where a report can carry it: the learner had no
     console, and the report said the button did nothing. */
  await page.goto(`${site.url}/settings/`);
  const notes = page.locator('.notes');
  await notes.waitFor();
  const written = await notes.innerText();
  expect(written).toContain('sound');
  expect(written).toContain('recording is missing');
  expect(written, 'the warm-up named the file it could not fetch').toContain('gone.mp3');
  const link = await page.locator('a.button', { hasText: 'Report a problem' }).getAttribute('href');
  expect(decodeURIComponent(link ?? '')).toContain('recording is missing');
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

describeOrSkip('while the answer box is open the letters need alt, and the card says so',
  async () => {
    /* The speaker on a dictation card said `s` while the cursor sat in the
       box, where an `s` is a letter (#28), and there was no way to reach the
       sitting's letters while typing (#35). Now every hint is read off the
       shortcut table, which knows the box is open. */
    const { page, context } = await openApp();
    await page.goto(`${site.url}/`);
    await page.locator('button.study').waitFor();
    /* A dictation card, dealt first: your own words go before the catalogue's
       while they are new. */
    await page.evaluate(() => new Promise<void>((resolve) => {
      const open = indexedDB.open('frcog');
      open.onsuccess = () => {
        const tx = open.result.transaction('cards', 'readwrite');
        tx.objectStore('cards').put({
          id: 'nation|noun|heard|dictate', key: 'nation|noun', channel: 'heard', rung: 'dictate',
          lesson: true, retired: false, due: new Date(0), stability: 0, difficulty: 0,
          elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0,
        });
        tx.oncomplete = () => resolve();
      };
    }));

    await page.goto(`${site.url}/study/`);
    const speaker = page.locator('section.card .speaker');
    await speaker.waitFor();
    expect(await speaker.locator('kbd').allInnerTexts()).toEqual(['alt', 's']);

    const input = page.locator('section.card input');
    await page.waitForTimeout(400);           /* the card's own first playing */
    await clearPlayed(page);
    await input.focus();
    await page.keyboard.type('s');
    expect(await input.inputValue()).toBe('s');
    expect(await played(page), 'a letter typed into the box played the sound').toEqual([]);
    await page.keyboard.press('Alt+s');
    await page.waitForTimeout(300);
    expect(await played(page)).toEqual(['w1.mp3']);
    expect(await input.inputValue(), 'alt+s typed a letter').toBe('s');

    /* After the flip the box is gone, and so is the alt. The speaker is still
       the one button for the French: the row of chips under the answer used
       to draw a second, "Hear again", with the same `s` beside it (#63). */
    await page.locator('section.card button.primary').click();
    await page.locator('.grades').waitFor();
    expect(await speaker.locator('kbd').allInnerTexts()).toEqual(['s']);
    expect(await page.locator('section.card .audio kbd', { hasText: /^s$/ }).count()).toBe(0);
    await context.close();
  });

describeOrSkip('a word the catalogue does not teach is added from the dictionary', async () => {
  /* Adding one used to mean typing its English, its part of speech and its
     gender from memory (#37). The fixture dictionary has "la chaussette",
     which the ranking never chose. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/words/`);
  const box = page.locator('section.panel input[type="text"]').first();
  await box.waitFor();
  await box.fill('chaussette');

  const offer = page.locator('.hits li', { hasText: 'chaussette' });
  await offer.waitFor();
  expect(await offer.innerText()).toContain('sock');
  expect(await offer.innerText()).toContain('noun');
  await offer.locator('button').click();

  /* In the list, with everything the form would have asked for: the article
     painted as a feminine one, and the English beside it. */
  const row = page.locator('.list li', { hasText: 'chaussette' });
  await row.waitFor();
  expect(await row.innerText()).toContain('sock');
  const article = row.locator('.art').first();
  expect(await article.innerText()).toBe('la');
  expect(await article.evaluate((el) => getComputedStyle(el).color))
    .toBe(await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--fem)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }));
  await context.close();
});

describeOrSkip('a word added on the words screen is the next card of the sitting', async () => {
  /* It used to wait for the next fresh sitting: the queue was written down,
     and a word added mid-way had no place in it. The queue is derived on
     every open now, and a word of your own takes the first place. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  await answerOne(page);
  await grade(page);

  await page.goto(`${site.url}/words/`);
  const box = page.locator('section.panel input[type="text"]').first();
  await box.waitFor();
  await box.fill('chaussette');
  const offer = page.locator('.hits li', { hasText: 'chaussette' });
  await offer.waitFor();
  await offer.locator('button').click();
  await page.locator('.list li', { hasText: 'chaussette' }).waitFor();

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  expect(await face(page)).toContain('chaussette');
  await context.close();
});

describeOrSkip('a word corrected from the card is corrected on the card', async () => {
  /* A word wrong on its card was fixed on the words screen, and showed
     fixed at the next open of the study screen and not before (#59). The
     pencil on the live card opens the same form in a popup, and the sitting
     looks the word up again when it is saved: the card, still the same card
     of the same sitting, says the new English; so does the words screen. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  const left = await page.locator('header').innerText();

  await page.getByRole('button', { name: 'Correct this word' }).click();
  const popup = page.locator('dialog[open]');
  await popup.waitFor();
  /* Nothing behind it fires: a space on its Cancel button used to be a
     flip, and space is what a keyboard presses on a focused button. */
  await popup.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Space');
  await popup.waitFor({ state: 'detached' }).catch(() => {});
  expect(await page.locator('.grades').count(), 'the card turned over behind the popup').toBe(0);

  await page.getByRole('button', { name: 'Correct this word' }).click();
  await popup.waitFor();
  await popup.getByLabel('English').fill('a corrected gloss');
  await popup.getByRole('button', { name: 'Save' }).click();
  await popup.waitFor({ state: 'detached' });

  /* The same sitting, the same card, and the word on it corrected. */
  expect(page.url()).toContain('/study/');
  expect(await page.locator('header').innerText()).toBe(left);
  await answerOne(page);
  expect(await face(page)).toContain('a corrected gloss');

  await page.goto(`${site.url}/words/`);
  const row = page.locator('.list li', { hasText: 'a corrected gloss' });
  await row.waitFor();
  expect(await row.count()).toBe(1);
  await context.close();
});

describeOrSkip('closing the study screen and coming back carries on from the same card', async () => {
  /* Nothing is written down but the day's answers; the queue is dealt again,
     and an answered card is no longer in it, so the next open lands on the
     card that was next. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  for (let i = 0; i < 2; i += 1) { await answerOne(page); await grade(page); }
  const third = await face(page);

  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  expect(await page.locator('button.study').innerText()).toContain('Carry on');

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  expect(await face(page)).toBe(third);
  await context.close();
});

describeOrSkip('the definitions closed on one card stay closed after a reload, and the forms opened stay open on the word page', async () => {
  /* The chevrons used to be variables on the study screen, so they lasted as
     long as the screen did: every reload for a new version, every trip to
     the words screen, put them back the way the app likes them (#64). */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  await answerOne(page);
  const defs = page.locator('section.card .defs-toggle');
  expect(await defs.getAttribute('aria-expanded')).toBe('true');
  await defs.click();
  expect(await defs.getAttribute('aria-expanded')).toBe('false');
  await page.waitForTimeout(200);

  await page.reload();
  await page.locator('section.card').waitFor();
  await answerOne(page);
  expect(await page.locator('section.card .defs-toggle').getAttribute('aria-expanded')).toBe('false');

  /* The forms table is the same drawer on the card and on the word page. */
  await page.goto(`${site.url}/word/?k=parler%7Cverb`);
  const forms = page.locator('button.toggle');
  await forms.waitFor();
  expect(await forms.getAttribute('aria-expanded')).toBe('false');
  await forms.click();
  await page.waitForTimeout(200);
  await page.reload();
  await page.locator('button.toggle').waitFor();
  expect(await page.locator('button.toggle').getAttribute('aria-expanded')).toBe('true');
  await context.close();
});

describeOrSkip('a theme chosen is worn on every screen and after a reload, and an edit is kept under its name', async () => {
  /* Themes are a setting like any other (#66): the choice is on the device,
     the edit is a record that syncs, and both survive the page. */
  const { page, context } = await openApp();
  await page.goto(`${site.url}/settings/`);
  await page.locator('h2', { hasText: 'Colours' }).waitFor();
  await page.getByLabel('Light or dark').getByText('Dark').click();
  await page.getByLabel('In the dark').selectOption('crepuscule');
  await page.waitForTimeout(300);
  const worn = (): Promise<{ mode: string | undefined; accent: string; meta: string | null }> =>
    page.evaluate(() => ({
      mode: document.documentElement.dataset.theme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    }));
  expect(await worn()).toEqual({ mode: 'dark', accent: '#f2a94c', meta: '#120c08' });

  /* Another screen, and a reload: the same. */
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  expect((await worn()).accent).toBe('#f2a94c');

  /* Edit the accent of the theme that ships: it is marked as edited, worn
     at once, and reset puts it back. */
  await page.goto(`${site.url}/settings/`);
  await page.locator('h2', { hasText: 'Colours' }).waitFor();
  await page.waitForTimeout(200);
  const accent = page.getByLabel('Accent', { exact: true });
  await accent.fill('#ff0000');
  await accent.dispatchEvent('change');
  await page.waitForTimeout(300);
  expect((await worn()).accent).toBe('#ff0000');
  expect(await page.getByLabel('In the dark').locator('option:checked').innerText())
    .toContain('(edited)');
  await page.reload();
  await page.locator('h2', { hasText: 'Colours' }).waitFor();
  await page.waitForTimeout(300);
  expect((await worn()).accent).toBe('#ff0000');
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(300);
  expect((await worn()).accent).toBe('#f2a94c');
  expect(await page.getByLabel('In the dark').locator('option:checked').innerText())
    .not.toContain('(edited)');

  /* A copy is the learner's own: named, and deletable. */
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('Theme name').fill('Soir');
  await page.getByLabel('Theme name').dispatchEvent('change');
  await page.waitForTimeout(200);
  expect(await page.getByLabel('Theme to edit').locator('option:checked').innerText()).toBe('Soir');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(300);
  expect(await page.getByLabel('In the dark').locator('option', { hasText: 'Soir' }).count()).toBe(0);
  await context.close();
});

describeOrSkip('every screen fits its width, and everything in the bar sits on its centre line',
  async () => {
    /* Six of the first thirty issues were a row a few pixels off: buttons not
       centred in the bar (#12), a bar that grew under a lit tab (#20, #26), a
       page that scrolled sideways on a phone. Each was one component's own
       numbers drifting from the others'. This walks every screen at a phone's
       width and a monitor's and measures. */
    const { page, context } = await openApp();
    const ROUTES = ['/', '/words/', '/progress/', '/settings/', '/cards/', '/study/',
      '/word/?k=parler%7Cverb'];
    for (const width of [400, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(`${site.url}${route}`);
        await page.locator('main .panel, main section, main ul').first().waitFor();
        /* The verb's table, open: a long form once left the card (#46). */
        const forms = page.locator('button.toggle', { hasText: 'Forms' });
        if (await forms.count()) await forms.click();
        await page.waitForTimeout(250);
        const sideways = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(sideways, `${route} at ${width}px scrolls sideways by ${sideways}px`)
          .toBeLessThanOrEqual(0);
        /* Everything in the bar's row — the mark or the back arrow, the
           title, the bug button — on one centre line, within a pixel. */
        const off = await page.locator('header.bar .row').evaluate((row) => {
          const mid = (r: DOMRect): number => r.top + r.height / 2;
          const own = mid(row.getBoundingClientRect());
          return Array.from(row.children).map((child) =>
            [child.className, Math.abs(mid(child.getBoundingClientRect()) - own)] as const);
        });
        for (const [what, by] of off) {
          expect(by, `${route} at ${width}px: "${what}" sits ${by}px off the bar's centre line`)
            .toBeLessThanOrEqual(1);
        }
      }
    }
    await context.close();
  });

/** Put a card on a rung, due now, the way the database would hold it: a new
 *  FSRS card with nothing learned yet. The sitting deals whatever is due. */
async function seedCard(page: Page, key: string, channel: string, rung: string): Promise<void> {
  await page.evaluate((c) => new Promise<void>((resolve) => {
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
}

/** Open a grammar bit, as the Grammar screen does. A form card is dealt only
 *  in a tense the learner has opened (GRAMMAR.md); the which-time card needs
 *  its two times open. */
async function openBit(page: Page, id: string): Promise<void> {
  await page.evaluate((b) => new Promise<void>((resolve) => {
    const open = indexedDB.open('frcog');
    open.onsuccess = () => {
      const tx = open.result.transaction('bits', 'readwrite');
      tx.objectStore('bits').put({ id: b.id, openedAt: Date.now(), updatedAt: Date.now(), v: 1 });
      tx.oncomplete = () => resolve();
    };
  }), { id });
}

/** Deal cards until one with the given task comes up, answering the rest. */
async function reach(page: Page, task: RegExp, limit = 12): Promise<boolean> {
  for (let n = 0; n < limit; n += 1) {
    await page.locator('section.card').waitFor();
    if (task.test(await page.locator('.task .verb').innerText())) return true;
    await answerAny(page);
    await grade(page);
  }
  return false;
}

/** Answer whatever card is on screen, tap cards included. */
async function answerAny(page: Page): Promise<void> {
  const options = page.locator('section.card .option');
  if (await options.count()) {
    /* Tap until the right one turns the card: at most one wrong tap per option. */
    for (let n = 0; n < 4 && !(await page.locator('.grades').count()); n += 1) {
      await options.filter({ hasNot: page.locator('.wrong') }).first().click();
      await page.waitForTimeout(100);
    }
    await page.locator('.grades').waitFor();
    return;
  }
  await answerOne(page);
}

describeOrSkip('a wrong tap is taken away and the question stands; the first tap is the grade',
  async () => {
    /* The retry teaches, the first tap grades: graded as a Hard, a wrong-then-
       right was a pass, and a guesser on three buttons never lapsed. */
    const { page, context } = await openApp();
    await page.goto(`${site.url}/`);
    await page.locator('button.study').waitFor();
    await seedCard(page, 'sur|prep', 'sense', 'choose');

    await page.goto(`${site.url}/study/`);
    expect(await reach(page, /Tap the word/)).toBe(true);
    const options = page.locator('section.card .option');
    expect(await options.count()).toBe(3);
    expect(await options.allInnerTexts()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sur/), expect.stringMatching(/^sous/),
        expect.stringMatching(/^dans/)]));
    expect(await page.locator('button.wide').count(), 'no Show button on a tap card').toBe(0);

    await options.filter({ hasText: /^sous/ }).click();
    expect(await page.locator('section.card').innerText()).toContain('Not that one');
    expect(await options.filter({ hasText: /^sous/ }).isDisabled()).toBe(true);
    expect(await page.locator('.grades').count(), 'not revealed on a wrong tap').toBe(0);

    await options.filter({ hasText: /^sur/ }).click();
    await page.locator('.grades').waitFor();
    const card = await page.locator('section.card').innerText();
    expect(card).toContain('Not quite');
    expect(card).toContain('you tapped sous first');
    expect(await page.locator('.tiny').last().innerText()).toContain('Suggested: Again');
    await context.close();
  });

describeOrSkip('a which-time card offers three times, by finger or by digit, and names the tense', async () => {
  const { page, context } = await openApp();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  for (const id of ['V.pc', 'V.imparfait']) await openBit(page, id);
  await seedCard(page, 'parler|verb', 'form', 'tense');

  await page.goto(`${site.url}/study/`);
  expect(await reach(page, /when is it/)).toBe(true);
  const options = page.locator('section.card .option');
  expect(await options.count()).toBe(3);
  /* The sentence on the card is "Elle a parlé au directeur." at rep 0, and
     the passé composé is the first option: the digit taps it. */
  await page.keyboard.press('1');
  await page.locator('.grades').waitFor();
  const card = await page.locator('section.card').innerText();
  expect(card).toContain('Correct');
  expect(card).toContain('Passé composé');
  expect(await page.locator('.tiny').last().innerText()).toContain('Suggested: Good');
  await context.close();
});

/* The voice's threads exist only on a cross-origin isolated page, and for as
   long as the worker had asked for them production was served without the
   headers that make one: the request was answered with a single thread and
   no word about it (#54). The suite serves the build the way the Worker
   does, so this is the browser's own answer, not the server's headers. */
describeOrSkip('the study screen is cross-origin isolated, so the voice may use its threads',
  async () => {
    const { page, context } = await openApp();
    await page.goto(`${site.url}/study/`);
    await page.locator('section.card').waitFor();
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
    await context.close();
  });

describeOrSkip('a started présent bit deals a table to fill, checked cell by cell, and the Grammar screen counts it',
  async () => {
    /* The first grammar exercise: six boxes on a verb the learner knows,
       among the word cards. There is no grade to press — the cells were the
       grade — and the rule's breadth is what the Grammar screen shows. */
    const { page, context } = await openApp();
    await page.goto(`${site.url}/`);
    await page.locator('button.study').waitFor();
    await seedCard(page, 'parler|verb', 'written', 'write');
    await openBit(page, 'V.pres-er');

    await page.goto(`${site.url}/study/`);
    await page.locator('section.card').waitFor();
    expect(await reach(page, /Fill in the forms/), 'a table was dealt').toBe(true);
    const boxes = page.locator('section.card .cell input');
    expect(await boxes.count()).toBe(6);
    expect(await page.locator('section.card').innerText()).toContain('parler · Présent');
    for (const [i, form] of ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'].entries()) {
      await boxes.nth(i).fill(form);
    }
    await page.locator('section.card .column button.primary').click();
    await page.locator('section.card .verdict', { hasText: 'All right' }).waitFor();
    expect(await page.locator('.grades button', { hasText: 'Good' }).count(), 'no grade to press').toBe(0);
    await page.locator('.grades button', { hasText: 'Continue' }).click();
    await page.waitForTimeout(250);

    await page.goto(`${site.url}/grammar/`);
    /* The présent's bit is drilled from its tense row, which says what it earned. */
    await page.locator('li[data-tense="pres"]', { hasText: /right on 1 verb/ }).waitFor();
    await context.close();
  });

describeOrSkip('a started negation bit deals a sentence to make negative, judged on the words and not the full stop',
  async () => {
    const { page, context } = await openApp();
    await page.goto(`${site.url}/`);
    await page.locator('button.study').waitFor();
    await seedCard(page, 'parler|verb', 'written', 'write');
    await openBit(page, 'G.pas');

    await page.goto(`${site.url}/study/`);
    await page.locator('section.card').waitFor();
    expect(await reach(page, /Rewrite the sentence/), 'a sentence was dealt').toBe(true);
    expect(await page.locator('section.card mark').innerText()).toBe('parlons');
    await page.locator('section.card .cell input').fill('Nous ne parlons pas français');
    await page.locator('section.card .column button.primary').click();
    await page.locator('section.card .verdict', { hasText: 'All right' }).waitFor();
    await page.locator('.grades button', { hasText: 'Continue' }).click();
    await page.waitForTimeout(250);

    await page.goto(`${site.url}/grammar/`);
    await page.locator('li[data-rule="G.pas"]', { hasText: /right on 1 sentence/ }).waitFor();
    await context.close();
  });

describeOrSkip('a started numbers bit deals a number to write in words, and needs no verb', async () => {
  const { words } = await import('../../src/lib/grammar/numbers.js');
  const { page, context } = await openApp();
  await page.goto(`${site.url}/`);
  await page.locator('button.study').waitFor();
  await openBit(page, 'N.et-un');

  await page.goto(`${site.url}/study/`);
  await page.locator('section.card').waitFor();
  expect(await reach(page, /Write the number/), 'a number was dealt').toBe(true);
  const shown = await page.locator('section.card .prompt').first().innerText();
  const n = Number(shown.replace(/\D/g, ''));
  expect(n % 10, 'one of the et-un numbers').toBe(1);
  await page.locator('section.card .cell input').fill(words(n).replace(/ /g, '-'));
  await page.locator('section.card .column button.primary').click();
  await page.locator('section.card .verdict', { hasText: 'All right' }).waitFor();
  await page.locator('.grades button', { hasText: 'Continue' }).click();
  await page.waitForTimeout(250);

  await page.goto(`${site.url}/grammar/`);
  await page.locator('li[data-rule="N.et-un"]', { hasText: /right on 1 number/ }).waitFor();
  await context.close();
});
