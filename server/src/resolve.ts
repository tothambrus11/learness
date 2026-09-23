/** What to do with a word Claude wants to add, before anything is written.
 *
 *  A word offered by a lesson may already exist in three places: in the
 *  learner's own list, in the catalogue (taught eventually, or already), or in
 *  the dictionary the pipeline ships beside it. The first connector checked
 *  none of them and keyed by the typed spelling, so "le train" became
 *  `le train|noun` next to the catalogue's `train|noun`: one word, two cards,
 *  one of them mute. Everything here exists so that cannot happen again.
 *
 *  The rules are the app's own — `sameWord`, `nearMiss`, `userKey`, `statusOf`
 *  — imported from it rather than copied, so what the words screen would do
 *  with a typed word and what the connector does with an offered one is the
 *  same decision. Pure: the callers fetch, this decides, and the tests are a
 *  table.
 *
 *  Where the decision is not safe to make alone it is not made: the outcome is
 *  a `conflict` carrying every candidate, nothing is written for that word,
 *  and the caller retries with `resolve.use` (this is that word) or
 *  `resolve.force` (this is a word of its own) once someone has decided.
 */
import { nearMiss, norm, sameWord } from '../../app/src/lib/check.js';
import { articleKind, splitArticle } from '../../app/src/lib/gender.js';
import { trustWordKey, userKey } from '../../app/src/lib/keys.js';
import type { WordKey } from '../../app/src/lib/keys.js';
import { statusOf } from '../../app/src/lib/ladder.js';
import type { WordStatus } from '../../app/src/lib/ladder.js';
import type {
  DictEntry, Gender, GrammaticalNumber, IndexEntry, StoredCard, UserWord,
} from '../../app/src/lib/model.js';
import type { Millis } from '../../app/src/lib/units.js';
import { fold, shardOf } from '../../app/src/lib/wordsearch.js';

/* -------------------------------------------------------------- inputs -- */

/** What the caller decided after a conflict. `use` names a candidate's key
 *  and means "this is that word": the existing entry is updated, the
 *  catalogue's is promoted, the dictionary's is taken. `force` means "this is
 *  a word of its own" and adds it under its own key whatever else exists. */
export interface Resolve {
  force?: boolean;
  use?: string;
}

/** A word as offered. Everything but the French is optional, because a
 *  tutor's list rarely says more than "le natel — mobile phone". */
export interface Proposal {
  fr: string;
  en: string[];
  pos?: string;
  gender?: Gender;
  number?: GrammaticalNumber;
  note?: string;
  resolve?: Resolve;
}

/** Everything a decision is made against. The catalogue and the dictionary
 *  may be unreadable, which is `null` and is said in the outcome rather than
 *  silently treated as "no such word". */
export interface Context {
  mine: readonly UserWord[];
  catalogue: readonly IndexEntry[] | null;
  /** The dictionary's words for a first letter (see `shardOf`), or null. */
  dictionary: (letter: string) => readonly DictEntry[] | null;
  cards: readonly StoredCard[];
  now: Millis;
  lesson?: string;
}

/* ------------------------------------------------------------- outcomes -- */

export type Source = 'mine' | 'catalogue' | 'dictionary';

/** How a candidate relates to what was offered. "same word" is the one that
 *  is acted on without asking; the rest are why it was asked. */
export type Relation =
  | 'same key'
  | 'same word'
  | 'same word, different part of speech'
  | 'same spelling, different gender'
  | 'a letter or two apart'
  | 'same English';

/** Where a candidate stands: the word's ladder status for one that has a
 *  card, or where it sits when it has none. */
export type CandidateStatus =
  | WordStatus
  | 'in your list, removed'
  | 'in your list, skipped'
  | 'in the catalogue, not scheduled'
  | 'in the dictionary, not in your list';

/** A word that might be the one offered. `key` is what `resolve.use` takes. */
export interface Candidate {
  source: Source;
  key: WordKey;
  fr: string;
  en: string[];
  pos: string;
  gender?: Gender;
  status: CandidateStatus;
  relation: Relation;
}

export type Outcome =
  /** A word of the learner's own, keyed by its spelling. `from` says the
   *  record was filled from the dictionary; `restored` that a removed word
   *  came back. */
  | { action: 'add'; record: UserWord; from?: 'dictionary'; restored?: boolean }
  /** The catalogue has it: the catalogue's record and key, so the audio and
   *  the tables come with it, and the word joins the next sitting. */
  | { action: 'promote'; record: UserWord; was: CandidateStatus }
  /** Already in the list under that key: the record with the offered fields
   *  laid over it. The key, and so the cards and history, stay. */
  | { action: 'update'; record: UserWord; previous: UserWord; changed: string[] }
  /** Already in the list, saying the same thing. Nothing to write. */
  | { action: 'unchanged'; record: UserWord }
  /** The same word appears earlier in this batch; its glosses were folded
   *  into that one. */
  | { action: 'merged'; into: number }
  /** Not decided: here is what it might be. Nothing is written. */
  | { action: 'conflict'; candidates: Candidate[]; hint: string }
  | { action: 'invalid'; reason: string };

export interface Resolution {
  index: number;
  proposal: Proposal;
  outcome: Outcome;
  /** Words of the learner's own that share an English gloss with this one:
   *  a synonym, worth knowing about, never merged. */
  related: Candidate[];
  /** What could not be checked, said once per row so the caller can say it. */
  notes: string[];
}

export const CONFLICT_HINT = 'Nothing was written for this word. To treat it as one of the '
  + 'candidates, send it again with resolve.use set to that candidate\'s key; to add it as a '
  + 'word of its own regardless, send it again with resolve.force true.';

/* ---------------------------------------------------------------- rules -- */

/** The parts of speech as the catalogue names them, from the ways a person
 *  or a model writes them. Unknown stays unknown rather than guessed. */
const POS_ALIASES: Record<string, string> = {
  noun: 'noun', n: 'noun', nom: 'noun',
  verb: 'verb', v: 'verb', verbe: 'verb',
  adj: 'adj', adjective: 'adj', adjectif: 'adj',
  adv: 'adv', adverb: 'adv', adverbe: 'adv',
  prep: 'prep', preposition: 'prep', préposition: 'prep',
  conj: 'conj', conjunction: 'conj',
  pron: 'pron', pronoun: 'pron',
  det: 'det', determiner: 'det', article: 'det',
  interj: 'interj', interjection: 'interj',
  phrase: 'phrase', expression: 'phrase', idiom: 'phrase',
  other: 'other', unknown: '',
};
export const normalisePos = (pos: string | undefined): string => {
  const p = (pos ?? '').trim().toLowerCase();
  return POS_ALIASES[p] ?? p;
};

/** The part of speech a catalogue key carries: everything after the last bar. */
export const posOf = (key: WordKey): string => key.slice(key.lastIndexOf('|') + 1);

/** Two parts of speech that may be the same word: equal, or one unsaid. */
const posAgree = (a: string, b: string): boolean =>
  !a || !b || a === 'unknown' || b === 'unknown' || a === b;

/** A word's gender, from its field or from the article it is written with;
 *  empty where neither says. */
const genderOf = (fr: string, gender?: Gender): Gender => {
  if (gender) return gender;
  const kind = articleKind(splitArticle(fr).article);
  return kind === 'm' || kind === 'f' || kind === 'mf' ? kind : '';
};
const genderAgree = (a: Gender, b: Gender): boolean => !a || !b || a === b || a === 'mf' || b === 'mf';

/** Glosses compared as the English check compares them: folded, "to" and
 *  the articles off the front. */
const gloss = (s: string): string => fold(s).replace(/^(to|a|an|the)\s+/, '');
const sharesGloss = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a.map(gloss).filter(Boolean));
  return b.some((e) => left.has(gloss(e)));
};

/** Glosses of both, each once, in the order given. */
const unionEn = (first: readonly string[], second: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of [...first, ...second]) {
    const key = norm(e);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e.trim());
  }
  return out;
};

/** Where one of the learner's words stands, or that it was removed or set
 *  aside (UserWord.skipped). */
const mineStatus = (w: UserWord, cards: readonly StoredCard[], now: Millis): CandidateStatus =>
  w.deleted ? 'in your list, removed' : w.skipped ? 'in your list, skipped' : statusOf(w.k, cards, new Date(now));

/** Where a catalogue word stands: on its card if it has one, else waiting. */
const catalogueStatus = (key: WordKey, cards: readonly StoredCard[], now: Millis):
  CandidateStatus => {
  const status = statusOf(key, cards, new Date(now));
  return status === 'not started' ? 'in the catalogue, not scheduled' : status;
};

/** A candidate, with its gender only where it has one: an absent field is
 *  absent, not ''. Every candidate is made here. */
function candidate(
  source: Source, key: WordKey, word: { fr: string; en: readonly string[]; pos: string },
  gender: Gender | undefined, status: CandidateStatus, relation: Relation,
): Candidate {
  const c: Candidate = { source, key, fr: word.fr, en: [...word.en], pos: word.pos, status, relation };
  if (gender) c.gender = gender;
  return c;
}

/* -------------------------------------------------------------- records -- */

/** Only what was said goes into a record: an absent gender is absent, not
 *  '', so the app's "you set it" and "you did not" stay distinguishable. */
function ownRecord(p: Proposal, pos: string, ctx: Context): UserWord {
  const rec: UserWord = {
    k: userKey(p.fr, pos), fr: p.fr.trim(), en: unionEn(p.en, []), pos: pos || 'unknown',
    source: 'app', addedAt: ctx.now, updatedAt: ctx.now,
  };
  if (p.gender) rec.gender = p.gender;
  if (p.number) rec.number = p.number;
  if (p.note?.trim()) rec.note = p.note.trim();
  if (ctx.lesson) rec.lesson = ctx.lesson;
  return rec;
}

/** The catalogue's word, as the app promotes it — its key, its spelling, its
 *  glosses — with the lesson's own gloss first where it adds one, because
 *  the meaning the learner met is the one to be cued with. */
function promotedRecord(hit: IndexEntry, p: Proposal, ctx: Context): UserWord {
  const rec: UserWord = {
    k: hit.k, fr: hit.fr, en: unionEn(p.en, hit.en), pos: posOf(hit.k),
    source: 'catalogue', addedAt: ctx.now, updatedAt: ctx.now,
  };
  if (p.note?.trim()) rec.note = p.note.trim();
  if (ctx.lesson) rec.lesson = ctx.lesson;
  return rec;
}

/** A dictionary word, taken as the words screen takes one: article, glosses,
 *  part of speech, gender and transcription filled in, keyed as the learner's
 *  own since the catalogue does not teach it. */
function dictionaryRecord(d: DictEntry, p: Proposal, ctx: Context): UserWord {
  const rec: UserWord = {
    k: userKey(d.fr, d.pos), fr: d.fr, en: unionEn(p.en, d.en), pos: d.pos || 'unknown',
    source: 'app', addedAt: ctx.now, updatedAt: ctx.now,
  };
  const gender = p.gender || d.gender;
  if (gender) rec.gender = gender;
  if (p.number) rec.number = p.number;
  if (d.ipa) rec.ipa = d.ipa;
  if (p.note?.trim()) rec.note = p.note.trim();
  if (ctx.lesson) rec.lesson = ctx.lesson;
  return rec;
}

/** An offered word laid over the record it turned out to be. The key stays;
 *  the existing glosses stay first, so the card's cue does not change under
 *  the learner; anything the proposal says explicitly is taken.
 *
 *  The batch's lesson is not laid over: a word's label says which lesson it
 *  first came in under, and a word met again in a later lesson keeps it.
 *  The label used to ride along as a change, which made every word two
 *  lessons shared a conflict to escalate — for a word already correctly in
 *  the list. A relabel is update_words' to do, by key, on purpose. The one
 *  word that takes the batch's lesson is a removed one coming back: it is
 *  added afresh, with today's date and today's lesson. A word the learner
 *  had set aside (UserWord.skipped) and offers again is asked again: the
 *  offer is the learner's, and it says so as a change (#99). */
function updatedRecord(previous: UserWord, p: Proposal, pos: string, ctx: Context):
  { record: UserWord; changed: string[] } {
  const record: UserWord = { ...previous, updatedAt: ctx.now };
  delete record.deleted;
  const changed: string[] = [];
  if (previous.skipped) {
    delete record.skipped;
    changed.push('asked again');
  }
  const set = <K extends keyof UserWord>(field: K, value: UserWord[K] | undefined): void => {
    if (value === undefined || value === '') return;
    if (JSON.stringify(previous[field]) === JSON.stringify(value)) return;
    record[field] = value;
    changed.push(field);
  };
  const en = unionEn(previous.en, p.en);
  set('en', en.length === previous.en.length ? undefined : en);
  set('pos', pos && pos !== 'unknown' && previous.pos !== pos ? pos : undefined);
  set('gender', p.gender);
  set('number', p.number);
  set('note', p.note?.trim());
  if (previous.deleted) {
    changed.push('restored');
    record.addedAt = ctx.now;
    set('lesson', ctx.lesson);
  }
  return { record, changed };
}

/* ----------------------------------------------------------- candidates -- */

interface Gathered {
  candidates: Candidate[];
  related: Candidate[];
  notes: string[];
}

/** Everything the offered word might already be, from all three sources. */
function gather(p: Proposal, pos: string, key: WordKey, ctx: Context): Gathered {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const gender = genderOf(p.fr, p.gender);
  const active = ctx.mine.filter((w) => !w.deleted);

  /* The learner's own list, keys other than the one this would take. */
  for (const w of active) {
    if (w.k === key || !sameWord(w.fr, p.fr)) continue;
    candidates.push(candidate('mine', w.k, w, w.gender, mineStatus(w, ctx.cards, ctx.now),
      posAgree(w.pos, pos) ? 'same word' : 'same word, different part of speech'));
  }

  /* The catalogue. A word already promoted is the learner's, and appears
     above; here are the ones still only taught. */
  const mineKeys = new Set(active.map((w) => w.k));
  if (ctx.catalogue === null) {
    notes.push('The catalogue could not be read, so it was not checked for this word.');
  } else {
    for (const e of ctx.catalogue) {
      if (mineKeys.has(e.k) || !sameWord(e.fr, p.fr)) continue;
      const ePos = posOf(e.k);
      const eGender = genderOf(e.fr);
      const relation: Relation = !posAgree(ePos, pos) ? 'same word, different part of speech'
        : !genderAgree(eGender, gender) ? 'same spelling, different gender' : 'same word';
      candidates.push(candidate('catalogue', e.k, { fr: e.fr, en: e.en, pos: ePos }, eGender,
        catalogueStatus(e.k, ctx.cards, ctx.now), relation));
    }
  }

  /* The dictionary: only the shard this word would be filed under. An entry
     the catalogue also has is the catalogue's to offer. */
  const shard = ctx.dictionary(shardOf(p.fr));
  if (shard === null) {
    notes.push('The dictionary could not be read, so it was not checked for this word.');
  } else {
    for (const d of shard) {
      if (!sameWord(d.fr, p.fr)) continue;
      const dGender = genderOf(d.fr, d.gender);
      const dKey = userKey(d.fr, d.pos);
      if (mineKeys.has(dKey)) continue;
      const shadowed = candidates.some((c) => c.source === 'catalogue' && c.pos === d.pos
        && genderAgree(c.gender ?? '', dGender));
      if (shadowed) continue;
      const relation: Relation = !posAgree(d.pos, pos) ? 'same word, different part of speech'
        : !genderAgree(dGender, gender) ? 'same spelling, different gender' : 'same word';
      candidates.push(candidate('dictionary', dKey, d, dGender,
        'in the dictionary, not in your list', relation));
    }
  }

  /* A near miss is only worth raising when nothing spells the word exactly.
     Against the learner's own list always: a lesson's "chaussete" beside the
     list's "chaussette" is one word twice. Against the catalogue only when
     the dictionary was read and does not know the word either — a word
     unknown to both is probably a typo of one they know, while a real word
     one letter from another real word ("le pont", "le port") is not. */
  if (!candidates.length) {
    for (const w of active) {
      if (nearMiss(w.fr, p.fr)) {
        candidates.push(candidate('mine', w.k, w, w.gender, mineStatus(w, ctx.cards, ctx.now),
          'a letter or two apart'));
      }
    }
    if (shard !== null && ctx.catalogue) {
      for (const e of ctx.catalogue) {
        if (mineKeys.has(e.k) || !nearMiss(e.fr, p.fr)) continue;
        candidates.push(candidate('catalogue', e.k, { fr: e.fr, en: e.en, pos: posOf(e.k) },
          genderOf(e.fr), catalogueStatus(e.k, ctx.cards, ctx.now), 'a letter or two apart'));
      }
    }
  }

  /* Another of the learner's words that means the same thing is a synonym,
     said beside the outcome and never acted on. */
  const named = new Set(candidates.map((c) => c.key));
  const related: Candidate[] = active
    .filter((w) => w.k !== key && !named.has(w.k) && sharesGloss(w.en, p.en))
    .map((w) => candidate('mine', w.k, w, w.gender, mineStatus(w, ctx.cards, ctx.now), 'same English'));

  return { candidates, related, notes };
}

/* ------------------------------------------------------------- deciding -- */

/** `resolve.use`: the offered word is the one with this key, wherever it is. */
function useKey(p: Proposal, pos: string, use: string, gathered: Gathered, ctx: Context):
  Outcome {
  const key = trustWordKey(use.trim());
  const own = ctx.mine.find((w) => w.k === key);
  if (own) {
    const { record, changed } = updatedRecord(own, p, pos, ctx);
    if (!changed.length) return { action: 'unchanged', record: own };
    return { action: 'update', record, previous: own, changed };
  }
  const hit = ctx.catalogue?.find((e) => e.k === key);
  if (hit) {
    return { action: 'promote', record: promotedRecord(hit, p, ctx),
      was: catalogueStatus(hit.k, ctx.cards, ctx.now) };
  }
  const offered = gathered.candidates.find((c) => c.key === key && c.source === 'dictionary');
  const entry = offered
    ? ctx.dictionary(shardOf(offered.fr))?.find((d) => userKey(d.fr, d.pos) === key)
    : undefined;
  if (entry) return { action: 'add', record: dictionaryRecord(entry, p, ctx), from: 'dictionary' };
  return { action: 'invalid',
    reason: `resolve.use names "${use}", which is not in your list, the catalogue or the candidates` };
}

function decide(p: Proposal, ctx: Context): { outcome: Outcome; related: Candidate[]; notes: string[] } {
  const none = { related: [] as Candidate[], notes: [] as string[] };
  if (!p.fr.trim()) return { ...none, outcome: { action: 'invalid', reason: 'no French word was given' } };
  const pos = normalisePos(p.pos);
  const key = userKey(p.fr, pos);
  const gathered = gather(p, pos, key, ctx);
  const { candidates, related, notes } = gathered;
  const exact = ctx.mine.find((w) => w.k === key);

  if (p.resolve?.use) {
    return { related, notes, outcome: useKey(p, pos, p.resolve.use, gathered, ctx) };
  }

  /* Already in the list under the very key this would take. The same thing
     said twice is nothing to do; something different is a decision — the
     list may hold a correction the lesson does not know about. A different
     lesson label is not something different: the word is the same word,
     and it keeps the label of the lesson it first came in under. */
  if (exact && !exact.deleted) {
    const { record, changed } = updatedRecord(exact, p, pos, ctx);
    if (!changed.length) return { related, notes, outcome: { action: 'unchanged', record: exact } };
    if (p.resolve?.force) {
      return { related, notes, outcome: { action: 'update', record, previous: exact, changed } };
    }
    return { related, notes, outcome: { action: 'conflict', hint: CONFLICT_HINT, candidates: [
      candidate('mine', exact.k, exact, exact.gender, mineStatus(exact, ctx.cards, ctx.now), 'same key'),
      ...candidates] } };
  }

  if (p.resolve?.force) {
    const record = ownRecord(p, pos, ctx);
    return { related, notes, outcome: exact
      ? { action: 'add', record, restored: true } : { action: 'add', record } };
  }

  const same = candidates.filter((c) => c.relation === 'same word');
  const mineSame = same.filter((c) => c.source === 'mine');
  const catalogueSame = same.filter((c) => c.source === 'catalogue');
  const dictionarySame = same.filter((c) => c.source === 'dictionary');

  /* The learner already holds this word under another spelling of its key:
     never a silent second copy. */
  if (mineSame.length) {
    return { related, notes, outcome: { action: 'conflict', candidates, hint: CONFLICT_HINT } };
  }
  /* Exactly one catalogue word and nothing else it could be: promote, as the
     words screen would. Two ("le poste", "la poste", no gender said) is a
     question. */
  if (catalogueSame.length === 1 && !dictionarySame.length) {
    const hit = ctx.catalogue?.find((e) => e.k === catalogueSame[0]!.key);
    if (hit) {
      return { related, notes, outcome: { action: 'promote', record: promotedRecord(hit, p, ctx),
        was: catalogueSame[0]!.status } };
    }
  }
  if (!catalogueSame.length && dictionarySame.length === 1) {
    const c = dictionarySame[0]!;
    const entry = ctx.dictionary(shardOf(p.fr))?.find((d) => userKey(d.fr, d.pos) === c.key);
    if (entry) {
      return { related, notes,
        outcome: { action: 'add', record: dictionaryRecord(entry, p, ctx), from: 'dictionary' } };
    }
  }
  if (candidates.length) {
    return { related, notes, outcome: { action: 'conflict', candidates, hint: CONFLICT_HINT } };
  }
  const record = ownRecord(p, pos, ctx);
  return { related, notes,
    outcome: exact ? { action: 'add', record, restored: true } : { action: 'add', record } };
}

/** One decision per offered word, in the order offered.
 *
 *  The batch is first folded onto itself: a word offered twice — the tutor
 *  said it twice, or two lines gloss it differently — is one word with both
 *  glosses, and the later row says which earlier one it joined. Then each is
 *  decided against the list, the catalogue and the dictionary as they were
 *  when the caller fetched them; two rows that would take the same key are
 *  already one by then. */
export function resolveAdditions(proposals: readonly Proposal[], ctx: Context): Resolution[] {
  const merged: (Proposal | { into: number })[] = [];
  const kept: { index: number; proposal: Proposal }[] = [];
  proposals.forEach((p, index) => {
    const pos = normalisePos(p.pos);
    const earlier = kept.find((k) => sameWord(k.proposal.fr, p.fr)
      && posAgree(normalisePos(k.proposal.pos), pos));
    if (earlier && p.fr.trim()) {
      earlier.proposal = { ...earlier.proposal, en: unionEn(earlier.proposal.en, p.en),
        ...(earlier.proposal.pos || !p.pos ? {} : { pos: p.pos }),
        ...(earlier.proposal.gender || !p.gender ? {} : { gender: p.gender }),
        ...(earlier.proposal.note || !p.note ? {} : { note: p.note }) };
      merged.push({ into: earlier.index });
      return;
    }
    kept.push({ index, proposal: p });
    merged.push(p);
  });
  return merged.map((m, index) => {
    if ('into' in m) {
      return { index, proposal: proposals[index]!, outcome: { action: 'merged', into: m.into },
        related: [], notes: [] };
    }
    const proposal = kept.find((k) => k.index === index)!.proposal;
    const { outcome, related, notes } = decide(proposal, ctx);
    return { index, proposal, outcome, related, notes };
  });
}

/* -------------------------------------------------------------- editing -- */

/** A correction to a word already in the list, by key. Only what is given
 *  changes; the key never does, so the cards and their history stay. */
export interface Change {
  key: string;
  fr?: string;
  en?: string[];
  pos?: string;
  gender?: Gender;
  number?: GrammaticalNumber;
  note?: string;
  lesson?: string;
  resolve?: Resolve;
}

export type EditOutcome =
  | { action: 'update'; record: UserWord; previous: UserWord; changed: string[] }
  | { action: 'unchanged'; record: UserWord }
  | { action: 'missing'; key: string }
  /** The new spelling is another word the learner holds or the catalogue
   *  teaches. Nothing is written; `resolve.force` writes it anyway. */
  | { action: 'conflict'; candidates: Candidate[]; hint: string };

export const EDIT_CONFLICT_HINT = 'Nothing was changed. The new spelling is already a word in '
  + 'your list or the catalogue: if it is the same word, remove this one and add that; if it is '
  + 'a word of its own, send the change again with resolve.force true.';

/** The correction, decided: what the record becomes, or why it does not. */
export function resolveEdit(change: Change, ctx: Context): EditOutcome {
  const key = trustWordKey(change.key.trim());
  const previous = ctx.mine.find((w) => w.k === key && !w.deleted);
  if (!previous) return { action: 'missing', key: change.key };

  const record: UserWord = { ...previous, updatedAt: ctx.now };
  const changed: string[] = [];
  const set = <K extends keyof UserWord>(field: K, value: UserWord[K] | undefined): void => {
    if (value === undefined) return;
    if (JSON.stringify(previous[field]) === JSON.stringify(value)) return;
    record[field] = value;
    changed.push(field);
  };
  const fr = change.fr?.trim();
  set('fr', fr || undefined);
  set('en', change.en === undefined ? undefined : unionEn(change.en, []));
  const pos = change.pos === undefined ? undefined : normalisePos(change.pos) || 'unknown';
  set('pos', pos);
  set('gender', change.gender);
  set('number', change.number);
  set('note', change.note === undefined ? undefined : change.note.trim());
  set('lesson', change.lesson === undefined ? undefined : change.lesson.trim());
  if (!changed.length) return { action: 'unchanged', record: previous };

  /* A new spelling is checked the way an addition is — against the list and
     the catalogue, not the dictionary or a near miss: an edit is deliberate,
     and a typo is what it is usually fixing. */
  if ((changed.includes('fr') || changed.includes('pos')) && !change.resolve?.force) {
    const gender = genderOf(record.fr, record.gender);
    const candidates: Candidate[] = [];
    for (const w of ctx.mine) {
      if (w.k === key || w.deleted || !sameWord(w.fr, record.fr)) continue;
      candidates.push(candidate('mine', w.k, w, w.gender, mineStatus(w, ctx.cards, ctx.now),
        posAgree(w.pos, record.pos) ? 'same word' : 'same word, different part of speech'));
    }
    for (const e of ctx.catalogue ?? []) {
      if (e.k === key || !sameWord(e.fr, record.fr)) continue;
      const eGender = genderOf(e.fr);
      if (!posAgree(posOf(e.k), record.pos) || !genderAgree(eGender, gender)) continue;
      candidates.push(candidate('catalogue', e.k, { fr: e.fr, en: e.en, pos: posOf(e.k) }, eGender,
        catalogueStatus(e.k, ctx.cards, ctx.now), 'same word'));
    }
    if (candidates.length) return { action: 'conflict', candidates, hint: EDIT_CONFLICT_HINT };
  }
  return { action: 'update', record, previous, changed };
}
