import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  BUILT_IN, DEFAULT_DARK, DEFAULT_LIGHT, TOKENS, builtIn, cssOf, duplicate, hex6, isColour,
  isEdited, pickTheme, resetOf, resolveColours, themesInUse, trustTheme,
} from '../src/lib/theme.js';
import type { Theme, Token } from '../src/lib/theme.js';
import { ms } from './make.js';

const own = (over: Partial<Theme> = {}): Theme => ({
  id: 'b2c3', name: 'Mine', mode: 'dark', colours: { accent: '#123456' }, updatedAt: ms(5),
  ...over,
});

test('the themes that ship have a French name, a mode, and every colour set outright', () => {
  const ids = new Set<string>();
  for (const t of BUILT_IN) {
    assert.ok(t.name && t.id && !ids.has(t.id), `${t.id} is named once`);
    ids.add(t.id);
    assert.ok(t.mode === 'light' || t.mode === 'dark');
    for (const spec of TOKENS) {
      assert.ok(isColour(t.colours[spec.name]), `${t.name} sets ${spec.name}`);
    }
    assert.equal(t.updatedAt, 0, 'what ships is older than any edit');
  }
  assert.equal(builtIn(DEFAULT_LIGHT)?.mode, 'light');
  assert.equal(builtIn(DEFAULT_DARK)?.mode, 'dark');
});

test('every token has a value under any theme, even one that names none', () => {
  /* The point of the fallbacks: a theme saved before a token existed is
     whole after it does. An empty theme is the extreme case. */
  for (const theme of [...BUILT_IN, { mode: 'light' as const, colours: {} },
    { mode: 'dark' as const, colours: {} }]) {
    const colours = resolveColours(theme);
    for (const spec of TOKENS) assert.ok(isColour(colours[spec.name]), `${spec.name} is a colour`);
  }
});

test('a token a theme is silent about takes its default for the mode, or another token', () => {
  assert.equal(resolveColours({ mode: 'dark', colours: {} }).bg, '#000000');
  assert.equal(resolveColours({ mode: 'light', colours: {} }).bg, '#eef1f1');
  /* "good" follows the accent, and "on good" follows "on accent": the pair
     were one token once, and a theme from then still reads right. */
  const t = resolveColours({ mode: 'light', colours: { accent: '#123456', onAccent: '#abcdef' } });
  assert.equal(t.good, '#123456');
  assert.equal(t.onGood, '#abcdef');
  assert.equal(t.ipa, resolveColours({ mode: 'light', colours: {} }).warn,
    'the pronunciation is the warning colour until a theme says otherwise');
  /* A colour that is not one is as good as absent. */
  assert.equal(resolveColours({ mode: 'dark', colours: { bg: 'url(x)' } }).bg, '#000000');
});

test('every chain of "like" ends at a token with defaults, never in a loop', () => {
  for (const spec of TOKENS) {
    const seen = new Set<Token>();
    let at = spec;
    while ('like' in at.fallback) {
      assert.ok(!seen.has(at.name), `${spec.name} loops`);
      seen.add(at.name);
      at = TOKENS.find((t) => t.name === (at.fallback as { like: Token }).like)!;
      assert.ok(at, `${spec.name} follows a token that exists`);
    }
  }
});

test('the root gets one variable per token, named as the screens read them', () => {
  const css = cssOf(builtIn('minuit')!);
  assert.deepEqual(Object.keys(css).sort((a, b) => a.localeCompare(b)),
    TOKENS.map((t) => t.variable).sort((a, b) => a.localeCompare(b)));
  assert.equal(css['--accent'], '#27efd7');
});

test('a record off the wire is a theme only if it says so, and only its colours are kept', () => {
  assert.equal(trustTheme(null), null);
  assert.equal(trustTheme('minuit'), null);
  assert.equal(trustTheme({ id: 'x', name: 'x' }), null, 'no mode');
  assert.equal(trustTheme({ id: '', name: 'x', mode: 'dark' }), null, 'no id');
  const t = trustTheme({
    id: 'x', name: 'X', mode: 'dark', updatedAt: 9, basedOn: 'minuit', deleted: 'yes',
    colours: { accent: '#123', bg: 'url(evil)', ink: 12, later: '#abcdef' },
  });
  assert.ok(t);
  assert.deepEqual(t.colours, { accent: '#123', later: '#abcdef' },
    'a colour is kept, a non-colour dropped, a token this build does not know rides along');
  assert.equal(t.deleted, undefined, 'a tombstone is true, not truthy');
  assert.equal(t.basedOn, 'minuit');
  assert.equal(t.updatedAt, 9);
});

test('the themes on offer are the built-ins, each replaced by its edit, then your own by name', () => {
  const editedMinuit = own({ id: 'minuit', name: 'Minuit', colours: { accent: '#ff0000' } });
  const gone = own({ id: 'c1', name: 'Gone', deleted: true });
  const list = themesInUse([own({ id: 'b', name: 'Zeta' }), editedMinuit, gone,
    own({ id: 'a', name: 'Alpha' })]);
  assert.deepEqual(list.map((t) => t.id),
    [...BUILT_IN.map((t) => t.id), 'a', 'b']);
  assert.equal(list.find((t) => t.id === 'minuit')?.colours.accent, '#ff0000');
  assert.ok(isEdited(list.find((t) => t.id === 'minuit')!));
  assert.ok(!isEdited(list.find((t) => t.id === 'aube')!));
  assert.ok(!isEdited(list.find((t) => t.id === 'a')!), 'your own is not an edit of anything');
});

test('the theme in force is the one chosen for the mode in force, or the default when it is gone', () => {
  const offered = themesInUse([own({ id: 'mine', name: 'Mine', mode: 'dark' })]);
  const rows: [Parameters<typeof pickTheme>[0], boolean, string][] = [
    [{}, false, DEFAULT_LIGHT],
    [{}, true, DEFAULT_DARK],
    [{ themeDark: 'mine' }, true, 'mine'],
    [{ themeDark: 'mine' }, false, DEFAULT_LIGHT],
    [{ themeMode: 'dark', themeDark: 'mine' }, false, 'mine'],
    [{ themeMode: 'light', themeDark: 'mine' }, true, DEFAULT_LIGHT],
    [{ themeLight: 'parchemin' }, false, 'parchemin'],
    [{ themeLight: 'mine' }, false, DEFAULT_LIGHT],       /* a dark theme is not a light choice */
    [{ themeDark: 'deleted-elsewhere' }, true, DEFAULT_DARK],
  ];
  for (const [choice, systemDark, want] of rows) {
    assert.equal(pickTheme(choice, offered, systemDark).id, want, JSON.stringify(choice));
  }
});

test('a copy is a new theme that remembers where it came from, and reset goes back there', () => {
  const minuit = builtIn('minuit')!;
  const copy = duplicate(minuit, { id: 'c1', now: ms(10) });
  assert.equal(copy.name, 'Minuit (copy)');
  assert.equal(copy.basedOn, 'minuit');
  assert.notEqual(copy.colours, minuit.colours, 'its own record, not a shared one');
  const again = duplicate(copy, { id: 'c2', now: ms(11) });
  assert.equal(again.basedOn, 'minuit', 'a copy of a copy still knows the original');

  const changed = { ...copy, colours: { ...copy.colours, accent: '#ff0000' } };
  const back = resetOf(changed);
  assert.equal(back?.id, 'c1', 'reset keeps the copy');
  assert.equal(back?.name, 'Minuit (copy)');
  assert.equal(back?.colours.accent, minuit.colours.accent);

  const edited = { ...minuit, colours: { ...minuit.colours, accent: '#ff0000' }, updatedAt: ms(5) };
  assert.equal(resetOf(edited), minuit, 'an edited built-in resets to the built-in itself');
  assert.equal(resetOf(own()), null, 'a theme from nowhere has nowhere to go back to');
});

test('a colour input is given six digits whatever shape the theme holds', () => {
  assert.equal(hex6('#abc'), '#aabbcc');
  assert.equal(hex6('#ABCDEF'), '#abcdef');
  assert.equal(hex6('#abcdef80'), '#abcdef');
  assert.equal(hex6('#abcd'), '#aabbcc');
  assert.equal(hex6('red'), '#000000');
});
