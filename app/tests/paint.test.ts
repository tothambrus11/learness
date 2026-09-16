import { test } from 'vitest';
import assert from 'node:assert/strict';

/* The theme is painted on the root as custom properties, and the learner's
   own gender colours over it (theme.svelte.ts). A document is stood in for:
   what is asserted is the properties set, which is all a screen reads. */

function fakeDocument(): { doc: Document; set: Map<string, string>; meta: { content: string } } {
  const set = new Map<string, string>();
  const meta = { content: '' };
  const dataset: Record<string, string> = {};
  const doc = {
    documentElement: {
      style: { setProperty: (k: string, v: string) => { set.set(k, v); } },
      dataset,
    },
    querySelectorAll: () => [meta],
  } as unknown as Document;
  return { doc, set, meta };
}

test('the theme goes on the root whole, and the learner’s own gender colour over it', async () => {
  const { paintTheme } = await import('../src/lib/theme.svelte.js');
  const { display } = await import('../src/lib/display.svelte.js');
  const { builtIn, TOKENS } = await import('../src/lib/theme.js');
  const { doc, set, meta } = fakeDocument();
  display.colourMasc = '#123456';
  display.colourFem = '';
  paintTheme(builtIn('minuit')!, doc);
  for (const t of TOKENS) assert.ok(set.has(t.variable), `${t.variable} is set`);
  assert.equal(set.get('--masc'), '#123456', 'the learner’s own masculine wins');
  assert.equal(set.get('--fem'), '#ff8fa8', 'the theme’s feminine stands where none was chosen');
  assert.equal(set.get('--accent'), '#27efd7');
  assert.equal(set.get('color-scheme'), 'dark', 'the browser is told which way round the page is');
  assert.equal((doc.documentElement as unknown as { dataset: Record<string, string> }).dataset.theme, 'dark');
  assert.equal(meta.content, '#000000', 'the status bar takes the page colour');
  display.colourMasc = '';
});

test('nothing is painted until a theme is known', async () => {
  const { paintTheme } = await import('../src/lib/theme.svelte.js');
  const { doc, set } = fakeDocument();
  paintTheme(null, doc);
  assert.equal(set.size, 0);
});
