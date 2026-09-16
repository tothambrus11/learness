import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { asked } from './make.js';

async function load(): Promise<typeof import('../src/lib/prefetch.js')> {
  vi.resetModules();
  return import('../src/lib/prefetch.js');
}

/** A network that answers, or refuses the files it is told to refuse. */
function serving(refuse: Set<string> = new Set(), dropFirst = new Set<string>()): {
  tried: string[];
  fetchImpl: typeof fetch;
} {
  const tried: string[] = [];
  const fetchImpl: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = asked(input);
    tried.push(url);
    const file = url.split('/').pop() ?? '';
    if (dropFirst.has(file)) {
      dropFirst.delete(file);
      throw new Error('connection lost');
    }
    if (refuse.has(file)) return new Response('', { status: 404 });
    return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } });
  };
  return { tried, fetchImpl };
}

test('a session’s clips are fetched, earliest first, a few at a time', async () => {
  const { prefetchMedia } = await load();
  const { tried, fetchImpl } = serving();
  vi.stubGlobal('fetch', fetchImpl);
  const files = ['a.mp3', 'b.mp3', 'c.mp3', 'a.mp3', null, ''];
  const result = await prefetchMedia(files, { concurrency: 2 }).done;
  assert.equal(result.total, 3, 'the same clip twice is one fetch, and nothing is not a clip');
  assert.equal(result.done, 3);
  assert.equal(result.failed, 0);
  const files_asked = tried.map((u) => u.split('/').pop() ?? '');
  assert.deepEqual(files_asked.sort((a, b) => a.localeCompare(b)),
    ['a.mp3', 'b.mp3', 'c.mp3']);
});

test('a clip dropped by a flaky connection is tried once more', async () => {
  const { prefetchMedia } = await load();
  const { tried, fetchImpl } = serving(new Set(), new Set(['b.mp3']));
  vi.stubGlobal('fetch', fetchImpl);
  const result = await prefetchMedia(['a.mp3', 'b.mp3']).done;
  assert.equal(result.failed, 0, 'the second go got it');
  assert.equal(tried.filter((u) => u.endsWith('b.mp3')).length, 2);
});

test('a clip the server does not have is reported, not retried for ever', async () => {
  const { prefetchMedia } = await load();
  const { fetchImpl } = serving(new Set(['gone.mp3']));
  vi.stubGlobal('fetch', fetchImpl);
  const result = await prefetchMedia(['a.mp3', 'gone.mp3']).done;
  assert.equal(result.failed, 1);
  assert.deepEqual(result.missing, ['gone.mp3']);
});

test('a recording already written down as missing is not written down again', async () => {
  /* Two files the server never had were reported at every sitting — 06:10,
     15:54, 16:58, 18:10, 20:21, 20:47 on one day — until the notes were six
     copies of the same sentence and nothing else (#61). */
  const { prefetchMedia } = await load();
  const d = await import('../src/lib/diagnostics.js');
  const { fetchImpl } = serving(new Set(['frcog-5585.mp3', 'frcog-5395.mp3', 'frcog-9.mp3']));
  vi.stubGlobal('fetch', fetchImpl);
  await prefetchMedia(['frcog-5585.mp3', 'frcog-5395.mp3']).done;
  await prefetchMedia(['frcog-5395.mp3', 'a.mp3', 'frcog-5585.mp3']).done;
  const notes = d.all().filter((n) => n.where === 'media');
  assert.equal(notes.length, 1, 'the second sitting had nothing new to say');
  assert.equal(notes[0]?.what, '2 recordings could not be fetched: frcog-5585.mp3, frcog-5395.mp3');
  const third = await prefetchMedia(['frcog-5585.mp3', 'frcog-9.mp3']).done;
  assert.deepEqual(third.missing, ['frcog-5585.mp3', 'frcog-9.mp3'], 'the result still says both');
  assert.deepEqual(d.all().filter((n) => n.where === 'media').map((n) => n.what), [
    '2 recordings could not be fetched: frcog-5585.mp3, frcog-5395.mp3',
    '1 recording could not be fetched: frcog-9.mp3',
  ], 'a new one is written down, on its own');
});

test('a file is reported again only once its note is gone', async () => {
  const { unreported } = await load();
  const { nowMs } = await import('../src/lib/units.js');
  const note = (where: string, what: string) => ({ at: nowMs(), where, what });
  const missing = ['frcog-5585.mp3', 'frcog-5395.mp3'];
  assert.deepEqual(unreported(missing, []), missing, 'nothing written down yet');
  assert.deepEqual(unreported(missing, [note('media', '1 recording could not be fetched: frcog-5585.mp3')]),
    ['frcog-5395.mp3'], 'the one already named is left out');
  assert.deepEqual(unreported(missing, [note('sound', 'This word’s recording is missing: frcog-5585.mp3')]),
    missing, 'a note from the player is about a card, not the warm-up');
  assert.deepEqual(unreported(['frcog-585.mp3'], [note('media', '1 recording could not be fetched: frcog-5585.mp3')]),
    ['frcog-585.mp3'], 'a name inside another name is not that name');
});

test('a page wearing a clip’s name is missing, however cheerful its status', async () => {
  /* The server used to answer every path it did not have with the app itself,
     200 and all. A warm-up that believed it filled the offline cache with
     pages that decode as nothing, and the card went quiet with no error
     anywhere but the console. */
  const { prefetchMedia } = await load();
  vi.stubGlobal('fetch', async (): Promise<Response> =>
    new Response('<!doctype html><title>Learness</title>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const result = await prefetchMedia(['gone.mp3']).done;
  assert.equal(result.failed, 1);
  assert.deepEqual(result.missing, ['gone.mp3']);
});

test('stopping leaves the rest of the queue alone', async () => {
  const { prefetchMedia } = await load();
  const { tried, fetchImpl } = serving();
  vi.stubGlobal('fetch', fetchImpl);
  const job = prefetchMedia(Array.from({ length: 50 }, (_, i) => `${i}.mp3`), { concurrency: 1 });
  job.stop();
  const result = await job.done;
  assert.ok(tried.length < 50, `stopped after ${tried.length}`);
  assert.ok(result.done < 50);
});

test('offline, nothing is asked for and nothing is claimed', async () => {
  const { prefetchMedia } = await load();
  vi.stubGlobal('navigator', { onLine: false });
  const { tried, fetchImpl } = serving();
  vi.stubGlobal('fetch', fetchImpl);
  const result = await prefetchMedia(['a.mp3']).done;
  assert.deepEqual(tried, []);
  assert.deepEqual(result, { done: 0, failed: 0, total: 1 });
  vi.unstubAllGlobals();
});

test('what is already kept for offline is counted without a network', async () => {
  const { cachedCount } = await load();
  vi.stubGlobal('caches', {
    open: async () => ({
      keys: async () => [{ url: 'http://localhost/media/a.mp3' }],
    }),
  });
  assert.equal(await cachedCount(['a.mp3', 'b.mp3', null]), 1);
  vi.unstubAllGlobals();
  assert.equal(await cachedCount(['a.mp3']), 0, 'a browser with no cache storage says none');
});
