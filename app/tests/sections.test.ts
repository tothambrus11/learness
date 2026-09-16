import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { settings } from './make.js';
import { sectionsOf } from '../src/lib/sections.js';

/* The bug this exists for (#64): closing the definitions, or opening a
   verb's forms, lasted only until the study screen was left. Every reload
   for a new version, every trip to the words screen to add a word, put the
   sections back the way the app likes them rather than the way the learner
   had left them. */

test('a section is open or closed the way the learner last left it, across sittings', async () => {
  await freshApp();
  const { rememberSection } = await import('../src/lib/sections.js');
  const { getSettings } = await import('../src/lib/db.js');

  await rememberSection('defs', false);
  await rememberSection('forms', true);
  /* Read back through the store, as the next sitting will, not from memory. */
  assert.deepEqual(sectionsOf(await getSettings()), { defs: false, forms: true });

  await rememberSection('forms', false);
  assert.deepEqual(sectionsOf(await getSettings()), { defs: false, forms: false },
    'one section changing leaves the other as it was');
});

test('a section never touched stands as the app has it: definitions open, forms closed', () => {
  assert.deepEqual(sectionsOf(settings()), { defs: true, forms: false });
  assert.deepEqual(sectionsOf(settings({ openSections: { forms: true } })), { defs: true, forms: true },
    'a record naming one section says nothing about the other');
});

test('a store that will not keep a section says so in the notes, and does not throw', async () => {
  await freshApp();
  const { rememberSection } = await import('../src/lib/sections.js');
  const db = await import('../src/lib/db.js');
  const diagnostics = await import('../src/lib/diagnostics.js');
  const conn = await db.db();
  conn.close();   /* the next write fails the way a full or evicted store does */
  assert.equal(await rememberSection('defs', false), false);
  assert.match(diagnostics.all().at(-1)?.what ?? '', /defs being closed/);
});
