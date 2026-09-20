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

test('the sitting is dealt without dice', () => {
  /* A reload used to deal a different card, because the reviews were shuffled
     and the refresher rolled a die; that is why the queue came to be written
     down at all. The queue is derived instead now, and derivation has to give
     the same answer twice, so the only randomness left in the app is the
     noise the on-device voice is made from. */
  assert.deepEqual(where(/Math\.random\(/), ['lib/tts/supertonic.ts']);
});

test('a key is named in one table', () => {
  /* A `<kbd>` typed by hand beside a button is a hint that can lie (#28). */
  assert.deepEqual(where(/<kbd>/, /\.svelte$/), ['lib/components/Kbd.svelte']);
});

test('one action, one button: a shortcut’s hint is drawn in one place per screen', () => {
  /* The back of a "use it" card had "Hear the sentence" in the card's row of
     sounds and "hear the sentence again" in the sitting's aid under it, the
     same key beside each (#63). A hint is drawn where its button is, so a
     second file drawing the same hint is a second button for the same thing.
     The one that plays the French is the card's; and no other hint is drawn
     from two files either. */
  assert.deepEqual(where(/Kbd id="playModel"/, /\.svelte$/), ['lib/components/StudyCard.svelte']);
  const drawn = new Map<string, Set<string>>();
  for (const file of sources()) {
    if (!file.endsWith('.svelte')) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/<Kbd id="(\w+)"/g)) {
      const id = m[1] ?? '';
      drawn.set(id, new Set(drawn.get(id)).add(relative(SRC, file)));
    }
  }
  assert.ok(drawn.size >= 10, 'the hints were found at all');
  for (const [id, files] of drawn) {
    assert.equal(files.size, 1, `${id} is drawn in ${[...files].join(' and ')}`);
  }
});

test('the bug is drawn in one file, so every bug in the app has legs', () => {
  /* Lucide's bug is one flat shape: nothing in it says where a leg meets the
     shell, so nothing in it can walk. BugIcon.svelte is that drawing cut into
     a body and six legs with joints, and a screen that reaches past it for the
     icon gets a bug that sits there on hover. */
  assert.deepEqual(where(/icons\/bug/), []);
  assert.deepEqual(where(/transform-origin/, /\.svelte$/), ['lib/components/BugIcon.svelte']);
});

test('a popup is the platform’s dialog, drawn in one component', () => {
  /* Escape, the focus going back to the opener, and nothing behind it being
     reachable all come with <dialog> and showModal(); a popup built from a
     div would have to write each of them, and get one wrong. */
  assert.deepEqual(where(/<dialog\b/, /\.svelte$/), ['lib/components/Modal.svelte']);
  assert.match(readFileSync(join(SRC, 'lib/components/Modal.svelte'), 'utf8'), /showModal\(\)/);
});

test('the installed icon has no white corners', () => {
  /* Android drew the rounded icon inside a white disc, and the connector's
     slot left its corners white (#50): both cut their own shape out of what
     they are given, and want black to the edges. The manifest offers such an
     icon for masking, and the page's own favicon is that one too. */
  const STATIC = join(SRC, '..', 'static');
  const manifest = JSON.parse(readFileSync(join(STATIC, 'manifest.webmanifest'), 'utf8')) as {
    icons: { src: string; purpose?: string }[];
  };
  const maskable = manifest.icons.find((i) => /\bmaskable\b/.test(i.purpose ?? ''));
  assert.ok(maskable, 'the manifest offers an icon for masking');
  const svg = readFileSync(join(STATIC, maskable.src), 'utf8');
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(viewBox, 'the icon is an SVG with a viewBox');
  const rect = /<rect\b[^>]*>/.exec(svg)?.[0] ?? '';
  assert.match(rect, new RegExp(`width="${viewBox[1]}"`), 'the first rect spans the width');
  assert.match(rect, new RegExp(`height="${viewBox[2]}"`), 'and the height');
  assert.doesNotMatch(rect, /\brx=/, 'with square corners');
  assert.match(rect, /fill="#000000"/, 'in black');
  const html = readFileSync(join(SRC, 'app.html'), 'utf8');
  assert.match(html, new RegExp(`rel="icon" href="[^"]*/${maskable.src}"`),
    'the favicon is the same full-bleed file');
});

test('sync installs itself in one place', () => {
  /* It used to be the home screen's, so a word Claude added reached the phone
     only on a visit home. The layout installs it once, for every screen, and
     the study screen says when a card is face up so it is not rewritten. */
  assert.deepEqual(where(/installAutoSync\(/), ['lib/sync.ts', 'routes/+layout.svelte']);
});

test('a spinner is the one spinner, and every animation is declared once', () => {
  /* The settings page had a spinner of its own, with its own keyframes, the
     one turning thing in the app; then a clip being made wanted one on every
     screen. Both animations — the sweep over text being made and the
     spinner — live in ui.css, and the loader icon is drawn by one component,
     so a spinner is the same size and speed wherever it turns. */
  assert.deepEqual(where(/loader-circle/), ['lib/components/Spinner.svelte']);
  assert.deepEqual(where(/@keyframes/, /\.svelte$/), []);
  const css = readFileSync(join(SRC, 'lib', 'ui.css'), 'utf8');
  assert.match(css, /@keyframes spin\b/);
  assert.match(css, /@keyframes making-sweep\b/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.making::after \{ animation: none/,
    'and the sweep stands still for someone who asked for no motion');
});

test('every colour a screen reads is a token the theme declares', () => {
  /* A screen that reaches for `var(--something)` the theme does not know
     paints nothing in that place, on every theme, with no error. The
     theme's tokens are the list in theme.ts, and the two sizes the layout
     declares beside them; past those, a file may read a variable it declares
     itself — the bug's stride is its own business, and a name that is set and
     read in one file cannot be a misspelling of a token. */
  const declared = new Set(readFileSync(join(SRC, 'lib', 'theme.ts'), 'utf8')
    .match(/variable: '(--[a-z-]+)'/g)?.map((m) => m.slice(11, -1)) ?? []);
  assert.ok(declared.size >= 17, 'the tokens were read off theme.ts');
  const sizes = new Set(['--tabs', '--bar-row']);
  const stray: string[] = [];
  /* The shared stylesheet is the file most likely to reach for a token. */
  for (const file of [...sources(), join(SRC, 'lib', 'ui.css')]) {
    if (file.endsWith('theme.ts')) continue;
    const text = readFileSync(file, 'utf8');
    const own = new Set([...text.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]!));
    for (const m of text.matchAll(/var\((--[a-z-]+)\)/g)) {
      const name = m[1]!;
      if (!declared.has(name) && !sizes.has(name) && !own.has(name)) {
        stray.push(`${relative(SRC, file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(stray, []);
});

test('a text box primitive yields to the screen that says otherwise', () => {
  /* ui.css promises that a component which needs to differ says so in its
     own block, and wins by being scoped. The text box left out the tick, the
     dot and the swatch with three :not()s, and each of those counts as an
     attribute, so the base outranked every scoped `input { padding }` in the
     app without a word: the day boxes on settings asked for 6px and got 11px,
     which with the spin arrows left room for two of 120's three digits
     (#79). A primitive's exclusions go inside :where(), which counts for
     nothing. */
  const css = readFileSync(join(SRC, 'lib', 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim())
    .filter((s) => /\b(input|select|textarea)\b/.test(s));
  assert.ok(selectors.length >= 3, 'the text box rules were found at all');
  for (const selector of selectors) {
    const outside = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    assert.doesNotMatch(outside, /:not\(/, `${selector} outranks a scoped rule`);
  }
  /* And the number box has no arrows drawn over its digits. */
  assert.match(css, /input\[type=number\]::-webkit-inner-spin-button/);
});
