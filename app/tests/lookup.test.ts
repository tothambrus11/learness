/** What a word on the screen is, looked up the way the popup looks it up:
 *  the catalogue, the dictionary and the essential verbs, over a real
 *  database and a served catalogue. */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp, smallCatalogue } from './harness.js';
import { asked, entry, word } from './make.js';

/** The harness's catalogue, a verb in it, and a small dictionary beside it:
 *  *la clé* under c, and *suivre*'s table under s. */
async function app(): Promise<void> {
  const catalogue = smallCatalogue(3);
  catalogue.index.push(entry({ k: 'parler|verb', fr: 'parler', en: ['to speak'], lvl: 1, m: 0.001 }));
  catalogue.words.push(word({ k: 'parler|verb', fr: 'parler', answer: 'parler', lemma: 'parler', en: ['to speak'],
    pos: 'verb', lvl: 1, ipa: '/paʁ.le/' }));
  await freshApp({ catalogue });
  const served = globalThis.fetch;
  const body = (data: unknown): Response => new Response(JSON.stringify(data));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = asked(input);
    if (url.endsWith('/catalogue/meta.json')) {
      const meta = await (await served(input)).json() as Record<string, unknown>;
      return body({ ...meta, dictionary: { letters: ['c', 's'], words: 2, tables: ['s'] } });
    }
    if (url.endsWith('/dict-c.json')) {
      return body({ v: 1, letter: 'c', words: [{ fr: 'la clé', en: ['key'], pos: 'noun', gender: 'f', ipa: '/kle/' }] });
    }
    if (url.endsWith('/dict-s.json')) {
      return body({ v: 1, letter: 's', words: [{ fr: 'suivre', en: ['to follow'], pos: 'verb', ipa: '/sɥivʁ/' }] });
    }
    if (url.endsWith('/dict-conj-s.json')) {
      return body({ v: 1, letter: 's', tables: { 'suivre|verb': { lemma: 'suivre', aux: 'avoir', shape: '', links: [],
        examples: {}, impersonal: [], compound: [],
        groups: [{ id: 'pres', mood: '', tense: '', stem: '', irregular: true, note: '',
          rows: [{ p: 'il', s: 'sui', e: 't', f: 'suit' }] }] } } });
    }
    if (/\/dict(-conj)?-[a-z]+\.json$/.test(url)) return new Response('', { status: 404 });
    return served(input);
  });
}

test('a form on the screen is looked up under its headword, with how it comes from it', async () => {
  await app();
  const { lookUp } = await import('../src/lib/lookup.js');
  const nouns = smallCatalogue(3).index;
  const first = nouns[0]!.fr.replace(/^le /, '');

  const plural = await lookUp(`${first}s`);
  assert.equal(plural[0]?.fr, `le ${first}`, 'a plural, under its singular');
  assert.equal(plural[0]?.via, 'plural of');
  assert.equal(plural[0]?.gender, 'm', 'with the gender the catalogue gives it');

  const verb = await lookUp('parlons');
  assert.equal(verb[0]?.key, 'parler|verb', 'a conjugated form, under its infinitive');
  assert.equal(verb[0]?.ipa, '/paʁ.le/');
  assert.equal(verb[0]?.via, 'a form of');

  const cle = await lookUp('clés');
  assert.deepEqual(cle[0] && { fr: cle[0].fr, gender: cle[0].gender, ipa: cle[0].ipa, en: cle[0].en },
    { fr: 'la clé', gender: 'f', ipa: '/kle/', en: ['key'] }, 'a word only the dictionary knows');

  const suit = await lookUp('suit');
  assert.equal(suit[0]?.key, 'suivre|verb', 'an irregular form, found in the verb tables');

  const suis = await lookUp('Suis');
  assert.equal(suis[0]?.key, 'être|verb', 'an essential verb’s form, which no table under s has');
  assert.equal(suis[0]?.en[0], 'to be');

  const frere = await lookUp('frères');
  assert.deepEqual(frere[0] && { fr: frere[0].fr, gender: frere[0].gender, en: frere[0].en, via: frere[0].via },
    { fr: 'le frère', gender: 'm', en: ['brother'], via: 'plural of' },
    'a noun the possessives sheet set, though no catalogue has it');

  assert.deepEqual(await lookUp('xyzzy'), [], 'nothing known: nothing, and no error');
});
