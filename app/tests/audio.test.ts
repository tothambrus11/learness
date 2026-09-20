import { test } from 'vitest';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { freshApp } from './harness.js';
import { clip, ms, word } from './make.js';

/** Object URLs do not exist in Node; what matters here is which blob was
 *  handed out, so each one is given a name of its own. */
function stubObjectUrls(): { urlOf: Map<string, Blob>; revoked: string[] } {
  const urlOf = new Map<string, Blob>();
  const revoked: string[] = [];
  let n = 0;
  /* The two statics only, onto the real URL: replacing the class itself breaks
     every other use of it, which in this app is most of the fetching. */
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource): string => {
    const url = `blob:${++n}`;
    urlOf.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string): void => { revoked.push(url); });
  return { urlOf, revoked };
}

test('a catalogue word plays the file the pipeline shipped', async () => {
  await freshApp();
  const { srcFor } = await import('../src/lib/audio.js');
  const w = word({ audio: 'frcog-1.mp3', native: 'frcog-1-nat.mp3', cue_audio: 'frcog-1-en.mp3' });
  assert.equal(await srcFor(w, 'fr'), '/media/frcog-1.mp3');
  assert.equal(await srcFor(w, 'native'), '/media/frcog-1-nat.mp3');
  assert.equal(await srcFor(w, 'en'), '/media/frcog-1-en.mp3');
});

test('a word with no recording of its own falls back to the one it has', async () => {
  await freshApp();
  const { srcFor } = await import('../src/lib/audio.js');
  const onlyNative = word({ audio: null, native: 'nat.mp3' });
  assert.equal(await srcFor(onlyNative, 'fr'), '/media/nat.mp3');
  assert.equal(await srcFor(word({ audio: null, native: null }), 'fr'), null,
    'and nothing where there is nothing');
});

test('one of your own words plays the clip made on this device', async () => {
  const app = await freshApp();
  stubObjectUrls();
  const { srcFor } = await import('../src/lib/audio.js');
  const mine = word({ k: 'natel|noun', fr: 'le natel', answer: 'le natel', pos: 'noun',
    gender: 'm', audio: null, native: null, user: true, en: ['mobile phone'] });
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
    text: 'le natel' }));

  const src = await srcFor(mine, 'fr');
  assert.match(String(src), /^blob:/);
  assert.equal(await srcFor(mine, 'fr'), src, 'made once, then handed out again');
});

test('a clip that no longer says what the word says is not played', async () => {
  const app = await freshApp();
  stubObjectUrls();
  const { srcFor } = await import('../src/lib/audio.js');
  const mine = word({ k: 'natel|noun', fr: "l'erreur", answer: "l'erreur", pos: 'noun',
    gender: 'f', audio: null, native: null, user: true, en: ['mistake'] });
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
    text: 'le natel' }));
  assert.equal(await srcFor(mine, 'fr'), null,
    'it says the old spelling, and teaching that back is worse than silence');
});

test('a clip made again is not played from the URL of the one before', async () => {
  /* A remade clip keeps its id, and the object URL was kept by id: after a
     correction that arrived by sync — no forgetSrc on this device — the word
     played the old blob until the app was reloaded. */
  const app = await freshApp();
  const { urlOf, revoked } = stubObjectUrls();
  const { srcFor } = await import('../src/lib/audio.js');
  const mine = word({ k: 'natel|noun', fr: 'le natel', answer: 'le natel', pos: 'noun',
    gender: 'm', audio: null, native: null, user: true, en: ['mobile phone'] });
  const id = 'natel|noun|fr|supertonic';
  await app.db.putClip(clip({ id, key: 'natel|noun', kind: 'fr', text: 'le natel',
    blob: new Blob(['first']), createdAt: ms(1) }));
  const before = await srcFor(mine, 'fr');
  await app.db.putClip(clip({ id, key: 'natel|noun', kind: 'fr', text: 'le natel',
    blob: new Blob(['second']), createdAt: ms(2) }));
  const after = await srcFor(mine, 'fr');
  assert.notEqual(after, before, 'a newer clip is a newer URL');
  assert.equal(await urlOf.get(String(after))!.text(), 'second');
  assert.deepEqual(revoked, [before], 'and the old one is given back');
  assert.equal(await srcFor(mine, 'fr'), after, 'then kept, as before');
});

/* -------------------------------------------------- where audio is offered -- */

test('Make audio is offered only on a face that can then play what it makes', async () => {
  /* #51: on the front of a "say it in French" card the English is showing,
     the French is the answer, and the button made a clip that face could not
     play — then went away. */
  await freshApp();
  const { voiceWorkOffered } = await import('../src/lib/audio.js');
  const { ALL_RUNGS, HEARD_FIRST } = await import('../src/lib/keys.js');
  for (const rung of ALL_RUNGS) {
    assert.equal(voiceWorkOffered(rung, true), true, `${rung}: the back has the sound buttons`);
    assert.equal(voiceWorkOffered(rung, false), HEARD_FIRST.has(rung),
      `${rung}: the front only where the French is the question`);
  }
  assert.equal(voiceWorkOffered('write', false), false, 'the case the issue was about');
  assert.equal(voiceWorkOffered('hear', false), true);
});

/* ----------------------------------------------------- which voice says it -- */

test('once the voice is on the device, a sentence, a form, a cue and a bare word are all its to say',
  async () => {
    /* #44: the sentences on a card went to the browser's voice with the
       on-device one downloaded beside it. With the model here, no source list
       offers the browser's voice at all — not even behind the clip. */
    await freshApp();
    const { card } = await import('./make.js');
    const { sentenceSources, spokenSources, wordSources } = await import('../src/lib/audio.js');
    const here = { model: true, browser: { fr: true, en: true } };
    const w = word({ audio: null, native: null, cue_audio: null, en: ['bug; insect'],
      ex: [{ fr: 'Il y a un bug.', f: 'bug', en: 'There is a bug.' }] });

    const sentence = sentenceSources({ card: card('bug|noun', 'written', 'use'), word: w }, here);
    assert.deepEqual(sentence,
      [{ phrase: { key: 'bug|noun', slot: 'ex0', text: 'Il y a un bug.', lang: 'fr' } }]);

    const cue = wordSources(w, 'en', here);
    assert.equal(cue.length, 2, 'the recording, then the voice');
    assert.deepEqual(cue[1], { phrase: { key: 'bug|noun', slot: 'cue', text: 'bug', lang: 'en' } },
      'the English cue too, in English, under the word’s own clip');
    assert.deepEqual(wordSources(w, 'fr', here)[1],
      { phrase: { key: 'bug|noun', slot: 'word', text: 'le bug', lang: 'fr' } });
    assert.deepEqual(spokenSources('parler|verb', 'conj:pres:0', 'je parle', 'form', here),
      [{ phrase: { key: 'parler|verb', slot: 'conj:pres:0', text: 'je parle', lang: 'fr' } }]);
  });

test('until the voice is here the browser’s reads what it can, and a device with neither offers nothing',
  async () => {
    await freshApp();
    const { card } = await import('./make.js');
    const { sentenceSources, wordSources } = await import('../src/lib/audio.js');
    const { NO_SPEAKERS } = await import('../src/lib/engine.js');
    const w = word({ audio: null, native: null, cue_audio: null,
      ex: [{ fr: 'Il y a un bug.', f: 'bug', en: 'There is a bug.' }] });
    const item = { card: card('bug|noun', 'written', 'use'), word: w };

    const browser = { model: false, browser: { fr: true, en: true } };
    assert.deepEqual(sentenceSources(item, browser),
      [{ say: 'Il y a un bug.', lang: 'fr-FR', rate: 0.9 }]);
    assert.deepEqual(wordSources(w, 'en', browser)[1], { say: 'bug', lang: 'en-GB' });
    assert.deepEqual(wordSources(w, 'fr', browser)[1], { say: 'le bug', lang: 'fr-FR' });

    const englishOnly = { model: false, browser: { fr: false, en: true } };
    assert.deepEqual(sentenceSources(item, englishOnly), [], 'French is not read in an English voice');
    assert.equal(wordSources(w, 'fr', englishOnly).length, 1, 'the recording alone');
    assert.equal(wordSources(w, 'en', englishOnly).length, 2);

    assert.deepEqual(sentenceSources(item, NO_SPEAKERS), []);
    assert.equal(wordSources(w, 'fr', NO_SPEAKERS).length, 1);
  });

test('the French can be heard when there is a recording, or a voice here that says words', async () => {
  /* #81: a word without a recording lost its "play it again" and its `s`
     while the speaker on the front said it fine, because the recording alone
     decided. What decides is the same voice a play falls back to. */
  const { canSayFrench } = await import('../src/lib/audio.js');
  const none = { model: false, browser: { fr: false, en: false } };
  assert.equal(canSayFrench(true, none), true, 'a recording is enough');
  assert.equal(canSayFrench(false, none), false, 'nothing here can say it');
  assert.equal(canSayFrench(false, { model: false, browser: { fr: true, en: false } }), true,
    'the browser has a French voice');
  assert.equal(canSayFrench(false, { model: true, browser: { fr: false, en: false } }), true,
    'the on-device voice says everything');
  assert.equal(canSayFrench(false, { model: false, browser: { fr: false, en: true } }), false,
    'an English voice does not say French');
});
