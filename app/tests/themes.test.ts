import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { ms, sent } from './make.js';
import { BUILT_IN, builtIn, isEdited } from '../src/lib/theme.js';
import type { Theme } from '../src/lib/theme.js';

/* Themes are backed-up data (#66): what is made or edited here is kept in
   the store, goes to the server with the rest, and comes back on the other
   device; and what shipped stays what shipped until it is edited. */

async function app(): Promise<Awaited<ReturnType<typeof freshApp>> & {
  themes: typeof import('../src/lib/themes.js');
  sync: typeof import('../src/lib/sync.js');
}> {
  const base = await freshApp();
  const themes = await import('../src/lib/themes.js');
  const sync = await import('../src/lib/sync.js');
  await sync.configureSync({ api: 'https://example.test', token: 'a-token' });
  return { ...base, themes, sync };
}

/** The server, as far as a sync is concerned. */
function server(pull: unknown = {}, cursor = 7): {
  calls: { since: number; push: Record<string, unknown[]> }[];
  fetchImpl: typeof fetch;
} {
  const calls: { since: number; push: Record<string, unknown[]> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    calls.push(sent<typeof calls[number]>(init?.body));
    return new Response(JSON.stringify({ pull, cursor }),
      { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('with nothing stored, what is on offer is exactly what ships', async () => {
  const a = await app();
  const offered = await a.themes.offeredThemes();
  assert.deepEqual(offered.map((t) => t.id), BUILT_IN.map((t) => t.id));
  assert.ok(offered.every((t) => !isEdited(t)));
});

test('a colour changed on a theme that ships is kept under its name, and reset drops it', async () => {
  const a = await app();
  const minuit = builtIn('minuit')!;
  await a.themes.saveTheme({ ...minuit, colours: { ...minuit.colours, accent: '#ff0000' } });
  let offered = await a.themes.offeredThemes();
  const edited = offered.find((t) => t.id === 'minuit')!;
  assert.equal(edited.colours.accent, '#ff0000');
  assert.ok(isEdited(edited));
  assert.ok(edited.updatedAt > 0, 'stamped, so the other device knows it is the later one');
  assert.equal(offered.length, BUILT_IN.length, 'an edit is not a second theme');

  const back = await a.themes.resetTheme(edited);
  assert.equal(back?.colours.accent, minuit.colours.accent);
  offered = await a.themes.offeredThemes();
  assert.ok(!isEdited(offered.find((t) => t.id === 'minuit')!));
  const rows = await a.db.allThemes();
  assert.equal(rows.find((t) => t.id === 'minuit')?.deleted, true,
    'the edit is a tombstone now, so it is dropped on the other device too');
});

test('a copy is your own theme: renamed, deleted, and reset to where it came from', async () => {
  const a = await app();
  const copy = await a.themes.copyTheme(builtIn('aube')!);
  assert.equal(copy.basedOn, 'aube');
  assert.notEqual(copy.id, 'aube');

  const renamed = await a.themes.saveTheme({ ...copy, name: 'Mine', colours: { ...copy.colours, bg: '#ffeeee' } });
  let offered = await a.themes.offeredThemes();
  assert.equal(offered.at(-1)?.name, 'Mine');
  assert.equal(offered.at(-1)?.colours.bg, '#ffeeee');

  const back = await a.themes.resetTheme(renamed);
  assert.ok(back, 'a copy has somewhere to go back to');
  assert.equal(back.name, 'Mine', 'reset keeps the name');
  assert.equal(back.colours.bg, builtIn('aube')!.colours.bg);

  await a.themes.removeTheme(back);
  offered = await a.themes.offeredThemes();
  assert.equal(offered.length, BUILT_IN.length);
  assert.equal((await a.db.allThemes()).find((t) => t.id === copy.id)?.deleted, true);

  await a.themes.removeTheme(builtIn('aube')!);
  assert.equal((await a.themes.offeredThemes()).length, BUILT_IN.length,
    'a theme that ships cannot be taken away');
});

test('a theme made here reaches the server, and one made there comes back', async () => {
  const a = await app();
  const mine = await a.themes.copyTheme(builtIn('minuit')!);
  /* A record stamped in the very millisecond a sync starts is sent by that
     sync and once more by the next — harmless, and by design (merge.ts) —
     so the copy is made a moment before the sync, as a learner's would be. */
  await new Promise((r) => setTimeout(r, 2));
  const theirs: Theme = {
    id: 'from-the-desk', name: 'Desk', mode: 'light', colours: { accent: '#0000ff' },
    updatedAt: ms(900),
  };
  const { calls, fetchImpl } = server({
    themes: [theirs, { id: 'not-a-theme', name: 1 }, { id: 'nor-this', mode: 'sepia' }],
  });
  const result = await a.sync.sync({ fetchImpl });
  assert.deepEqual(calls[0]?.push.themes?.map((t) => (t as Theme).id), [mine.id]);
  assert.equal(result.received.themes, 1, 'the records that are not themes are left out');
  const offered = await a.themes.offeredThemes();
  assert.ok(offered.some((t) => t.id === 'from-the-desk'));
  assert.ok(offered.some((t) => t.id === mine.id));
  assert.ok(result.sent >= 1);

  /* The next sync does not send it again. */
  const again = server();
  await a.sync.sync({ fetchImpl: again.fetchImpl });
  assert.deepEqual(again.calls[0]?.push.themes, []);
});

test('the later edit wins whichever device made it, and a deletion travels', async () => {
  const a = await app();
  const minuit = builtIn('minuit')!;
  const here = await a.themes.saveTheme({ ...minuit, colours: { ...minuit.colours, accent: '#ff0000' } });

  /* An older edit from the other device does not overwrite this one... */
  await a.sync.sync({ fetchImpl: server({
    themes: [{ ...here, colours: { ...minuit.colours, accent: '#00ff00' }, updatedAt: ms(here.updatedAt - 1000) }],
  }).fetchImpl });
  assert.equal((await a.themes.offeredThemes()).find((t) => t.id === 'minuit')?.colours.accent, '#ff0000');

  /* ...a newer one does... */
  await a.sync.sync({ fetchImpl: server({
    themes: [{ ...here, colours: { ...minuit.colours, accent: '#00ff00' }, updatedAt: ms(here.updatedAt + 1000) }],
  }).fetchImpl });
  assert.equal((await a.themes.offeredThemes()).find((t) => t.id === 'minuit')?.colours.accent, '#00ff00');

  /* ...and a newer tombstone puts the theme that ships back. */
  await a.sync.sync({ fetchImpl: server({
    themes: [{ ...here, updatedAt: ms(here.updatedAt + 2000), deleted: true }],
  }).fetchImpl });
  const now = (await a.themes.offeredThemes()).find((t) => t.id === 'minuit')!;
  assert.ok(!isEdited(now));
  assert.equal(now.colours.accent, minuit.colours.accent);
});

test('the export carries the themes with everything else', async () => {
  const a = await app();
  const copy = await a.themes.copyTheme(builtIn('foret')!);
  const out = await a.db.exportProgress();
  assert.deepEqual(out.themes.map((t) => t.id), [copy.id]);
});

test('an edit made while a sync is in flight is kept, and reaches the server on the next', async () => {
  /* The sync read every theme before the request went out and wrote the lot
     back after; a colour changed in between was written over by the stale
     copy, and never pushed either, since the sync's own stamp was later than
     the edit's. Now each record is laid over what is in the store when the
     answer comes. */
  const a = await app();
  const minuit = builtIn('minuit')!;
  let answer: () => void = () => {};
  const held = new Promise<void>((resolve) => { answer = resolve; });
  const fetchImpl: typeof fetch = async () => {
    await held;
    return new Response(JSON.stringify({ pull: {}, cursor: 1 }),
      { headers: { 'content-type': 'application/json' } });
  };
  const inFlight = a.sync.sync({ fetchImpl });
  await new Promise((r) => setTimeout(r, 20));      /* the request is out, the store was read */
  const edited = await a.themes.saveTheme({ ...minuit, colours: { ...minuit.colours, accent: '#ff0000' } });
  answer();
  await inFlight;
  assert.equal((await a.themes.offeredThemes()).find((t) => t.id === 'minuit')?.colours.accent, '#ff0000',
    'the edit is still there after the sync wrote back');
  const next = server();
  await a.sync.sync({ fetchImpl: next.fetchImpl });
  assert.deepEqual(next.calls[0]?.push.themes?.map((t) => (t as Theme).updatedAt), [edited.updatedAt],
    'and the next sync pushes it');
});
