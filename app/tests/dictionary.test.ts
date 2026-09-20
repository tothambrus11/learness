/** The dictionary the words screen fills a form from.
 *
 *  Adding a word the catalogue does not teach used to mean typing its English,
 *  its part of speech and its gender from memory (#37). The pipeline ships
 *  what it passed over, a file per first letter, and these are the rules that
 *  turn what someone typed into one fetch and a few answers.
 */
import { expect, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { DictEntry } from '../src/lib/dictionary.js';
import { asked } from './make.js';

const WORDS: Record<string, DictEntry[]> = {
  c: [
    { fr: 'la chaussette', en: ['sock'], pos: 'noun', gender: 'f', ipa: '/ʃo.sɛt/' },
    { fr: 'le chausson', en: ['slipper'], pos: 'noun', gender: 'm' },
    { fr: 'le cheval', en: ['horse'], pos: 'noun', gender: 'm' },
  ],
  p: [{ fr: 'plonger', en: ['to dive', 'to plunge'], pos: 'verb' }],
};

/** The app, with a catalogue that ships a dictionary — or one that does not. */
async function load({ letters = Object.keys(WORDS), words = 4 } = {}): Promise<{
  dictionary: typeof import('../src/lib/dictionary.js');
  fetched: string[];
}> {
  const fetched: string[] = [];
  const body = (data: unknown): Response =>
    new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = asked(input);
    fetched.push(url);
    if (url.endsWith('/catalogue/meta.json')) {
      return body({ v: 1, recipe: 'fixture', levelSize: 100, levels: [1], words: 6, verbs: 0,
        ceiling: 0.5, directions: [], examples: '',
        ...(letters.length ? { dictionary: { letters, words } } : {}) });
    }
    const shard = /\/catalogue\/dict-([a-z]+)\.json$/.exec(url);
    if (shard) {
      const letter = shard[1] ?? '';
      return WORDS[letter] ? body({ v: 1, letter, words: WORDS[letter] })
        : new Response('Not found', { status: 404 });
    }
    throw new Error(`nothing serves ${url} in a test`);
  });
  vi.resetModules();
  return { dictionary: await import('../src/lib/dictionary.js'), fetched };
}

test('the letter typed is the index: one lookup is one fetch', async () => {
  const { dictionary, fetched } = await load();
  const hits = await dictionary.lookup('chaussette');
  assert.deepEqual(hits.map((h) => h.fr), ['la chaussette']);
  const shards = fetched.filter((u) => u.includes('dict-'));
  assert.deepEqual(shards.map((u) => u.split('/').pop()), ['dict-c.json'],
    'the c words, and no others: the dictionary is never loaded whole');
});

test('a word is found by what a learner types, article or no article', async () => {
  const { dictionary } = await load();
  for (const typed of ['chaussette', 'la chaussette', 'Chaussette', 'chaussettes'.slice(0, 10)]) {
    const hits = await dictionary.lookup(typed);
    assert.equal(hits[0]?.fr, 'la chaussette', typed);
  }
});

test('the shorter word wins the prefix it shares', async () => {
  /* "chauss" is the start of both, and "le chausson" is the nearer answer to
     someone who has typed six letters. */
  const { dictionary } = await load();
  const hits = await dictionary.lookup('chauss');
  assert.deepEqual(hits.map((h) => h.fr), ['le chausson', 'la chaussette']);
});

test('a word comes with everything the form would have asked for', async () => {
  const { dictionary } = await load();
  const [sock] = await dictionary.lookup('chaussette');
  assert.deepEqual(sock, { fr: 'la chaussette', en: ['sock'], pos: 'noun', gender: 'f',
    ipa: '/ʃo.sɛt/' });
  const [dive] = await dictionary.lookup('plonger');
  assert.equal(dive?.pos, 'verb');
  assert.deepEqual(dive?.en, ['to dive', 'to plunge']);
  assert.equal(dive?.gender, undefined, 'a verb has none, and none is not empty');
});

test('a letter the catalogue ships nothing for is not asked for', async () => {
  const { dictionary, fetched } = await load({ letters: ['c'] });
  assert.deepEqual(await dictionary.lookup('plonger'), []);
  assert.equal(fetched.some((u) => u.includes('dict-p')), false);
});

test('a catalogue that ships no dictionary is asked for nothing', async () => {
  /* Built before the dictionary existed, or built without the extract. */
  const { dictionary, fetched } = await load({ letters: [] });
  assert.equal(await dictionary.shipped(), null);
  assert.deepEqual(await dictionary.lookup('chaussette'), []);
  assert.equal(fetched.some((u) => u.includes('dict-')), false);
});

test('a shard that will not load is a search with no answers, and a note', async () => {
  /* Nothing fails silently: the note is what the settings screen shows and
     the bug button carries. */
  const { dictionary } = await load({ letters: ['c', 'p', 'z'] });
  assert.deepEqual(await dictionary.lookup('zebre'), []);
  const { all } = await import('../src/lib/diagnostics.js');
  expect(all().map((n) => `${n.where}: ${n.what}`).join('\n')).toContain('dict-z.json');
});

test('which file a query is answered from, folded the way the pipeline files it',
  async () => {
    const { dictionary } = await load();
    assert.equal(dictionary.shardOf('chaussette'), 'c');
    assert.equal(dictionary.shardOf('la chaussette'), 'c', 'the article is not the word');
    assert.equal(dictionary.shardOf('Étable'), 'e', 'accents fold, as the search folds them');
    assert.equal(dictionary.shardOf("l'oubli"), 'o');
    assert.equal(dictionary.shardOf('œuf'), dictionary.OTHER);
    assert.equal(dictionary.shardOf(''), dictionary.OTHER);
  });

test('a letter that would not load this time is asked for again the next', async () => {
  /* A 503 from a server restarting used to be remembered as "that letter is
     empty" until the app was reloaded. */
  const { dictionary, fetched } = await load({ letters: ['c', 'p', 'z'] });
  assert.deepEqual(await dictionary.lookup('zebre'), []);
  assert.deepEqual(await dictionary.lookup('zebre'), []);
  assert.equal(fetched.filter((u) => u.includes('dict-z')).length, 2, 'asked again');
});

test('the same letter is fetched once, however many times it is typed', async () => {
  const { dictionary, fetched } = await load();
  await dictionary.lookup('chauss');
  await dictionary.lookup('cheval');
  assert.equal(fetched.filter((u) => u.includes('dict-c')).length, 1);
});

test('a dictionary verb has its table, from a file of tables per letter, fetched only when asked for', async () => {
  /* A verb added from the dictionary had no table to show, while one from
     the curriculum did (#91). The tables are many times the size of the
     words, so they are a file of their own per letter, named in meta.json,
     and fetched the first time such a verb is opened. */
  const fetched: string[] = [];
  const body = (data: unknown): Response =>
    new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  const table = { lemma: 'plonger', aux: 'avoir', shape: '', groups: [], compound: [], impersonal: [],
    links: [], examples: {} };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = asked(input);
    fetched.push(url);
    if (url.endsWith('/catalogue/meta.json')) {
      return body({ v: 1, recipe: 'fixture', levelSize: 100, levels: [1], words: 6, verbs: 0,
        ceiling: 0.5, directions: [], examples: '',
        dictionary: { letters: ['c', 'p'], words: 4, tables: ['p'] } });
    }
    if (url.endsWith('/catalogue/dict-conj-p.json')) {
      return body({ v: 1, letter: 'p', tables: { 'plonger|verb': table } });
    }
    return new Response('not here', { status: 404 });
  });
  vi.resetModules();
  const dictionary = await import('../src/lib/dictionary.js');
  const { trustWordKey } = await import('../src/lib/keys.js');

  assert.deepEqual(await dictionary.tableOf(trustWordKey('plonger|verb')), table);
  assert.equal(await dictionary.tableOf(trustWordKey('plongeon|verb')), null, 'a verb the file does not have');
  assert.equal(await dictionary.tableOf(trustWordKey('chausser|verb')), null,
    'a letter with no file is not fetched, let alone reported');
  assert.equal(await dictionary.tableOf(trustWordKey('chaussette|noun')), null, 'not a verb');
  assert.deepEqual(fetched.filter((u) => u.includes('dict-conj')), [`/catalogue/dict-conj-p.json`].map((p) => fetched.find((u) => u.endsWith(p))!),
    'one fetch for the letter, however many verbs are asked');
});
