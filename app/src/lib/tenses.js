/** What each tense is for, in English, for the info popover on a verb table.
 *
 *  This is teaching prose, not a fact about French the pipeline could have
 *  looked up, so it is written here by hand and kept short. The forms and the
 *  example sentences beside it are sourced; this is only the caption.
 *
 *  Keyed by the group id the pipeline gives each table (see
 *  frcog/conjugation.py, SIMPLE_TENSES and COMPOUND_TENSES). */
export const TENSE_NOTES = {
  pres: {
    name: 'Présent',
    use: 'What is happening now, what is generally true, and what you do habitually. '
      + 'French has one present where English has two: je mange is both "I eat" and "I am eating". '
      + 'It also stands in for the near future with a time word: je pars demain, "I leave tomorrow".',
  },
  imp: {
    name: 'Imparfait',
    use: 'The past as a scene rather than an event: what was going on, what used to happen, '
      + 'how things were. Il pleuvait, "it was raining"; j’allais souvent, "I used to go often". '
      + 'When a story switches to what happened next, it switches to the passé composé.',
  },
  fut: {
    name: 'Futur simple',
    use: 'What will happen: je partirai, "I will leave". Speech often prefers aller + infinitive '
      + '(je vais partir, "I am going to leave") for the near future, and keeps the futur simple '
      + 'for promises, predictions and anything further off. It also follows quand and dès que '
      + 'when the main clause is in the future.',
  },
  cond: {
    name: 'Conditionnel',
    use: 'What would happen: je partirais, "I would leave", usually with an if-clause in the '
      + 'imparfait (si j’avais le temps). Also the polite form of a wish or request: '
      + 'je voudrais, "I would like"; pourriez-vous, "could you". The stem is the future stem.',
  },
  subj: {
    name: 'Subjonctif',
    use: 'Not a time but a mood. It follows que after verbs and phrases of wanting, needing, '
      + 'feeling and doubting: il faut que je parte, "I have to leave"; je veux que tu viennes, '
      + '"I want you to come"; bien qu’il soit tard, "although it is late". After penser and '
      + 'dire in the affirmative the indicative is used instead.',
  },
  imper: {
    name: 'Impératif',
    use: 'Orders, requests and suggestions with no pronoun: mange, "eat"; allons-y, "let’s go"; '
      + 'veuillez patienter, "please wait". Only tu, nous and vous exist. For -er verbs the tu '
      + 'form drops the s of the present.',
  },
  hist: {
    name: 'Passé simple',
    use: 'The past of narrative writing: novels, history, newspapers. Il partit, "he left". '
      + 'In speech the passé composé does this job, so you need to recognise these forms when '
      + 'reading and will almost never say them.',
  },
  subjimp: {
    name: 'Subjonctif imparfait',
    use: 'A literary tense that follows que in the past, where spoken French uses the '
      + 'subjonctif présent: il fallait qu’il partît. Recognise it in older books; do not '
      + 'produce it.',
  },
  pc: {
    name: 'Passé composé',
    use: 'The everyday past for things that happened: j’ai mangé, "I ate" or "I have eaten". '
      + 'Auxiliary in the present plus the past participle. Verbs of movement and change, and all '
      + 'reflexive verbs, take être, and then the participle agrees with the subject.',
  },
  pqp: {
    name: 'Plus-que-parfait',
    use: 'Something that had already happened before another past event: j’avais mangé quand '
      + 'il est arrivé, "I had eaten when he arrived". Auxiliary in the imparfait.',
  },
  futant: {
    name: 'Futur antérieur',
    use: 'Something that will have happened by a point in the future: j’aurai fini avant midi, '
      + '"I will have finished before noon". Auxiliary in the futur simple. Also used for a guess '
      + 'about the past: il aura oublié, "he must have forgotten".',
  },
  condp: {
    name: 'Conditionnel passé',
    use: 'Something that would have happened: j’aurais aimé venir, "I would have liked to come", '
      + 'with the if-clause in the plus-que-parfait. Auxiliary in the conditionnel. Also regret and '
      + 'reproach: tu aurais dû, "you should have".',
  },
  subjp: {
    name: 'Subjonctif passé',
    use: 'The subjonctif for something already completed: je suis content que tu sois venu, '
      + '"I am glad you came". Auxiliary in the subjonctif présent plus the past participle.',
  },
};
