/** The workbook for the essential verbs: exercises the way a French course
 *  book sets them, a block of items done in one go and checked at the end.
 *
 *  An exercise is a list of items, and every item has the same shape —
 *  text before a gap, the gap, text after it, a cue — so a gap in a
 *  sentence, a cell of a table and a whole sentence to translate are drawn
 *  and marked by the same code. Marking is exact (essentials.ts `tidy`): an
 *  accent is part of the spelling.
 *
 *  A page is dealt without dice, like everything else in the app
 *  (tests/rules.test.ts): the caller passes a seed, and the same seed deals
 *  the same page.
 */
import { orderedBy } from './shuffle.js';
import { PERSONS, VERBS, dropPronoun, isRight, nearest, phrasesOfVerb } from './essentials.js';
import type { Person, Verb } from './essentials.js';
import type { Phrase } from './conjspeech.js';

/** One sentence of the bank. `fr` marks the verb's part with braces, and
 *  inside them the forms it accepts, separated by bars, the first the one
 *  shown: "Nous sommes {allés|allées} au parc." `en` is what it means, with
 *  (tu), (vous) or (f.) where English cannot say which. `alts` are other
 *  whole French sentences a translation may be. `tense` is which tense the
 *  gap asks: the present form, or the past participle of a passé composé
 *  whose auxiliary is already written. */
export interface Sentence {
  verb: string;
  tense: 'pres' | 'pc';
  fr: string;
  en: string;
  alts?: readonly string[];
}

const S = (verb: string, tense: Sentence['tense'], fr: string, en: string, ...alts: string[]): Sentence =>
  ({ verb, tense, fr, en, alts });

/** The bank: a handful of everyday sentences for every verb on the sheet,
 *  most in the present, one or two in the passé composé. */
export const SENTENCES: readonly Sentence[] = [
  S('être', 'pres', 'Je {suis} étudiant.', 'I am a student.', 'Je suis étudiante.'),
  S('être', 'pres', 'Tu {es} fatigué ?', 'Are you tired? (tu)', 'Tu es fatiguée ?', 'Es-tu fatigué ?'),
  S('être', 'pres', 'Elle {est} à Paris.', 'She is in Paris.'),
  S('être', 'pres', 'Nous {sommes} en retard.', 'We are late.'),
  S('être', 'pres', 'Vous {êtes} français ?', 'Are you French? (vous)', 'Vous êtes française ?', 'Êtes-vous français ?'),
  S('être', 'pres', 'Ils {sont} contents.', 'They are happy.'),
  S('être', 'pc', "Nous avons {été} malades.", 'We have been ill.'),
  S('avoir', 'pres', "J'{ai} un chat.", 'I have a cat.'),
  S('avoir', 'pres', 'Tu {as} quel âge ?', 'How old are you? (tu)', 'Quel âge as-tu ?', 'Quel âge tu as ?'),
  S('avoir', 'pres', 'Il {a} deux sœurs.', 'He has two sisters.'),
  S('avoir', 'pres', 'Nous {avons} faim.', 'We are hungry.'),
  S('avoir', 'pres', 'Vous {avez} une voiture ?', 'Do you have a car? (vous)', 'Avez-vous une voiture ?'),
  S('avoir', 'pres', 'Elles {ont} raison.', 'They are right. (f.)'),
  S('avoir', 'pc', "J'ai {eu} de la chance.", 'I was lucky.'),
  S('aller', 'pres', 'Je {vais} au cinéma.', "I'm going to the cinema."),
  S('aller', 'pres', 'Tu {vas} bien ?', 'Are you well? (tu)'),
  S('aller', 'pres', 'Il {va} à la plage.', 'He is going to the beach.'),
  S('aller', 'pres', 'Nous {allons} au marché.', 'We are going to the market.'),
  S('aller', 'pres', 'Vous {allez} à Lyon demain ?', 'Are you going to Lyon tomorrow? (vous)'),
  S('aller', 'pres', "Ils {vont} à l'école.", 'They go to school.'),
  S('aller', 'pc', 'Elle est {allée} à Rome.', 'She went to Rome.'),
  S('aller', 'pc', 'Nous sommes {allés|allées} au parc.', 'We went to the park.'),
  S('faire', 'pres', 'Je {fais} mes devoirs.', "I'm doing my homework."),
  S('faire', 'pres', "Qu'est-ce que tu {fais} ?", 'What are you doing? (tu)', 'Tu fais quoi ?'),
  S('faire', 'pres', "Il {fait} beau aujourd'hui.", 'The weather is nice today.'),
  S('faire', 'pres', 'Nous {faisons} la cuisine.', 'We are cooking.'),
  S('faire', 'pres', 'Vous {faites} du sport ?', 'Do you do sport? (vous)', 'Faites-vous du sport ?'),
  S('faire', 'pres', 'Elles {font} les courses.', 'They are doing the shopping. (f.)'),
  S('faire', 'pc', "J'ai {fait} un gâteau.", 'I made a cake.'),
  S('habiter', 'pres', "J'{habite} à Marseille.", 'I live in Marseille.'),
  S('habiter', 'pres', 'Tu {habites} où ?', 'Where do you live? (tu)', 'Où habites-tu ?', 'Où est-ce que tu habites ?'),
  S('habiter', 'pres', 'Il {habite} avec ses parents.', 'He lives with his parents.'),
  S('habiter', 'pres', 'Nous {habitons} près de la gare.', 'We live near the station.'),
  S('habiter', 'pres', 'Ils {habitent} en Suisse.', 'They live in Switzerland.'),
  S('habiter', 'pc', 'Elle a {habité} à Londres.', 'She lived in London.'),
  S('étudier', 'pres', "J'{étudie} le français.", 'I study French.'),
  S('étudier', 'pres', 'Tu {étudies} beaucoup.', 'You study a lot. (tu)'),
  S('étudier', 'pres', 'Nous {étudions} à la bibliothèque.', 'We study at the library.'),
  S('étudier', 'pres', 'Vous {étudiez} la médecine ?', 'Do you study medicine? (vous)', 'Étudiez-vous la médecine ?'),
  S('étudier', 'pres', 'Ils {étudient} ensemble.', 'They study together.'),
  S('étudier', 'pc', "J'ai {étudié} toute la nuit.", 'I studied all night.'),
  S('travailler', 'pres', 'Je {travaille} dans un bureau.', 'I work in an office.'),
  S('travailler', 'pres', 'Elle {travaille} le samedi.', 'She works on Saturdays.'),
  S('travailler', 'pres', 'Nous {travaillons} ensemble.', 'We work together.'),
  S('travailler', 'pres', 'Vous {travaillez} trop.', 'You work too much. (vous)'),
  S('travailler', 'pres', "Ils {travaillent} à l'hôpital.", 'They work at the hospital.'),
  S('travailler', 'pc', 'Tu as {travaillé} hier ?', 'Did you work yesterday? (tu)', 'As-tu travaillé hier ?'),
  S('parler', 'pres', 'Je {parle} anglais.', 'I speak English.'),
  S('parler', 'pres', 'Tu {parles} trop vite.', 'You speak too fast. (tu)'),
  S('parler', 'pres', 'Il {parle} à sa mère.', 'He is talking to his mother.'),
  S('parler', 'pres', 'Nous {parlons} français.', 'We speak French.'),
  S('parler', 'pres', 'Vous {parlez} espagnol ?', 'Do you speak Spanish? (vous)', 'Parlez-vous espagnol ?'),
  S('parler', 'pres', 'Elles {parlent} au téléphone.', 'They are talking on the phone. (f.)'),
  S('parler', 'pc', 'Nous avons {parlé} de toi.', 'We talked about you. (tu)'),
  S('aimer', 'pres', "J'{aime} le chocolat.", 'I like chocolate.'),
  S('aimer', 'pres', 'Tu {aimes} la musique ?', 'Do you like music? (tu)', 'Aimes-tu la musique ?'),
  S('aimer', 'pres', 'Elle {aime} lire.', 'She likes reading.'),
  S('aimer', 'pres', 'Nous {aimons} voyager.', 'We love travelling.'),
  S('aimer', 'pres', 'Ils {aiment} le football.', 'They like football.', 'Ils aiment le foot.'),
  S('aimer', 'pc', "J'ai {aimé} ce film.", 'I liked this film.'),
  S('regarder', 'pres', 'Je {regarde} la télé.', "I'm watching TV.", 'Je regarde la télévision.'),
  S('regarder', 'pres', 'Tu {regardes} le match ?', 'Are you watching the match? (tu)'),
  S('regarder', 'pres', 'Il {regarde} par la fenêtre.', 'He is looking out of the window.'),
  S('regarder', 'pres', 'Nous {regardons} un film.', 'We are watching a film.'),
  S('regarder', 'pres', 'Vous {regardez} les photos.', 'You are looking at the photos. (vous)'),
  S('regarder', 'pc', 'Elles ont {regardé} la série.', 'They watched the series. (f.)'),
  S('écouter', 'pres', "J'{écoute} la radio.", "I'm listening to the radio."),
  S('écouter', 'pres', "Tu m'{écoutes} ?", 'Are you listening to me? (tu)'),
  S('écouter', 'pres', 'Il {écoute} de la musique.', 'He listens to music.'),
  S('écouter', 'pres', 'Nous {écoutons} le professeur.', 'We listen to the teacher.', 'Nous écoutons la professeure.'),
  S('écouter', 'pres', 'Vous {écoutez} des podcasts ?', 'Do you listen to podcasts? (vous)'),
  S('écouter', 'pc', 'Ils ont {écouté} le concert.', 'They listened to the concert.'),
  S('prendre', 'pres', 'Je {prends} le bus.', 'I take the bus.'),
  S('prendre', 'pres', 'Tu {prends} un café ?', 'Are you having a coffee? (tu)'),
  S('prendre', 'pres', 'Elle {prend} une douche.', 'She is taking a shower.'),
  S('prendre', 'pres', 'Nous {prenons} le train.', 'We are taking the train.'),
  S('prendre', 'pres', 'Vous {prenez} du sucre ?', 'Do you take sugar? (vous)', 'Prenez-vous du sucre ?'),
  S('prendre', 'pres', 'Ils {prennent} le petit-déjeuner.', 'They are having breakfast.', 'Ils prennent le petit déjeuner.'),
  S('prendre', 'pc', "J'ai {pris} mon parapluie.", 'I took my umbrella.'),
  S('manger', 'pres', 'Je {mange} une pomme.', "I'm eating an apple."),
  S('manger', 'pres', 'Tu {manges} de la viande ?', 'Do you eat meat? (tu)', 'Manges-tu de la viande ?'),
  S('manger', 'pres', 'Il {mange} au restaurant.', 'He eats at the restaurant.'),
  S('manger', 'pres', 'Nous {mangeons} à midi.', 'We eat at noon.'),
  S('manger', 'pres', 'Vous {mangez} avec nous ?', 'Are you eating with us? (vous)'),
  S('manger', 'pres', 'Ils {mangent} trop de sucre.', 'They eat too much sugar.'),
  S('manger', 'pc', 'Nous avons {mangé} une pizza.', 'We ate a pizza.'),
  S('boire', 'pres', "Je {bois} de l'eau.", 'I drink water.'),
  S('boire', 'pres', 'Tu {bois} du thé ?', 'Do you drink tea? (tu)', 'Bois-tu du thé ?'),
  S('boire', 'pres', 'Il {boit} un verre de vin.', 'He is drinking a glass of wine.'),
  S('boire', 'pres', 'Nous {buvons} du café.', 'We drink coffee.'),
  S('boire', 'pres', 'Vous {buvez} trop de café.', 'You drink too much coffee. (vous)'),
  S('boire', 'pres', "Ils {boivent} du jus d'orange.", 'They are drinking orange juice.'),
  S('boire', 'pc', 'Elle a {bu} tout le lait.', 'She drank all the milk.'),
  S('apprendre', 'pres', "J'{apprends} le français.", "I'm learning French."),
  S('apprendre', 'pres', 'Tu {apprends} vite.', 'You learn fast. (tu)'),
  S('apprendre', 'pres', 'Il {apprend} à nager.', 'He is learning to swim.'),
  S('apprendre', 'pres', "Nous {apprenons} l'italien.", 'We are learning Italian.'),
  S('apprendre', 'pres', 'Vous {apprenez} la guitare ?', 'Are you learning the guitar? (vous)'),
  S('apprendre', 'pres', 'Elles {apprennent} leurs leçons.', 'They are learning their lessons. (f.)'),
  S('apprendre', 'pc', "J'ai {appris} une nouvelle chanson.", 'I learnt a new song.'),
  S('comprendre', 'pres', 'Je ne {comprends} pas.', "I don't understand."),
  S('comprendre', 'pres', 'Tu {comprends} ?', 'Do you understand? (tu)', 'Comprends-tu ?'),
  S('comprendre', 'pres', 'Elle {comprend} tout.', 'She understands everything.'),
  S('comprendre', 'pres', 'Nous {comprenons} la question.', 'We understand the question.'),
  S('comprendre', 'pres', 'Vous {comprenez} le russe ?', 'Do you understand Russian? (vous)'),
  S('comprendre', 'pres', 'Ils ne {comprennent} pas.', "They don't understand."),
  S('comprendre', 'pc', 'Tu as {compris} ?', 'Did you understand? (tu)', 'As-tu compris ?'),
  S('vouloir', 'pres', 'Je {veux} un café.', 'I want a coffee.'),
  S('vouloir', 'pres', 'Tu {veux} venir ?', 'Do you want to come? (tu)', 'Veux-tu venir ?'),
  S('vouloir', 'pres', 'Il {veut} partir.', 'He wants to leave.'),
  S('vouloir', 'pres', 'Nous {voulons} dormir.', 'We want to sleep.'),
  S('vouloir', 'pres', 'Vous {voulez} du pain ?', 'Do you want some bread? (vous)', 'Voulez-vous du pain ?'),
  S('vouloir', 'pres', 'Ils {veulent} jouer.', 'They want to play.'),
  S('vouloir', 'pc', 'Elle a {voulu} rester.', 'She wanted to stay.'),
  S('sortir', 'pres', 'Je {sors} ce soir.', "I'm going out tonight."),
  S('sortir', 'pres', 'Tu {sors} avec tes amis ?', 'Are you going out with your friends? (tu)'),
  S('sortir', 'pres', 'Il {sort} du bureau à six heures.', 'He leaves the office at six.'),
  S('sortir', 'pres', 'Nous {sortons} souvent.', 'We often go out.'),
  S('sortir', 'pres', 'Vous {sortez} ce week-end ?', 'Are you going out this weekend? (vous)'),
  S('sortir', 'pres', 'Elles {sortent} ensemble.', 'They go out together. (f.)'),
  S('sortir', 'pc', 'Je suis {sorti|sortie} hier soir.', 'I went out last night.'),
  S('sortir', 'pc', 'Elles sont {sorties} à minuit.', 'They went out at midnight. (f.)'),
  S('savoir', 'pres', 'Je {sais} nager.', 'I know how to swim.'),
  S('savoir', 'pres', 'Tu {sais} où il habite ?', 'Do you know where he lives? (tu)', 'Sais-tu où il habite ?'),
  S('savoir', 'pres', 'Elle {sait} la réponse.', 'She knows the answer.'),
  S('savoir', 'pres', 'Nous {savons} cuisiner.', 'We know how to cook.'),
  S('savoir', 'pres', 'Vous {savez} quelle heure il est ?', 'Do you know what time it is? (vous)',
    'Savez-vous quelle heure il est ?'),
  S('savoir', 'pres', 'Ils ne {savent} pas.', "They don't know."),
  S('savoir', 'pc', "J'ai {su} la vérité hier.", 'I found out the truth yesterday.'),
  S('courir', 'pres', 'Je {cours} tous les matins.', 'I run every morning.'),
  S('courir', 'pres', 'Tu {cours} vite !', 'You run fast! (tu)'),
  S('courir', 'pres', 'Il {court} dans le parc.', 'He is running in the park.'),
  S('courir', 'pres', 'Nous {courons} ensemble.', 'We run together.'),
  S('courir', 'pres', 'Vous {courez} un marathon ?', 'Are you running a marathon? (vous)'),
  S('courir', 'pres', 'Elles {courent} après le bus.', 'They are running after the bus. (f.)'),
  S('courir', 'pc', 'Nous avons {couru} dix kilomètres.', 'We ran ten kilometres.'),
  S('venir', 'pres', 'Je {viens} de Hongrie.', 'I come from Hungary.'),
  S('venir', 'pres', 'Tu {viens} avec moi ?', 'Are you coming with me? (tu)', 'Viens-tu avec moi ?'),
  S('venir', 'pres', 'Elle {vient} ce soir.', 'She is coming tonight.'),
  S('venir', 'pres', 'Nous {venons} demain.', 'We are coming tomorrow.'),
  S('venir', 'pres', "Vous {venez} d'où ?", 'Where do you come from? (vous)', "D'où venez-vous ?"),
  S('venir', 'pres', 'Ils {viennent} à la fête.', 'They are coming to the party.'),
  S('venir', 'pc', 'Elle est {venue} hier.', 'She came yesterday.'),
  S('venir', 'pc', 'Ils sont {venus} en train.', 'They came by train.'),
  S('devoir', 'pres', 'Je {dois} partir.', 'I have to leave.'),
  S('devoir', 'pres', 'Tu {dois} travailler.', 'You have to work. (tu)'),
  S('devoir', 'pres', "Il {doit} de l'argent à sa sœur.", 'He owes his sister money.'),
  S('devoir', 'pres', 'Nous {devons} attendre.', 'We have to wait.'),
  S('devoir', 'pres', 'Vous {devez} signer ici.', 'You must sign here. (vous)'),
  S('devoir', 'pres', 'Ils {doivent} rentrer.', 'They have to go home.'),
  S('devoir', 'pc', "J'ai {dû} attendre une heure.", 'I had to wait an hour.'),
  S('pouvoir', 'pres', 'Je {peux} vous aider ?', 'Can I help you? (vous)', 'Puis-je vous aider ?'),
  S('pouvoir', 'pres', 'Tu {peux} venir ?', 'Can you come? (tu)', 'Peux-tu venir ?'),
  S('pouvoir', 'pres', 'Il {peut} rester.', 'He can stay.'),
  S('pouvoir', 'pres', 'Nous {pouvons} partir maintenant.', 'We can leave now.'),
  S('pouvoir', 'pres', 'Vous {pouvez} répéter ?', 'Can you repeat that? (vous)', 'Pouvez-vous répéter ?'),
  S('pouvoir', 'pres', 'Elles ne {peuvent} pas venir.', "They can't come. (f.)"),
  S('pouvoir', 'pc', "Il n'a pas {pu} dormir.", "He couldn't sleep."),
];

/** A sentence taken apart at its gap: what comes before, the accepted
 *  forms (the first the one shown), and what comes after. */
export function gapOf(sentence: Pick<Sentence, 'fr'>): { before: string; forms: string[]; after: string } {
  const m = /^(.*?)\{([^}]+)\}(.*)$/.exec(sentence.fr);
  if (!m) throw new Error(`a sentence of the bank has no gap: ${sentence.fr}`);
  return { before: m[1]!, forms: m[2]!.split('|'), after: m[3]! };
}

/** Every whole French sentence a translation may be: the sentence with each
 *  of its gap's forms, and its alternatives. The first is the one shown. */
export function wholeOf(sentence: Sentence): string[] {
  const { before, forms, after } = gapOf(sentence);
  return [...forms.map((f) => `${before}${f}${after}`), ...(sentence.alts ?? [])];
}

/** The kinds of exercise a page holds. */
export type ExerciseKind = 'present' | 'perfect' | 'translate' | 'participles' | 'infinitives' | 'table';

/** One item of an exercise: the text either side of the gap, a cue in
 *  brackets beside it (an infinitive, a meaning, a sentence in English),
 *  the answers accepted, the one shown, and what is heard once it is
 *  checked — the whole sentence, so the form is heard where it lives.
 *  `wide` is a gap a whole sentence goes in. `pronoun` is true where a
 *  pronoun typed in front of the form is not held against it. */
export interface Item {
  id: string;
  before: string;
  after: string;
  cue: string;
  accepted: string[];
  shown: string;
  heard: Phrase;
  wide: boolean;
  pronoun: boolean;
}

/** A block of a workbook: a heading and an instruction, as a book would
 *  give them, and its items. Any sheet's exercises are drawn and marked as
 *  this (components/BookExercise.svelte), whatever kinds it deals. */
export interface Workbook {
  title: string;
  instruction: string;
  items: Item[];
}

/** One exercise of the verbs workbook. */
export interface Exercise extends Workbook {
  kind: ExerciseKind;
}

/** Where a sentence's clip is kept: under the book, by its place in the
 *  bank. A sentence is only ever added at the end, so a slot never comes to
 *  mean a different sentence. */
const BOOK_KEY = 'essentials|book';
const heardSentence = (s: Sentence): Phrase =>
  ({ key: BOOK_KEY, slot: `s${SENTENCES.indexOf(s)}`, text: wholeOf(s)[0]! });

const verbOf = (inf: string): Verb => {
  const v = VERBS.find((x) => x.inf === inf);
  if (!v) throw new Error(`no verb ${inf} on the sheet`);
  return v;
};

/** The sentence's gap as an item: present or participle alike. */
function gapItem(s: Sentence): Item {
  const { before, forms, after } = gapOf(s);
  return {
    id: `gap|${SENTENCES.indexOf(s)}`, before, after, cue: s.verb, accepted: forms,
    shown: forms[0]!, heard: heardSentence(s), wide: false, pronoun: false,
  };
}

function translateItem(s: Sentence): Item {
  const whole = wholeOf(s);
  return {
    id: `tr|${SENTENCES.indexOf(s)}`, before: '', after: '', cue: s.en, accepted: whole,
    shown: whole[0]!, heard: heardSentence(s), wide: true, pronoun: false,
  };
}

/** What a page is dealt from: a seed, and optionally which verbs. */
export interface Deal { seed: number; verbs?: readonly string[] }

/** How many items each exercise has: enough to be a page of a book, few
 *  enough to finish before checking. */
export const SIZES: Record<Exclude<ExerciseKind, 'table'>, number> = {
  present: 8, perfect: 6, translate: 6, participles: 9, infinitives: 9,
};

/** The first `n` of a list, in the order the seed gives. */
function pick<T>(list: readonly T[], n: number, seed: number): T[] {
  return orderedBy(list.length, seed).slice(0, n).map((i) => list[i]!);
}

/** One exercise of a kind, dealt from the seed. Every kind is dealt on its
 *  own seed, so one exercise can be re-dealt without changing the rest. */
export function exercise(kind: ExerciseKind, { seed, verbs }: Deal): Exercise {
  const pool = VERBS.filter((v) => !verbs?.length || verbs.includes(v.inf));
  const sentences = SENTENCES.filter((s) => pool.some((v) => v.inf === s.verb));
  switch (kind) {
    case 'present':
      return { kind, title: 'Au présent', instruction: 'Put the verb in brackets in the present tense.',
        items: pick(sentences.filter((s) => s.tense === 'pres'), SIZES.present, seed).map(gapItem) };
    case 'perfect':
      return { kind, title: 'Au passé composé', instruction:
        'Finish the passé composé with the past participle. With être, it agrees.',
      items: pick(sentences.filter((s) => s.tense === 'pc'), SIZES.perfect, seed).map(gapItem) };
    case 'translate':
      return { kind, title: 'Traduisez', instruction: 'Translate into French.',
        items: pick(sentences, SIZES.translate, seed).map(translateItem) };
    case 'participles':
      return { kind, title: 'Participes passés', instruction: 'Give the past participle.',
        items: pick(pool, SIZES.participles, seed).map((v) => ({
          id: `pp|${v.inf}`, before: '', after: '', cue: v.inf, accepted: [v.pp], shown: v.pp,
          heard: phrasesOfVerb(v).pp, wide: false, pronoun: false,
        })) };
    case 'infinitives': {
      /* One form of each verb, the person picked by the seed too. */
      const verbsHere = pick(pool, SIZES.infinitives, seed);
      const persons = orderedBy(6 * verbsHere.length, seed + 1).map((n) => (n % 6) as Person);
      return { kind, title: "Retrouvez l'infinitif", instruction: 'Which verb is it? Give the infinitive.',
        items: verbsHere.map((v, i) => {
          const p = persons[i] ?? 0;
          const line = `${PERSONS[p]} ${v.present[p]}`;
          return { id: `inf|${v.inf}|${p}`, before: '', after: '', cue: line, accepted: [v.inf],
            shown: v.inf, heard: phrasesOfVerb(v).present[p]!, wide: false, pronoun: false };
        }) };
    }
    case 'table': {
      const v = pick(pool, 1, seed)[0] ?? verbOf('être');
      /* The verb is named once, in the title; the instruction is the task. */
      return { kind, title: `Conjuguez : ${v.inf} (${v.en})`,
        instruction: 'Write out the present tense, then the past participle.',
        items: [
          ...v.present.map((form, i) => ({
            id: `tab|${v.inf}|${i}`, before: PERSONS[i]!, after: '', cue: '', accepted: [form],
            shown: form, heard: phrasesOfVerb(v).present[i]!, wide: false, pronoun: true,
          })),
          { id: `tab|${v.inf}|pp`, before: 'participe', after: '', cue: '', accepted: [v.pp],
            shown: v.pp, heard: phrasesOfVerb(v).pp, wide: false, pronoun: false },
        ] };
    }
  }
  throw new Error(`no such exercise: ${String(kind)}`);
}

/** The order the page sets its exercises in. */
export const PAGE: readonly ExerciseKind[] = ['present', 'perfect', 'participles', 'infinitives', 'translate', 'table'];

/** A whole page: every kind, each on its own seed drawn from the page's. */
export function page(deal: Deal): Exercise[] {
  return PAGE.map((kind, i) => exercise(kind, { ...deal, seed: deal.seed * 31 + i }));
}

/** How one item came out: right, wrong, or left empty, and what it is
 *  compared against — the nearest accepted answer to what was typed. */
export interface Mark { state: 'right' | 'wrong' | 'empty'; against: string; typed: string }

/** Mark an exercise: every item, in order. A pronoun in front of a table
 *  cell is not held against it. */
export function mark(ex: Pick<Workbook, 'items'>, typed: readonly string[]): { marks: Mark[]; right: number } {
  const marks = ex.items.map((item, i): Mark => {
    const raw = typed[i] ?? '';
    const input = item.pronoun ? dropPronoun(raw) : raw;
    if (!input.trim()) return { state: 'empty', against: item.shown, typed: '' };
    if (isRight(input, item.accepted)) return { state: 'right', against: item.shown, typed: input };
    return { state: 'wrong', against: nearest(input, item.accepted), typed: input };
  });
  return { marks, right: marks.filter((m) => m.state === 'right').length };
}
