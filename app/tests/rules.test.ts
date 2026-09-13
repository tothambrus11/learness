/** Rules that are true of the whole source tree, checked by reading it.
 *
 *  Some of what CLAUDE.md asks for cannot be said in a type: that every sound
 *  goes through the player, that the browser's voice is spoken to in one
 *  file. A grep is not elegant, but it runs on every push and it names the
 *  file that broke the rule.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sources(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|svelte)$/.test(name)) out.push(path);
  }
  return out;
}

/** Files, relative to src/, whose text matches. */
const where = (re: RegExp, only = /./): string[] =>
  sources().filter((f) => only.test(f) && re.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f)).sort();

test('every sound goes through the player', () => {
  /* Three copies of "play it, or say it, or give up" each had their own idea
     of busy; #34 was the study screen's. */
  assert.deepEqual(where(/new Audio\(/), ['lib/player.ts']);
});

test('the browser’s voice is spoken to in one file', () => {
  assert.deepEqual(where(/speechSynthesis/), ['lib/speech.ts']);
});

test('a key is named in one table', () => {
  /* A `<kbd>` typed by hand beside a button is a hint that can lie (#28). */
  assert.deepEqual(where(/<kbd>/, /\.svelte$/), ['lib/components/Kbd.svelte']);
});
