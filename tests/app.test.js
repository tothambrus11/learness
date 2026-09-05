/* Tests for the app's answer checking and scheduler. Run: node tests/app.test.js */
const assert = require('assert');
global.window = {};
const fakeStore = new Map();
global.localStorage = {
  getItem: k => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => fakeStore.set(k, String(v)),
  removeItem: k => fakeStore.delete(k),
};
global.document = { querySelector: () => null, querySelectorAll: () => [],
                    createElement: () => ({ style: {}, classList: { add(){}, toggle(){}, remove(){} },
                                            appendChild(){}, setAttribute(){} }) };
global.speechSynthesis = { getVoices: () => [], cancel(){}, speak(){} };
const m = require('../app/app.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

const bug = { id: 1, fr: 'le bug', answer: 'le bug', lemma: 'bug', en: ['bug'], ipa: '' };
const dev = { id: 2, fr: 'le développement', answer: 'le développement',
              lemma: 'développement', en: ['development'], ipa: '' };

t('normalises accents and ligatures', () => {
  assert.strictEqual(m.norm('Développé'), 'developpe');
  assert.strictEqual(m.norm('œuf'), 'oeuf');
  assert.strictEqual(m.norm('  Le   BUG '), 'le bug');
});

t('exact typed answer is correct', () => {
  assert.strictEqual(m.checkFrench('le bug', bug).verdict, 'ok');
});

t('missing accents are accepted with a correction', () => {
  assert.strictEqual(m.checkFrench('le developpement', dev).verdict, 'accent');
});

t('missing article is accepted but flagged', () => {
  assert.strictEqual(m.checkFrench('bug', bug).verdict, 'article');
  assert.strictEqual(m.checkFrench('développement', dev).verdict, 'article');
});

t('a typo is "close", not wrong', () => {
  assert.strictEqual(m.checkFrench('le developement', dev).verdict, 'close');
});

t('a different word is wrong', () => {
  assert.strictEqual(m.checkFrench('la voiture', bug).verdict, 'no');
});

t('english side accepts any stored translation', () => {
  const chat = { en: ['cat', 'tom', 'tomcat'] };
  assert.strictEqual(m.checkEnglish('tomcat', chat).verdict, 'ok');
  assert.strictEqual(m.checkEnglish('a cat', chat).verdict, 'ok');
  assert.strictEqual(m.checkEnglish('dog', chat).verdict, 'no');
});

t('spoken answers are graded leniently across STT alternatives', () => {
  assert.strictEqual(m.checkSpoken(['le bug'], bug).verdict, 'ok');
  assert.strictEqual(m.checkSpoken(['bug'], bug).verdict, 'ok');
  /* STT commonly returns a near-miss first and the right word second */
  assert.strictEqual(m.checkSpoken(['bugue', 'le bug'], bug).verdict, 'ok');
  assert.strictEqual(m.checkSpoken(['bonjour'], bug).verdict, 'no');
});

t('silence is not counted as correct', () => {
  assert.strictEqual(m.checkSpoken([], bug).verdict, 'no');
});

t('scheduler: again resets and shortens', () => {
  const st = m.schedule({ r: 5, l: 0, i: 30, e: 2.5, d: 0, s: 2 }, 1);
  assert.strictEqual(st.i, 0);
  assert.strictEqual(st.l, 1);
  assert.ok(st.d - Date.now() < 5 * 60000);
});

t('scheduler: a new card graduates through learning steps', () => {
  let st = m.schedule(null, 3);
  assert.strictEqual(st.i, 0, 'first correct stays in learning');
  st = m.schedule(st, 3);
  assert.strictEqual(st.i, 1, 'second correct graduates to one day');
  st = m.schedule(st, 3);
  assert.ok(st.i >= 2, 'then intervals grow');
});

t('scheduler: intervals grow and reach maturity', () => {
  let st = m.schedule(null, 3);
  for (let i = 0; i < 8; i++) st = m.schedule(st, 3);
  assert.ok(st.i >= m.MATURE_DAYS, `expected mature, got ${st.i}`);
});

t('unlock graph matches the python config', () => {
  assert.deepStrictEqual(m.PREREQ,
    { en_fr: 'fr_en', audio_fr: 'en_fr', audio_en: 'fr_en' });
  assert.ok(!('speak' in m.PREREQ), 'walking mode must be usable on day one');
});

// --- saved progress ---------------------------------------------------------

t('a fresh browser starts from a blank state', () => {
  fakeStore.clear();
  const s = m.load();
  assert.deepStrictEqual(s.states, {});
  assert.strictEqual(s.settings.newPerDay, 15);
});

t('saved progress is read back', () => {
  fakeStore.clear();
  fakeStore.set(m.STORE_KEY, JSON.stringify({
    v: 1, states: { '7|fr_en': { r: 3, l: 0, i: 30, e: 2.5, d: 1, s: 2 } },
    reviews: [{ w: 7, d: 'fr_en', t: 1, g: 3 }],
    daily: { day: '1999-01-01', new: 4, rev: 9 },
    streak: { last: '1999-01-01', n: 2 }, settings: { newPerDay: 25 },
  }));
  const s = m.load();
  assert.strictEqual(s.states['7|fr_en'].i, 30, 'card state survives');
  assert.strictEqual(s.reviews.length, 1, 'review log survives');
  assert.strictEqual(s.settings.newPerDay, 25, 'settings survive');
  assert.strictEqual(s.streak.n, 2, 'streak survives');
  assert.strictEqual(s.daily.new, 0, 'the daily new counter resets on a new day');
});

t('corrupt storage is preserved, not silently wiped', () => {
  fakeStore.clear();
  fakeStore.set(m.STORE_KEY, '{not valid json');
  const s = m.load();
  assert.deepStrictEqual(s.states, {}, 'falls back to a usable state');
  const kept = [...fakeStore.keys()].filter(k => k.includes('corrupt'));
  assert.strictEqual(kept.length, 1, 'the unreadable copy is kept');
});

t('state written by an older version is repaired, not discarded', () => {
  fakeStore.clear();
  fakeStore.set(m.STORE_KEY, JSON.stringify({
    v: 1, states: { '9|fr_en': { r: 1, l: 0, i: 5, e: 2.5, d: 1, s: 2 } },
  }));
  const s = m.load();
  assert.strictEqual(s.states['9|fr_en'].i, 5, 'existing cards are kept');
  assert.ok(Array.isArray(s.reviews), 'missing fields are filled in');
  assert.ok(s.daily && s.settings && s.streak);
});

console.log(`${pass} JS tests passed`);
