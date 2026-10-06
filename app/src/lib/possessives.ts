/** The possessive determiners — *mon, ma, mes* and the rest — as a sheet to
 *  read beside a workbook: the table, the rule that picks a cell of it, the
 *  nouns the exercises are made of, and the notes printed under the table.
 *
 *  Like the essential verbs (essentials.ts), this stands beside the course
 *  rather than in it: nothing is a card, nothing is scheduled or stored, and
 *  the table is written out here rather than read from the catalogue.
 *
 *  The rule is the one an English speaker gets wrong, so it is said once,
 *  here, and everything else reads it: **the possessive agrees with the noun
 *  it precedes, not with the possessor.** *Son père* is his father and her
 *  father alike; French says nothing about the owner's gender, only the
 *  thing's. Then two
 *  things that are not gender at all: before a vowel sound the feminine
 *  takes the masculine form (*mon amie*), and the plural owners have no
 *  gender to choose (*notre, nos*).
 *
 *  Pure, with no import but types, so the grammar drills (and the Worker
 *  through them) can use the same rule: grammar/determiners.ts does.
 *
 *  The exercises built on it are possessivesbook.ts.
 */
import type { Phrase } from './conjspeech.js';

/** The owners, in the order the table reads them. *on* goes with *il/elle*:
 *  *on a perdu son chemin*. */
export const OWNERS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'] as const;
export type Owner = 0 | 1 | 2 | 3 | 4 | 5;

/** What each row is in English, for a cue: *son* is his, her or its, which
 *  is the whole difficulty. */
export const OWNERS_EN: readonly string[] = ['my', 'your (tu)', 'his / her / its', 'our', 'your (vous)', 'their'];

/** The table, one row per owner: the form for one masculine thing, for one
 *  feminine thing, and for several things of either gender. The plural
 *  owners' first two are the same word — that sameness is the lesson, and
 *  the sheet draws them as one cell. */
export const TABLE: readonly (readonly [m: string, f: string, pl: string])[] = [
  ['mon', 'ma', 'mes'],
  ['ton', 'ta', 'tes'],
  ['son', 'sa', 'ses'],
  ['notre', 'notre', 'nos'],
  ['votre', 'votre', 'vos'],
  ['leur', 'leur', 'leurs'],
];

/** Whether a row tells the genders apart: the singular owners do, the
 *  plural owners do not. */
export const hasGender = (owner: Owner): boolean => owner < 3;

/** Which column of the table, by the thing owned. */
export type Column = 0 | 1 | 2;

/** The thing owned, as far as the rule cares. `vowel` is about the word
 *  written straight after the determiner, which is the noun or an adjective
 *  in front of it: *mon ancienne école*, but *ma nouvelle école*. */
export interface Thing {
  gender: 'm' | 'f';
  plural: boolean;
  vowel: boolean;
}

/** The column the rule reads. A feminine thing before a vowel sound reads
 *  the masculine column — not because it has become masculine (*mon amie
 *  est partie*: the adjective still agrees with a woman), but because *ma
 *  amie* cannot be said. French elides the article there (*l'amie*); the
 *  possessive cannot lose its vowel, so it borrows the other form. */
export function columnOf(thing: Thing): Column {
  if (thing.plural) return 2;
  return thing.gender === 'f' && !thing.vowel ? 1 : 0;
}

/** The determiner the owner puts before the thing. */
export function possessive(owner: Owner, thing: Thing): string {
  return TABLE[owner]![columnOf(thing)];
}

/** Whether a word begins with a vowel sound. A mute h counts as a vowel
 *  (*mon histoire*); an aspirated h does not (*ma harpe*), and nothing in
 *  the spelling says which an h is, so the caller says so. A y is left out:
 *  the words it starts are few and none of them is on the sheet. */
export function vowelSound(word: string, aspirated = false): boolean {
  if (aspirated) return false;
  return /^[aeiouhàâäéèêëîïôöùûüœæ]/i.test(word.normalize('NFC'));
}

/** One noun of the sheet. `fr` is the noun with no article; `en` its English,
 *  without "the", so it reads after *my* or *her*. `aspirated` marks an h
 *  that is said (or rather, that stops a liaison). */
export interface Noun {
  fr: string;
  en: string;
  gender: 'm' | 'f';
  plural: boolean;
  aspirated: boolean;
  /** A family word: whose relative it is is the his/her question at its
   *  plainest (*sa mère*: his mother as much as hers). */
  family: boolean;
}

const N = (fr: string, en: string, gender: 'm' | 'f', opts: Partial<Pick<Noun, 'plural' | 'aspirated' | 'family'>> = {}): Noun =>
  ({ fr, en, gender, plural: !!opts.plural, aspirated: !!opts.aspirated, family: !!opts.family });

/** The nouns the exercises are made of: everyday things, and the family,
 *  which is where a learner first needs the rule. Enough feminine nouns
 *  that begin with a vowel to drill *mon amie*, two aspirated h's to show it
 *  is the sound and not the letter, and plurals of both genders. Only ever
 *  added to, so an item's id keeps meaning the same noun. */
export const NOUNS: readonly Noun[] = [
  N('père', 'father', 'm', { family: true }),
  N('mère', 'mother', 'f', { family: true }),
  N('frère', 'brother', 'm', { family: true }),
  N('sœur', 'sister', 'f', { family: true }),
  N('oncle', 'uncle', 'm', { family: true }),
  N('tante', 'aunt', 'f', { family: true }),
  N('fils', 'son', 'm', { family: true }),
  N('fille', 'daughter', 'f', { family: true }),
  N('cousin', 'cousin (m.)', 'm', { family: true }),
  N('cousine', 'cousin (f.)', 'f', { family: true }),
  N('mari', 'husband', 'm', { family: true }),
  N('femme', 'wife', 'f', { family: true }),
  N('parents', 'parents', 'm', { plural: true, family: true }),
  N('enfants', 'children', 'm', { plural: true, family: true }),
  N('grands-parents', 'grandparents', 'm', { plural: true, family: true }),
  N('ami', 'friend (m.)', 'm'),
  N('amie', 'friend (f.)', 'f'),
  N('livre', 'book', 'm'),
  N('vélo', 'bike', 'm'),
  N('chien', 'dog', 'm'),
  N('chat', 'cat', 'm'),
  N('sac', 'bag', 'm'),
  N('téléphone', 'phone', 'm'),
  N('ordinateur', 'computer', 'm'),
  N('appartement', 'flat', 'm'),
  N('voiture', 'car', 'f'),
  N('maison', 'house', 'f'),
  N('chambre', 'bedroom', 'f'),
  N('valise', 'suitcase', 'f'),
  N('clé', 'key', 'f'),
  N('adresse', 'address', 'f'),
  N('école', 'school', 'f'),
  N('idée', 'idea', 'f'),
  N('équipe', 'team', 'f'),
  N('université', 'university', 'f'),
  N('erreur', 'mistake', 'f'),
  N('opinion', 'opinion', 'f'),
  N('assiette', 'plate', 'f'),
  N('histoire', 'story', 'f'),
  N('habitude', 'habit', 'f'),
  N('harpe', 'harp', 'f', { aspirated: true }),
  N('housse', 'cover', 'f', { aspirated: true }),
  N('clés', 'keys', 'f', { plural: true }),
  N('lunettes', 'glasses', 'f', { plural: true }),
  N('chaussures', 'shoes', 'f', { plural: true }),
  N('affaires', 'things', 'f', { plural: true }),
  N('amis', 'friends', 'm', { plural: true }),
  N('devoirs', 'homework', 'm', { plural: true }),
  N('livres', 'books', 'm', { plural: true }),
];

/** An adjective in front of a feminine noun, where the adjective's first
 *  sound is the one that decides: *ma nouvelle amie* but *mon ancienne
 *  école*. `fr` is the adjective and the noun together, as written after
 *  the determiner. */
export const BEFORE_ADJECTIVE: readonly Noun[] = [
  N('nouvelle amie', 'new friend (f.)', 'f'),
  N('meilleure amie', 'best friend (f.)', 'f'),
  N('petite histoire', 'little story', 'f'),
  N('ancienne école', 'old school', 'f'),
  N('autre voiture', 'other car', 'f'),
  N('unique idée', 'only idea', 'f'),
];

/** What a noun is, in a line, for the popup over it on the sheet: what it
 *  means and its gender, and its number where it is plural (#110). */
export function glossOf(noun: Pick<Noun, 'en' | 'gender' | 'plural'>): string {
  const gender = noun.gender === 'f' ? 'feminine' : 'masculine';
  return `${noun.en} · ${gender}${noun.plural ? ' plural' : ''}`;
}

/** The noun as the rule sees it: its gender, its number, and the sound it
 *  begins with. */
export function thingOf(noun: Noun): Thing {
  return { gender: noun.gender, plural: noun.plural, vowel: vowelSound(noun.fr, noun.aspirated) };
}

/** The determiner and the noun, as said: *mon amie*, *leurs enfants*. */
export const owned = (owner: Owner, noun: Noun): string => `${possessive(owner, thingOf(noun))} ${noun.fr}`;

/** The column heads of the sheet: what makes a thing fall in each column,
 *  and a noun to hear it with. */
export const COLUMNS: readonly { head: string; sub: string; noun: Noun }[] = [
  { head: 'masc.', sub: 'singular', noun: N('livre', 'book', 'm') },
  { head: 'fem.', sub: 'singular', noun: N('maison', 'house', 'f') },
  { head: 'plural', sub: 'masc. or fem.', noun: N('clés', 'keys', 'f', { plural: true }) },
];

/** Where the sheet's clips are kept: their own namespace, by the text they
 *  say, so a slot can never come to mean a different phrase. */
export const SHEET_KEY = 'possessives|sheet';
export const phraseOf = (text: string): Phrase => ({ key: SHEET_KEY, slot: text, text });

/** A cell of the table as the sheet draws it: the form, the example it is
 *  heard in, and how many columns it spans (two, where a plural owner has
 *  one form for both genders). */
export interface Cell {
  form: string;
  column: Column;
  span: 1 | 2;
  heard: Phrase;
}

/** The rows of the sheet, cells merged where the genders share a form. */
export function rowsOfSheet(): { owner: Owner; fr: string; en: string; cells: Cell[] }[] {
  return TABLE.map((forms, i) => {
    const owner = i as Owner;
    const cell = (column: Column, span: 1 | 2): Cell => {
      const noun = COLUMNS[column]!.noun;
      return { form: forms[column], column, span, heard: phraseOf(owned(owner, noun)) };
    };
    const cells = hasGender(owner) ? [cell(0, 1), cell(1, 1), cell(2, 1)] : [cell(0, 2), cell(2, 1)];
    return { owner, fr: OWNERS[owner], en: OWNERS_EN[owner]!, cells };
  });
}

/** One note under the table: the rule in a line, a sentence on why, and
 *  examples that can be heard. */
export interface Note {
  head: string;
  body: string;
  examples: string[];
}

/** What the table cannot show by itself, in the order a class teaches it:
 *  the thing decides, the vowel, the plural owners, the polite *vous*, and
 *  what is heard. */
export const NOTES: readonly Note[] = [
  {
    head: 'The possessive agrees with the noun it precedes, not with the possessor.',
    body: 'The person of the possessor determines the row; the gender and number of the noun '
      + 'determine the column. Son and sa may therefore each mean his, her or its.',
    examples: ['Marie et son père', 'Paul et sa mère', 'ses parents'],
  },
  {
    head: 'Before a vowel sound, ma, ta and sa are replaced by mon, ton and son.',
    body: 'This is a matter of pronunciation only: the noun remains feminine. A mute h is treated as a vowel; '
      + 'an aspirated h is not. The form depends on the word immediately following the possessive.',
    examples: ['mon amie', 'ton école', 'son histoire', 'ma harpe', 'ma nouvelle amie', 'mon ancienne école'],
  },
  {
    head: 'With a plural possessor, only number is marked.',
    body: 'Notre, votre and leur are used before a singular noun, nos, vos and leurs before a plural one; '
      + 'there is no distinction of gender. The s of leurs reflects the noun, not the possessors.',
    examples: ['notre maison', 'nos enfants', 'leur voiture', 'leurs voitures'],
  },
  {
    head: 'Votre and vos also serve as the formal singular.',
    body: 'When a single person is addressed as vous, the possessive is likewise votre or vos.',
    examples: ['votre passeport, madame', 'vos papiers, monsieur'],
  },
  {
    head: 'Before a vowel sound, liaison is obligatory.',
    body: 'The n of mon, ton and son is pronounced; the s of mes, tes, ses, nos, vos and leurs is pronounced [z].',
    examples: ['mon ami', 'mes amis', 'nos enfants', 'leurs amis'],
  },
];

/** Everything the sheet says, in the order it is read: the table row by
 *  row, then the notes' examples. What the page prepares as it opens (#109),
 *  under the slots the buttons ask for, so a tap finds its clip made. Each
 *  phrase once, though *nos enfants* is an example twice. */
export function sheetPhrases(): Phrase[] {
  const out = new Map<string, Phrase>();
  for (const row of rowsOfSheet()) for (const cell of row.cells) out.set(cell.heard.slot, cell.heard);
  for (const note of NOTES) for (const text of note.examples) out.set(text, out.get(text) ?? phraseOf(text));
  return [...out.values()];
}
