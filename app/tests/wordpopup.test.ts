/** When the popup over a word opens and closes: a mouse resting on a word,
 *  a tap, the pointer crossing to the popup, a tap elsewhere. */
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { render } from 'svelte/server';
import Words from '../src/lib/components/Words.svelte';
import { HOVER_MS, LEAVE_MS, closeWord, hoverWord, leaveWord, openWord, stayOpen, wordPopup }
  from '../src/lib/wordpopup.svelte.js';
import type { OpenWord } from '../src/lib/wordpopup.svelte.js';

/** The open word, read fresh: an assertion that it is null would otherwise
 *  narrow every later read of it to nothing. */
const open = (): OpenWord | null => wordPopup.open;

const el = { getBoundingClientRect: () => ({ left: 10, top: 20, right: 60, bottom: 40 }) } as unknown as Element;

beforeEach(() => { vi.useFakeTimers(); closeWord(); });
afterEach(() => { vi.useRealTimers(); });

test('a mouse resting on a word opens it after a moment, and leaving closes it after another', () => {
  hoverWord('appelle', 'appelle', el);
  assert.equal(open(), null, 'not at once: a pointer passing over is not a question');
  vi.advanceTimersByTime(HOVER_MS);
  assert.equal(open()?.look, 'appelle');
  assert.equal(open()?.pinned, false);
  assert.deepEqual(open()?.rect, { left: 10, top: 20, right: 60, bottom: 40 });
  leaveWord();
  stayOpen();
  vi.advanceTimersByTime(LEAVE_MS * 2);
  assert.ok(open(), 'the pointer reached the popup in time: it stays, so its buttons can be pressed');
  leaveWord();
  vi.advanceTimersByTime(LEAVE_MS);
  assert.equal(open(), null);
  hoverWord('ma', 'ma', el);
  leaveWord();
  vi.advanceTimersByTime(HOVER_MS * 2);
  assert.equal(open(), null, 'passed over and gone before it opened');
});

test('a tap opens a word at once and keeps it open; the same word tapped again closes it', () => {
  openWord('mère', 'mère', el);
  assert.equal(open()?.pinned, true);
  leaveWord();
  hoverWord('ma', 'ma', el);
  vi.advanceTimersByTime(HOVER_MS + LEAVE_MS);
  assert.equal(open()?.look, 'mère', 'a finger has no hover: pinned, it waits to be dismissed');
  openWord('ma', 'ma', el);
  assert.equal(open()?.look, 'ma', 'another word tapped is that word');
  openWord('ma', 'ma', el);
  assert.equal(open(), null);
});

test('a line drawn as words is the line exactly, each word ready to be looked up', () => {
  const line = "J'appelle ma mère tous les dimanches.";
  const body = render(Words, { props: { text: line } }).body;
  const text = body.replace(/<!--[^>]*-->/g, '').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'");
  assert.equal(text, line, 'nothing added or lost between the words');
  const looks = [...body.matchAll(/data-look="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(looks, ['je', 'appelle', 'ma', 'mère', 'tous', 'les', 'dimanches']);
});
