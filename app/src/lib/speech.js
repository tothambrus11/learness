/** The browser's own voice, for the walk's English cue when a word has no
 *  recorded one, and the screen lock that keeps the walk on screen.
 *
 *  There is deliberately no listening here. A recogniser is biased toward real
 *  words and quietly corrects a mispronunciation, and it drops the article —
 *  which is the gender — so it could never grade the thing the card teaches.
 *  Saying the word is judged by the person who said it.
 */

export const canSpeak = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof SpeechSynthesisUtterance !== 'undefined';

let voicesLoaded = null;
function voices() {
  if (!voicesLoaded) {
    voicesLoaded = new Promise((resolve) => {
      const have = speechSynthesis.getVoices();
      if (have.length) return resolve(have);
      speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()),
        { once: true });
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }
  return voicesLoaded;
}

/** British English before American, for a Swiss-based learner used to it. */
async function englishVoice() {
  const all = await voices();
  const en = all.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  return en.find((v) => /gb/i.test(v.lang)) || en.find((v) => v.default) || en[0] || null;
}

/** Resolves when the utterance has been spoken, or straight away when it
 *  cannot be, so a walk never stalls on a silent device. */
export async function say(text, { lang = 'en-GB' } = {}) {
  if (!canSpeak() || !text) return false;
  const voice = await englishVoice();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || lang;
    try { if (voice) u.voice = voice; } catch { /* the engine picks one by lang */ }
    u.rate = 0.95;
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    u.onend = () => done(true);
    u.onerror = () => done(false);
    /* Some engines never fire onend for an utterance they dropped. */
    setTimeout(() => done(false), 1000 + text.length * 120);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

export function hush() {
  if (canSpeak()) speechSynthesis.cancel();
}

/** Keep the screen on for the walk, so the next card is there when you look. */
export async function keepAwake() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return () => {};
  let lock = null;
  const acquire = async () => {
    try { lock = await navigator.wakeLock.request('screen'); } catch { lock = null; }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
  await acquire();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
  };
}
