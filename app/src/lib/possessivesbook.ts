/** The workbook for the possessives: exercises a course book would set,
 *  each drilling one part of the rule before the last ones mix them.
 *
 *  The order is the order the rule is taught in (possessives.ts): the thing
 *  owned decides the form; so *son* and *sa* are his and her alike; a vowel
 *  sound turns *ma* into *mon*; several owners have no gender; then a name
 *  in place of the owner, sentences, translation, and the whole table from
 *  memory. Every item is the verbs workbook's Item (essentialsbook.ts), so
 *  one component draws both and one `mark` marks them: exactly, accents
 *  included.
 *
 *  A page is dealt without dice, like everything else in the app: the
 *  caller passes a seed, and the same seed deals the same page.
 */
import { orderedBy } from './shuffle.js';
import { gapOf } from './essentialsbook.js';
import type { Item, Workbook } from './essentialsbook.js';
import { BEFORE_ADJECTIVE, NOUNS, OWNERS, columnOf, owned, possessive, thingOf, vowelSound } from './possessives.js';
import type { Noun, Owner } from './possessives.js';
import type { Phrase } from './conjspeech.js';

/** One sentence of the bank. `fr` marks the determiner with braces, as the
 *  verbs bank does: "Marie parle à {son} frère." `owner` is whose it is —
 *  the row of the table the gap is read from, given as a cue where the
 *  sentence alone would not settle it. `from` is the same fact said with
 *  *de*, for the exercise that asks for it to be said with a possessive:
 *  "C'est la voiture de Julie." `en` is what `fr` means, with (tu), (vous)
 *  or (f.) where English cannot say which. */
export interface Sentence {
  owner: Owner;
  fr: string;
  en: string;
  from?: string;
  alts?: readonly string[];
}

const S = (owner: Owner, fr: string, en: string, ...alts: string[]): Sentence => ({ owner, fr, en, alts });
const W = (from: string, owner: Owner, fr: string, en: string): Sentence => ({ owner, fr, en, from });

/** The bank. Only ever added to at the end: a sentence's clip is kept by
 *  its place in it. */
export const SENTENCES: readonly Sentence[] = [
  S(0, "J'appelle {ma} mère tous les dimanches.", 'I call my mother every Sunday.'),
  S(0, '{Mon} amie habite à Lyon.', 'My friend lives in Lyon. (f.)'),
  S(0, "J'ai perdu {mes} clés.", 'I have lost my keys.'),
  S(0, "{Mon} école est près d'ici.", 'My school is near here.'),
  S(0, "C'est {ma} meilleure amie.", 'She is my best friend.', 'Elle est ma meilleure amie.'),
  S(0, '{Mon} ancienne école a fermé.', 'My old school has closed.'),
  S(1, 'Tu as {ton} passeport ?', 'Have you got your passport? (tu)', 'As-tu ton passeport ?'),
  S(1, "C'est {ta} voiture ?", 'Is this your car? (tu)', 'Est-ce ta voiture ?', "C'est ta voiture ?"),
  S(1, 'Tu peux me donner {ton} adresse ?', 'Can you give me your address? (tu)', 'Peux-tu me donner ton adresse ?'),
  S(1, 'Où sont {tes} chaussures ?', 'Where are your shoes? (tu)'),
  S(1, 'Tu aimes {ta} chambre ?', 'Do you like your bedroom? (tu)', 'Aimes-tu ta chambre ?'),
  S(2, 'Marie parle à {son} frère.', 'Marie is talking to her brother.'),
  S(2, 'Paul aime beaucoup {sa} sœur.', 'Paul loves his sister very much.'),
  S(2, 'Elle cherche {ses} lunettes.', 'She is looking for her glasses.'),
  S(2, 'Il raconte {son} histoire.', 'He tells his story.'),
  S(2, 'Elle promène {son} chien.', 'She is walking her dog.'),
  S(2, '{Son} université est à Paris.', 'Her university is in Paris.'),
  S(2, 'Thomas a vendu {sa} voiture.', 'Thomas sold his car.'),
  S(3, 'Nous vendons {notre} maison.', 'We are selling our house.'),
  S(3, '{Notre} fils a dix ans.', 'Our son is ten.'),
  S(3, 'Nous invitons {nos} amis.', 'We are inviting our friends.'),
  S(3, '{Notre} équipe a gagné.', 'Our team won.'),
  S(4, 'Vous avez {votre} billet ?', 'Do you have your ticket? (vous)', 'Avez-vous votre billet ?'),
  S(4, '{Votre} chambre est prête, madame.', 'Your room is ready, madam. (vous)'),
  S(4, 'Vous pouvez épeler {votre} nom ?', 'Can you spell your name? (vous)', 'Pouvez-vous épeler votre nom ?'),
  S(4, 'Montrez-moi {vos} papiers.', 'Show me your papers. (vous)'),
  S(5, 'Ils adorent {leur} chat.', 'They adore their cat.'),
  S(5, 'Elles rendent visite à {leurs} parents.', 'They are visiting their parents. (f.)'),
  S(5, 'Les enfants font {leurs} devoirs.', 'The children are doing their homework.'),
  S(5, '{Leur} appartement est petit.', 'Their flat is small.'),
  S(5, 'Ils ont vendu {leur} voiture.', 'They sold their car.'),
  W("C'est le vélo de Thomas.", 2, "C'est {son} vélo.", "It's his bike."),
  W("C'est la chambre de Julie.", 2, "C'est {sa} chambre.", "It's her room."),
  W('Ce sont les affaires de Léa.', 2, 'Ce sont {ses} affaires.', 'They are her things.'),
  W("C'est l'adresse de Marc.", 2, "C'est {son} adresse.", "It's his address."),
  W("C'est l'idée de Jeanne.", 2, "C'est {son} idée.", "It's her idea."),
  W("C'est le téléphone de Nina.", 2, "C'est {son} téléphone.", "It's her phone."),
  W('Ce sont les lunettes de mon grand-père.', 2, 'Ce sont {ses} lunettes.', 'They are his glasses.'),
  W('C’est la maison de mes parents.', 5, "C'est {leur} maison.", "It's their house."),
  W('Ce sont les enfants de Paul et Anne.', 5, 'Ce sont {leurs} enfants.', 'They are their children.'),
  W('C’est le chien des voisins.', 5, "C'est {leur} chien.", "It's their dog."),
  W("C'est l'équipe de Lucas et Hugo.", 5, "C'est {leur} équipe.", "It's their team."),
  W('C’est la voiture de Sophie et moi.', 3, "C'est {notre} voiture.", "It's our car."),
  W('Ce sont les livres de Marie et toi.', 4, 'Ce sont {vos} livres.', 'They are your books. (vous)'),
];

/** Every whole French sentence a translation may be: the sentence with its
 *  gap filled, then its alternatives. The first is the one shown. */
export function wholeOf(sentence: Sentence): string[] {
  const { before, forms, after } = gapOf(sentence);
  return [...forms.map((f) => `${before}${f}${after}`), ...(sentence.alts ?? [])];
}

/** The kinds of exercise a page holds, in the order it sets them. */
export const PAGE = ['agree', 'hisher', 'vowel', 'owners', 'whose', 'context', 'translate', 'table'] as const;
export type ExerciseKind = (typeof PAGE)[number];

/** One exercise of the possessives workbook. */
export interface Exercise extends Workbook {
  kind: ExerciseKind;
}

/** How many items each exercise has. The table is the whole table. */
export const SIZES: Record<Exclude<ExerciseKind, 'table'>, number> = {
  agree: 8, hisher: 8, vowel: 8, owners: 8, whose: 6, context: 8, translate: 6,
};

/** The gender a cue gives, so the column can be found without already
 *  knowing the noun: the gender is not what this sheet teaches. */
const genderCue = (n: Noun): string => (n.plural ? 'pl.' : n.gender === 'f' ? 'f.' : 'm.');

const BOOK_KEY = 'possessives|book';
const heardSentence = (s: Sentence): Phrase =>
  ({ key: BOOK_KEY, slot: `s${SENTENCES.indexOf(s)}`, text: wholeOf(s)[0]! });
/** A determiner and its noun, heard together; kept by what it says. */
const heardOwned = (text: string): Phrase => ({ key: BOOK_KEY, slot: text, text });

/** An item whose gap is the determiner before a noun. */
function nounItem(id: string, owner: Owner, noun: Noun, cue: string, before = ''): Item {
  const form = possessive(owner, thingOf(noun));
  return {
    id, before, after: noun.fr, cue, accepted: [form], shown: form,
    heard: heardOwned(owned(owner, noun)), wide: false, pronoun: false,
  };
}

function gapItem(s: Sentence, cue: string, before = ''): Item {
  const g = gapOf(s);
  return {
    id: `gap|${SENTENCES.indexOf(s)}`, before: before + g.before, after: g.after, cue,
    accepted: g.forms, shown: g.forms[0]!, heard: heardSentence(s), wide: false, pronoun: false,
  };
}

/** The first `n` of a list, in the order the seed gives. */
function pick<T>(list: readonly T[], n: number, seed: number): T[] {
  return orderedBy(list.length, seed).slice(0, n).map((i) => list[i]!);
}

/** An owner for each of `n` items, spread over `owners` in the order the
 *  seed gives, so a short exercise does not land on one row. */
function ownersFor(n: number, seed: number, owners: readonly Owner[]): Owner[] {
  const order = orderedBy(Math.max(n, owners.length), seed);
  return order.slice(0, n).map((i) => owners[i % owners.length]!);
}

const ALL: readonly Owner[] = [0, 1, 2, 3, 4, 5];
/** A feminine noun before a vowel: the one case where the column is not the
 *  gender. Kept out of the drills before the one that teaches it. */
const borrows = (n: Noun): boolean => n.gender === 'f' && !n.plural && columnOf(thingOf(n)) === 0;

/** One exercise of a kind, dealt from the seed. Every kind is dealt on its
 *  own seed, so one exercise can be re-dealt without changing the rest. */
export function exercise(kind: ExerciseKind, seed: number): Exercise {
  switch (kind) {
    case 'agree': {
      /* The row from the owner, the column from the thing. */
      const nouns = pick(NOUNS.filter((n) => !borrows(n)), SIZES.agree, seed);
      const owners = ownersFor(nouns.length, seed + 1, ALL);
      return { kind, title: "L'accord avec le nom", instruction:
        'Give the possessive. The possessor and the gender of the noun are in brackets.',
      items: nouns.map((n, i) => {
        const o = owners[i]!;
        return nounItem(`agree|${o}|${n.fr}`, o, n, `${OWNERS[o]} · ${genderCue(n)}`);
      }) };
    }
    case 'hisher': {
      /* His mother is *sa mère*, her father *son père*: the trap, alone. */
      const nouns = pick(NOUNS.filter((n) => !borrows(n) && !n.en.includes('(')), SIZES.hisher, seed);
      const whose = orderedBy(nouns.length, seed + 1);
      return { kind, title: 'Son, sa ou ses ?', instruction:
        'Give son, sa or ses. The form agrees with the noun; the sex of the possessor is irrelevant.',
      items: nouns.map((n, i) => {
        const en = `${(whose[i] ?? 0) % 2 ? 'her' : 'his'} ${n.en}`;
        return nounItem(`hisher|${en}`, 2, n, en);
      }) };
    }
    case 'vowel': {
      /* Half before a vowel sound, half not — an aspirated h and an
         adjective in front among them — so the answer is never always *mon*. */
      const fem = [...NOUNS, ...BEFORE_ADJECTIVE].filter((n) => n.gender === 'f' && !n.plural);
      const half = SIZES.vowel / 2;
      const mixed = [...pick(fem.filter(borrows), half, seed), ...pick(fem.filter((n) => !borrows(n)), half, seed + 1)];
      const things = orderedBy(mixed.length, seed + 2).map((i) => mixed[i]!);
      const owners = ownersFor(things.length, seed + 3, [0, 1, 2]);
      return { kind, title: 'Devant une voyelle', instruction:
        'All of these nouns are feminine. Give the possessive for the person in brackets.',
      items: things.map((n, i) => {
        const o = owners[i]!;
        return nounItem(`vowel|${o}|${n.fr}`, o, n, OWNERS[o]);
      }) };
    }
    case 'owners': {
      /* From one owner to several and back: *mon vélo* is *notre vélo*,
         *ma maison* is *notre maison* too — the gender goes. */
      const nouns = pick(NOUNS, SIZES.owners, seed);
      const owners = ownersFor(nouns.length, seed + 1, ALL);
      return { kind, title: 'Un ou plusieurs possesseurs', instruction:
        'Rewrite with the possessor in brackets: je ↔ nous, tu ↔ vous, il/elle ↔ ils/elles.',
      items: nouns.map((n, i) => {
        const from = owners[i]!;
        const to = ((from + 3) % 6) as Owner;
        return nounItem(`owners|${from}|${n.fr}`, to, n, OWNERS[to], `${owned(from, n)} →`);
      }) };
    }
    case 'whose': {
      const bank = SENTENCES.filter((s) => s.from);
      return { kind, title: 'À qui est-ce ?', instruction: 'Rewrite each sentence, replacing de + the possessor with a possessive.',
        items: pick(bank, SIZES.whose, seed).map((s) => gapItem(s, '', `${s.from!} → `)) };
    }
    case 'context': {
      const bank = SENTENCES.filter((s) => !s.from);
      return { kind, title: 'Dans la phrase', instruction:
        'Complete each sentence with the possessive. The possessor is in brackets.',
      items: pick(bank, SIZES.context, seed).map((s) => gapItem(s, OWNERS[s.owner])) };
    }
    case 'translate':
      return { kind, title: 'Traduisez', instruction: 'Translate into French.',
        items: pick(SENTENCES, SIZES.translate, seed).map((s): Item => {
          const whole = wholeOf(s);
          return { id: `tr|${SENTENCES.indexOf(s)}`, before: '', after: '', cue: s.en, accepted: whole,
            shown: whole[0]!, heard: heardSentence(s), wide: true, pronoun: false };
        }) };
    case 'table': {
      /* The whole table from memory, on three nouns the seed picks: one of
         each column, none that begins with a vowel, so every cell is the
         table's own form. The plural owners are asked for both genders,
         which is how it is learnt that they have none. */
      const plain = NOUNS.filter((n) => !vowelSound(n.fr, n.aspirated) && !n.en.includes('('));
      const m = pick(plain.filter((n) => n.gender === 'm' && !n.plural), 1, seed)[0]!;
      const f = pick(plain.filter((n) => n.gender === 'f' && !n.plural), 1, seed + 1)[0]!;
      const pl = pick(plain.filter((n) => n.plural), 1, seed + 2)[0]!;
      return { kind, title: 'Le tableau', instruction:
        `Complete the table with ${m.fr}, ${f.fr} and ${pl.fr}.`,
      items: ALL.flatMap((o) => [m, f, pl].map((n) => nounItem(`table|${o}|${n.fr}`, o, n, OWNERS[o]))) };
    }
  }
  throw new Error(`no such exercise: ${String(kind)}`);
}

/** A whole page: every kind, each on its own seed drawn from the page's. */
export function page(seed: number): Exercise[] {
  return PAGE.map((kind, i) => exercise(kind, seed * 31 + i));
}
