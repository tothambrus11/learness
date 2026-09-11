/** Which of a device's voices speaks a language, and when none of them does. */
import { expect, test } from 'vitest';

import { pickVoice } from '../src/lib/speech';

/** One voice as an engine lists it. Only the tag, the name and the default
 *  flag decide anything; the other two fields exist because the browser's own
 *  type has them, and the name doubles as the URI so each voice is distinct. */
const V = (lang: string, name: string = lang, def: boolean = false): SpeechSynthesisVoice => ({
  lang,
  name,
  default: def,
  localService: true,
  voiceURI: name,
});

test('French prefers Swiss, then France, then anything French', () => {
  const all = [V('en-GB'), V('fr-CA'), V('fr-FR'), V('fr-CH')];
  expect(pickVoice(all, 'fr')?.name).toBe('fr-CH');
  expect(pickVoice([V('fr-CA'), V('fr-FR')], 'fr')?.name).toBe('fr-FR');
  expect(pickVoice([V('fr-CA')], 'fr')?.name, 'better Quebec than silence').toBe('fr-CA');
});

test('English prefers British, for the ear this deck is built for', () => {
  expect(pickVoice([V('en-US'), V('en-GB')], 'en')?.name).toBe('en-GB');
  expect(
    pickVoice([V('en-US'), V('en-AU', 'en-AU', true)], 'en')?.name,
    'else the default',
  ).toBe('en-AU');
  expect(pickVoice([V('en-US')], 'en')?.name).toBe('en-US');
});

test('a language the device cannot speak is admitted, not faked', () => {
  expect(pickVoice([V('en-GB'), V('de-DE')], 'fr')).toBe(null);
  expect(pickVoice([], 'fr')).toBe(null);
  expect(pickVoice(undefined, 'fr')).toBe(null);
});

test('a region tag is read however it is punctuated, and a full tag works', () => {
  expect(pickVoice([V('fr_CH')], 'fr')?.name).toBe('fr_CH');
  expect(pickVoice([V('FR-fr')], 'fr')?.name).toBe('FR-fr');
  expect(
    pickVoice([V('fr-FR'), V('fr-CH')], 'fr-FR')?.name,
    'the preference order decides, not the tag asked for',
  ).toBe('fr-CH');
});
