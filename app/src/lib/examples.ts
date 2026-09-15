import type { Conjugation, Example } from './model.js';

/** The time words a sentence can carry — *hier*, *demain*, *souvent*, *l'an
 *  dernier* — which say when a thing happened without the verb's help.
 *
 *  A reader who has one of these never has to read the ending: the adverb
 *  answers first, and the ending is never learned (Ellis's blocking, and
 *  VanPatten's lexical preference, are both this observation). So a card
 *  that asks which time a form means is dealt only sentences that have no
 *  other way of saying it. Measured on the shipped corpus before this was
 *  written: over nine tenths of the past-tense examples carry no time word,
 *  so the filter removes the giveaway and leaves the pool. */
const TIME_PATTERNS = [
  'hier', "aujourd'hui", 'demain', 'maintenant', 'autrefois', 'jadis', 'souvent', 'toujours',
  'jamais', 'parfois', 'quelquefois', 'déjà', 'bientôt', 'désormais', 'dorénavant',
  "tout à l['’]heure", 'tout de suite', 'plus tard', 'ce matin', 'ce soir', 'cette nuit',
  'cet après-midi', 'le lendemain', 'la veille', "à l['’]époque", 'en ce moment', 'de nos jours',
  'il y a', 'depuis', 'pendant', 'chaque (jour|matin|soir|semaine|année)',
  'tous les (jours|matins|soirs|ans)', 'toutes les (semaines|nuits)',
  "(la |l['’])(semaine|année|an|mois|jour|nuit) (dernier|dernière|prochain|prochaine|passé|passée)",
  "l['’]an (dernier|prochain)", 'dans (\\d+|un|une|deux|trois|quelques) ',
];
const TIME_WORDS = new RegExp(`(^|[^\\p{L}])(${TIME_PATTERNS.join('|')})(?![\\p{L}])`, 'iu');

/** Does the sentence say when, other than through the verb? */
export const timed = (sentence: Pick<Example, 'fr'>): boolean => TIME_WORDS.test(sentence.fr);

/** The examples a which-time card may ask: the ones where the ending is the
 *  only clue. Ones found by context are kept out too — a shared spelling
 *  is not a form to be read the time off. */
export const untimed = (examples: readonly Example[] | undefined): Example[] =>
  (examples ?? []).filter((e) => !e.ctx && !timed(e));

/** The tenses a which-time card chooses between, in the order the options are
 *  shown. Passé composé and imparfait are the pair the whole exercise is for;
 *  the futur simple is the third option, so that two is never a coin toss. */
export const TENSE_PICK = ['pc', 'imp', 'fut'] as const;
export type PickedTense = (typeof TENSE_PICK)[number];

/** Which of those tenses this verb can be asked about: the ones it has an
 *  untimed sentence for. Fewer than two, and there is nothing to choose. */
export function pickableTenses(conj: Pick<Conjugation, 'examples'> | null | undefined): PickedTense[] {
  return TENSE_PICK.filter((t) => untimed(conj?.examples?.[t]).length > 0);
}

/** Example sentences for one tense of one verb.
 *
 *  Today every example is a corpus sentence the pipeline found and shipped
 *  with the verb table (frcog/sentences.py: Tatoeba, matched form by form,
 *  with a context rule where the spelling is shared). This function is the
 *  one place the app asks for them, so a local language model can be plugged
 *  in here later without the table component knowing: generate a sentence
 *  around a form the table already fixes, check that the form is in it, and
 *  fall back to the corpus when it is not. The table is the oracle; the model
 *  only writes around it.
 *
 *  @param conj   the verb's table as shipped in the catalogue
 *  @param tense  a group id ("pres", "subj") or compound id ("pc")
 */
export function examplesFor(
  /* Only the examples are read, so a caller with nothing else — a test, or a
     word whose table has not been loaded — can still ask. */
  conj: Pick<Conjugation, 'examples'> | null | undefined,
  tense: string,
): { examples: Example[]; source: string } {
  const examples = conj?.examples?.[tense] ?? [];
  return { examples, source: examples.length ? 'Tatoeba, CC BY 2.0 FR' : '' };
}

/** Split a sentence around the form it was found by, for highlighting.
 *  Returns [before, match, after]; match is '' when the form is not there
 *  as a whole word (it always should be). */
export function splitOnForm(sentence: string, form: string): [string, string, string] {
  if (!form) return [sentence, '', ''];
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* A form can follow an apostrophe (j'ai) or start the sentence, and can be
     followed by a hyphen (allons-y) or punctuation. Letters on either side
     would make it part of another word. */
  const re = new RegExp(`(^|[^\\p{L}])(${esc})(?![\\p{L}])`, 'iu');
  const m = re.exec(sentence);
  if (!m) return [sentence, '', ''];
  const lead = m[1] ?? '';
  const found = m[2] ?? '';
  const start = m.index + lead.length;
  return [sentence.slice(0, start), found, sentence.slice(start + found.length)];
}
