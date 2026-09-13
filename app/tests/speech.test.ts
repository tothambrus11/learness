import { test } from 'vitest';
import assert from 'node:assert/strict';
import { pickVoice } from '../src/lib/speech.js';
import { voice } from './make.js';

const V = (lang: string, name: string = lang, def = false): SpeechSynthesisVoice =>
  voice({ lang, name, default: def });

test('French prefers Swiss, then France, then anything French', () => {
  const all = [V('en-GB'), V('fr-CA'), V('fr-FR'), V('fr-CH')];
  assert.equal(pickVoice(all, 'fr')?.name, 'fr-CH');
  assert.equal(pickVoice([V('fr-CA'), V('fr-FR')], 'fr')?.name, 'fr-FR');
  assert.equal(pickVoice([V('fr-CA')], 'fr')?.name, 'fr-CA', 'better Quebec than silence');
});

test('English prefers British, for the ear this deck is built for', () => {
  assert.equal(pickVoice([V('en-US'), V('en-GB')], 'en')?.name, 'en-GB');
  assert.equal(pickVoice([V('en-US'), V('en-AU', 'en-AU', true)], 'en')?.name, 'en-AU', 'else the default');
  assert.equal(pickVoice([V('en-US')], 'en')?.name, 'en-US');
});

test('a language the device cannot speak is admitted, not faked', () => {
  assert.equal(pickVoice([V('en-GB'), V('de-DE')], 'fr'), null);
  assert.equal(pickVoice([], 'fr'), null);
  assert.equal(pickVoice(undefined, 'fr'), null);
});

test('a region tag is read however it is punctuated, and a full tag works', () => {
  assert.equal(pickVoice([V('fr_CH')], 'fr')?.name, 'fr_CH');
  assert.equal(pickVoice([V('FR-fr')], 'fr')?.name, 'FR-fr');
  assert.equal(pickVoice([V('fr-FR'), V('fr-CH')], 'fr-FR')?.name, 'fr-CH',
    'the preference order decides, not the tag asked for');
});
