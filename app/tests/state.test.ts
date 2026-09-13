import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chrome, resetChrome, setChrome } from '../src/lib/chrome.svelte.js';
import { applyDisplay, display, displayFrom } from '../src/lib/display.svelte.js';
import { DEFAULT_DISPLAY } from '../src/lib/gender.js';
import { settings } from './make.js';

test('the bar says what a page tells it, and nothing after the page is gone', () => {
  setChrome({ title: 'Study', subtitle: '12 left', progress: 0.5 });
  assert.deepEqual({ ...chrome }, { title: 'Study', subtitle: '12 left', progress: 0.5 });
  setChrome({ subtitle: '11 left' });
  assert.equal(chrome.title, 'Study', 'a patch is a patch');
  resetChrome();
  assert.deepEqual({ ...chrome }, { title: '', subtitle: '', progress: null });
});

test('the display dials are taken out of a settings record, defaults for the rest', () => {
  assert.deepEqual(displayFrom({}), DEFAULT_DISPLAY);
  const mine = displayFrom(settings({ genderMark: 'letter', colourFem: '#f0f' }));
  assert.equal(mine.genderMark, 'letter');
  assert.equal(mine.colourFem, '#f0f');
  assert.equal(mine.genderColour, DEFAULT_DISPLAY.genderColour, 'and nothing else moves');
});

test('applying them changes what every screen reads', () => {
  applyDisplay(settings({ genderPattern: 'underline' }));
  assert.equal(display.genderPattern, 'underline');
  applyDisplay(settings({}));
  assert.equal(display.genderPattern, 'none', 'and back again');
});
