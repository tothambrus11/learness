/** The possessives' table, drawn: every cell keeps its form on screen while
 *  its clip is being made, and wears the sweep instead of a spinner.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { render } from 'svelte/server';
import PossessiveTable from '../src/lib/components/PossessiveTable.svelte';
import { phraseOf } from '../src/lib/possessives.js';
import { making } from '../src/lib/voicestate.svelte.js';
import { phraseId } from '../src/lib/voicequeue.js';
import type { Phrase } from '../src/lib/conjspeech.js';

const draw = (saying: (p: Phrase) => boolean): string =>
  render(PossessiveTable, { props: { say: () => {}, saying } }).body;

test('a cell whose sound is being made keeps its word, with the sweep behind it, not a spinner', () => {
  /* The form was replaced by a spinning wheel while its clip was made, so
     the word asked about vanished and the cell jumped (#108). */
  const mon = phraseOf('mon livre');
  making.id = phraseId(mon);
  making.waiting = [];
  try {
    const body = draw(() => false);
    assert.match(body, /<span class="form[^"]* making[^"]*">mon<\/span>/, 'the form, sweeping');
    assert.doesNotMatch(body, /class="[^"]*\bspin\b/, 'no spinner anywhere on the sheet');
    assert.equal((body.match(/\bmaking\b/g) ?? []).length, 1, 'only the cell being made');
  } finally {
    making.id = null;
  }
});

test('a cell tapped and waiting for its turn sweeps too; one only playing does not', () => {
  const ma = phraseOf('ma maison');
  making.id = null;
  making.waiting = [phraseId(ma)];
  try {
    const tapped = (p: Phrase): boolean => p.slot === ma.slot;
    assert.match(draw(tapped), /<span class="form[^"]* making[^"]*">ma<\/span>/);
    making.waiting = [];
    assert.doesNotMatch(draw(tapped), /\bmaking\b/, 'made already, now heard: nothing to wait for');
  } finally {
    making.waiting = [];
  }
});
