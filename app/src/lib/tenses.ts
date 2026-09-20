/** What each tense is for, in English, for the info popover on a verb table.
 *
 *  This is teaching prose, not a fact about French the pipeline could have
 *  looked up, so it is written here by hand and kept short. The forms and the
 *  example sentences beside it are sourced; this is only the caption.
 *
 *  Keyed by the group id the pipeline gives each table (see
 *  frcog/conjugation.py, SIMPLE_TENSES and COMPOUND_TENSES). */
export interface TenseNote {
  /** The tense's French name, as the table heads it. */
  name: string;
  /** What it is for, in English, in a paragraph a learner can read. */
  use: string;
  /** How it is built, in English, in a paragraph: the stem, the endings, and
   *  the handful of verbs that do not follow. What the Grammar screen shows
   *  before the learner opens the tense (GRAMMAR.md): a card that asks for a
   *  form presumes the pattern is known, and this is where it is said. Read
   *  once; the verb's own table beside it is the worked example. */
  formation: string;
}

export const TENSE_NOTES: Record<string, TenseNote> = {
  pres: {
    name: 'Présent',
    use: 'What is happening now, what is generally true, and what you do habitually. '
      + 'French has one present where English has two: je mange is both "I eat" and "I am eating". '
      + 'It also stands in for the near future with a time word: je pars demain, "I leave tomorrow".',
    formation: 'Three regular patterns, by the infinitive\'s ending. -er verbs (parler) take -e, -es, '
      + '-e, -ons, -ez, -ent: je parle, nous parlons. -ir verbs like finir add -iss- in the '
      + 'plural: je finis, nous finissons, ils finissent. -re verbs (vendre) take -s, -s, '
      + 'nothing, -ons, -ez, -ent: je vends, il vend, nous vendons. Four of the six -er forms '
      + 'sound the same, and -ent is silent everywhere. The commonest verbs are irregular and '
      + 'are learnt as themselves: être, avoir, aller, faire, and the modals pouvoir, vouloir, '
      + 'devoir.',
  },
  imp: {
    name: 'Imparfait',
    use: 'The past as a scene rather than an event: what was going on, what used to happen, '
      + 'how things were. Il pleuvait, "it was raining"; j’allais souvent, "I used to go often". '
      + 'When a story switches to what happened next, it switches to the passé composé.',
    formation: 'One stem and one set of endings, with one exception. Take the nous form of the présent '
      + 'and drop -ons: nous finissons gives finiss-, nous prenons gives pren-. Add -ais, -ais, '
      + '-ait, -ions, -iez, -aient: je finissais, nous prenions. The exception is être, whose '
      + 'stem is ét-: j\'étais, nous étions. Verbs in -cer and -ger keep their sound before a: '
      + 'je commençais, je mangeais. The first three endings and the last sound alike, so the '
      + 'pronoun does the work in speech.',
  },
  fut: {
    name: 'Futur simple',
    use: 'What will happen: je partirai, "I will leave". Speech often prefers aller + infinitive '
      + '(je vais partir, "I am going to leave") for the near future, and keeps the futur simple '
      + 'for promises, predictions and anything further off. It also follows quand and dès que '
      + 'when the main clause is in the future.',
    formation: 'The infinitive is the stem, and the endings are avoir\'s présent: -ai, -as, -a, -ons, '
      + '-ez, -ont. Je parlerai, tu finiras, ils vendront; an -re verb drops its final e first '
      + '(vendr-). The stems that do not come from the infinitive are learnt as items and '
      + 'shared with the conditionnel: ser- (être), aur- (avoir), ir- (aller), fer- (faire), '
      + 'viendr- (venir), pourr- (pouvoir), voudr- (vouloir), devr- (devoir), saur- (savoir), '
      + 'verr- (voir), faudr- (falloir). After quand and dès que, where English uses the '
      + 'present, French uses this tense.',
  },
  cond: {
    name: 'Conditionnel',
    use: 'What would happen: je partirais, "I would leave", usually with an if-clause in the '
      + 'imparfait (si j’avais le temps). Also the polite form of a wish or request: '
      + 'je voudrais, "I would like"; pourriez-vous, "could you". The stem is the future stem.',
    formation: 'The futur\'s stem with the imparfait\'s endings: je parlerais, tu finirais, il vendrait, '
      + 'nous serions, vous auriez, ils iraient. Every irregular stem is the futur\'s, so a verb '
      + 'learnt there is learnt here. On the page the whole difference from the futur is -rai '
      + 'against -rais; in the mouth it is /e/ against /ɛ/, a distinction Swiss French keeps at '
      + 'the end of a word.',
  },
  subj: {
    name: 'Subjonctif',
    use: 'Not a time but a mood. It follows que after verbs and phrases of wanting, needing, '
      + 'feeling and doubting: il faut que je parte, "I have to leave"; je veux que tu viennes, '
      + '"I want you to come"; bien qu’il soit tard, "although it is late". After penser and '
      + 'dire in the affirmative the indicative is used instead.',
    formation: 'Take the ils form of the présent and drop -ent: ils finissent gives finiss-, ils '
      + 'prennent gives prenn-. Add -e, -es, -e, -ions, -iez, -ent: que je finisse, qu\'ils '
      + 'prennent. The nous and vous forms are the imparfait\'s, so a verb with two présent '
      + 'stems has two here too: que je boive, que nous buvions. The items: être (sois, '
      + 'soyons), avoir (aie, ayons), aller (aille, allions), faire (fasse), pouvoir (puisse), '
      + 'savoir (sache), vouloir (veuille, voulions), falloir (faille). It always follows que.',
  },
  imper: {
    name: 'Impératif',
    use: 'Orders, requests and suggestions with no pronoun: mange, "eat"; allons-y, "let’s go"; '
      + 'veuillez patienter, "please wait". Only tu, nous and vous exist. For -er verbs the tu '
      + 'form drops the s of the present.',
    formation: 'The tu, nous and vous forms of the présent, without the pronoun: finis, finissons, '
      + 'finissez. An -er verb, and aller and the verbs like ouvrir, drop the -s of the tu '
      + 'form: parle, va, ouvre — and take it back before y and en, for the sound: vas-y, '
      + 'parles-en. Four verbs have forms of their own: être (sois, soyons, soyez), avoir (aie, '
      + 'ayons, ayez), savoir (sache, sachons, sachez), vouloir (veuillez). A pronoun follows '
      + 'an order with a hyphen and me becomes moi: donne-le-moi; before a negative one it goes '
      + 'back in front: ne me le donne pas.',
  },
  hist: {
    name: 'Passé simple',
    use: 'The past of narrative writing: novels, history, newspapers. Il partit, "he left". '
      + 'In speech the passé composé does this job, so you need to recognise these forms when '
      + 'reading and will almost never say them.',
    formation: 'Recognised, never produced. -er verbs end in -a and -èrent: il parla, ils parlèrent. '
      + '-ir and -re verbs end in -it and -irent: il finit, ils vendirent. Verbs whose '
      + 'participle ends in -u end in -ut and -urent: il eut, il fut is être, il vint is venir, '
      + 'il fit is faire. In a novel or a newspaper it does the work the passé composé does in '
      + 'speech.',
  },
  subjimp: {
    name: 'Subjonctif imparfait',
    use: 'A literary tense that follows que in the past, where spoken French uses the '
      + 'subjonctif présent: il fallait qu’il partît. Recognise it in older books; do not '
      + 'produce it.',
    formation: 'Recognised, never produced. Built on the passé simple\'s stem with -sse endings: qu\'il '
      + 'parlât, qu\'il finît, qu\'il fût, qu\'il eût. Found in older books after que in the past, '
      + 'where spoken French uses the subjonctif présent.',
  },
  pc: {
    name: 'Passé composé',
    use: 'The everyday past for things that happened: j’ai mangé, "I ate" or "I have eaten". '
      + 'Auxiliary in the present plus the past participle. Verbs of movement and change, and all '
      + 'reflexive verbs, take être, and then the participle agrees with the subject.',
    formation: 'The auxiliary in the présent and the past participle. The participle: -er gives -é '
      + '(parlé), -ir gives -i (fini), -re gives -u (vendu); the irregular ones are learnt as '
      + 'items (eu, été, fait, pris, mis, dit, écrit, vu, bu, lu, su, pu, dû, voulu, venu, '
      + 'ouvert, mort, né). The auxiliary is avoir for most verbs; être for the verbs of '
      + 'coming, going and changing — aller, venir, arriver, partir, entrer, sortir, monter, '
      + 'descendre, naître, mourir, rester, tomber, retourner, passer, devenir — and for every '
      + 'pronominal verb. With être the participle agrees with the subject: elle est partie, '
      + 'ils sont venus.',
  },
  pqp: {
    name: 'Plus-que-parfait',
    use: 'Something that had already happened before another past event: j’avais mangé quand '
      + 'il est arrivé, "I had eaten when he arrived". Auxiliary in the imparfait.',
    formation: 'The auxiliary in the imparfait and the past participle, everything else as in the '
      + 'passé composé: j\'avais mangé, elle était partie, nous nous étions levés. Nothing new '
      + 'to learn once those two are known.',
  },
  futant: {
    name: 'Futur antérieur',
    use: 'Something that will have happened by a point in the future: j’aurai fini avant midi, '
      + '"I will have finished before noon". Auxiliary in the futur simple. Also used for a guess '
      + 'about the past: il aura oublié, "he must have forgotten".',
    formation: 'The auxiliary in the futur simple and the past participle: j\'aurai fini, elle sera '
      + 'partie. The same auxiliary and the same agreement as the passé composé.',
  },
  condp: {
    name: 'Conditionnel passé',
    use: 'Something that would have happened: j’aurais aimé venir, "I would have liked to come", '
      + 'with the if-clause in the plus-que-parfait. Auxiliary in the conditionnel. Also regret and '
      + 'reproach: tu aurais dû, "you should have".',
    formation: 'The auxiliary in the conditionnel présent and the past participle: j\'aurais aimé, tu '
      + 'serais venu, il aurait dû. The same auxiliary and the same agreement as the passé '
      + 'composé.',
  },
  subjp: {
    name: 'Subjonctif passé',
    use: 'The subjonctif for something already completed: je suis content que tu sois venu, '
      + '"I am glad you came". Auxiliary in the subjonctif présent plus the past participle.',
    formation: 'The auxiliary in the subjonctif présent and the past participle: que j\'aie fini, que '
      + 'tu sois venu. The same auxiliary and the same agreement as the passé composé.',
  },
};

/** What each of the tenses a which-time card offers *means*, said as time
 *  rather than as a tense name: the card asks a learner to read the ending
 *  and say what happened, which is the question the ending answers. Keyed
 *  the same way as TENSE_NOTES. */
export const TIME_MEANING: Record<string, string> = {
  pc: 'it happened — done, once, over',
  imp: 'it was going on, or used to happen',
  fut: 'it will happen',
};
