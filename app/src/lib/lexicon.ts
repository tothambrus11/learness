/** Any French word on a screen, taken apart so it can be looked up.
 *
 *  Two rules, both pure. `tokens` cuts a line of French into the words a
 *  learner would point at — *J'appelle ma mère* is *J'*, *appelle*, *ma*,
 *  *mère* — and says, for each, the form to look up: the elided *j'* is
 *  *je*. `bases` says which dictionary words a form could be: *appelle*
 *  could be *appeler*, *mes* is *mon*, *chevaux* is *cheval*. It proposes
 *  generously — *appellons*, *appellir* and *appellre* as well — because
 *  every guess is checked against the catalogue and the dictionary before
 *  anything is shown (lookup.ts), and a guess nothing knows costs a map
 *  lookup. What it must not do is miss the right one.
 *
 *  The dictionary is a list of headwords, the singular and the infinitive;
 *  a sentence is made of forms. This is the bridge, and it is rules rather
 *  than a list of every form because the pipeline ships no such list.
 */

/** A piece of a line: a word to look up, or what lies between words. */
export interface Token {
  /** The text as written, to draw. */
  text: string;
  /** The form to look up, lower case — the elided *j'* as *je* — or null
   *  for spaces and punctuation. */
  look: string | null;
}

/** The elided words, as they are looked up. */
const ELIDED: Readonly<Record<string, string>> = {
  j: 'je', l: 'le', d: 'de', qu: 'que', n: 'ne', s: 'se', m: 'me', t: 'te', c: 'ce',
  jusqu: 'jusque', lorsqu: 'lorsque', puisqu: 'puisque', quoiqu: 'quoique',
};

/** Words with an apostrophe inside that are one word. */
const WHOLE = new Set(["aujourd'hui", "quelqu'un", "quelqu'une", "presqu'île", "prud'homme"]);

/** The pronouns a hyphen joins to a verb: *peux-tu*, *dis-moi*, *a-t-il*. */
const INVERTED = /^(.*?)(-t)?-(je|tu|il|elle|on|nous|vous|ils|elles|moi|toi|le|la|les|lui|leur|y|en|ce)$/i;

const WORD = /\p{L}+(?:['’-]\p{L}+)*['’]?/gu;

const norm = (s: string): string => s.toLowerCase().replace(/’/g, "'");

/** One run of letters, split where French writes two words as one: an
 *  elided word before its apostrophe, a pronoun after the hyphen that joins
 *  it to its verb. */
function split(run: string): Token[] {
  const lower = norm(run);
  if (WHOLE.has(lower)) return [{ text: run, look: lower }];
  const elided = /^(\p{L}+)['’](.*)$/u.exec(run);
  if (elided) {
    const head = ELIDED[norm(elided[1]!)];
    if (head) {
      const apostrophe = run.slice(elided[1]!.length, elided[1]!.length + 1);
      const first: Token = { text: `${elided[1]!}${apostrophe}`, look: head };
      return elided[2] ? [first, ...split(elided[2])] : [first];
    }
  }
  const inverted = INVERTED.exec(run);
  if (inverted?.[1]) {
    const verb = inverted[1];
    const joint = run.slice(verb.length, run.length - inverted[3]!.length);
    return [...split(verb), { text: joint, look: null }, { text: inverted[3]!, look: norm(inverted[3]!) }];
  }
  return [{ text: run, look: lower }];
}

/** A line of French as words and the gaps between them, in order: joined
 *  back together, the texts are the line exactly. */
export function tokens(line: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const m of line.matchAll(WORD)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index), look: null });
    out.push(...split(m[0]));
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), look: null });
  return out;
}

/** One headword a form could be: its lemma, the part of speech it would
 *  have to be (null for any), and how the form comes from it, for the
 *  popup to say — empty where the form is the headword itself. */
export interface Base {
  lemma: string;
  pos: string | null;
  via: string;
}

/** The forms of the determiners and the few words whose forms no rule
 *  would find, to their headword. */
const FORM_OF: Readonly<Record<string, string>> = {
  ma: 'mon', mes: 'mon', ta: 'ton', tes: 'ton', sa: 'son', ses: 'son', nos: 'notre', vos: 'votre',
  leurs: 'leur', la: 'le', les: 'le', une: 'un', des: 'un', cette: 'ce', cet: 'ce', ces: 'ce',
  au: 'à', aux: 'à', du: 'de', belle: 'beau', bel: 'beau', belles: 'beau', beaux: 'beau',
  nouvelle: 'nouveau', nouvel: 'nouveau', nouvelles: 'nouveau', nouveaux: 'nouveau',
  vieille: 'vieux', vieil: 'vieux', vieilles: 'vieux', toute: 'tout', tous: 'tout', toutes: 'tout',
  quelle: 'quel', quels: 'quel', quelles: 'quel', yeux: 'œil', messieurs: 'monsieur', mesdames: 'madame',
};

/** A noun or adjective's plural, and an adjective's feminine, undone:
 *  each pair is an ending and what it was. */
const NOMINAL: readonly (readonly [string, string, string])[] = [
  ['aux', 'al', 'plural of'], ['eaux', 'eau', 'plural of'], ['eux', 'eu', 'plural of'],
  ['s', '', 'plural of'], ['x', '', 'plural of'],
  ['euse', 'eux', 'feminine of'], ['ive', 'if', 'feminine of'], ['ère', 'er', 'feminine of'],
  ['enne', 'en', 'feminine of'], ['onne', 'on', 'feminine of'], ['elle', 'el', 'feminine of'],
  ['ette', 'et', 'feminine of'], ['e', '', 'feminine of'],
];

/** The endings a conjugated form may carry, longest first. What is left is
 *  a stem; the infinitive is a stem and one of *er*, *ir*, *re*, *oir*. */
const ENDINGS = [
  'issaient', 'issions', 'issiez', 'issais', 'issait', 'issons', 'issez', 'issent', 'issant',
  'aient', 'ions', 'iez', 'ais', 'ait', 'ant', 'ons', 'ez', 'ent', 'es', 'e', 's', 't', 'x',
  'ées', 'és', 'ée', 'é', 'ies', 'is', 'ie', 'i', 'ues', 'us', 'ue', 'u', 'ites', 'its', 'ite', 'it', '',
];

/** A stem as the infinitive spells it, and as the forms may: *mangeons*
 *  keeps an e the infinitive has not, *commençons* a cedilla, *appelle*
 *  and *jette* a doubled consonant, *lève* and *préfère* a grave accent,
 *  *paie* an i for a y. */
function stems(stem: string): string[] {
  const out = new Set([stem]);
  if (stem.endsWith('ge')) out.add(stem.slice(0, -1));
  if (stem.endsWith('ç')) out.add(`${stem.slice(0, -1)}c`);
  if (/(ll|tt)$/.test(stem)) out.add(stem.slice(0, -1));
  if (stem.endsWith('i')) out.add(`${stem.slice(0, -1)}y`);
  /* Over the spellings so far, not the ones this loop adds. */
  const sofar = Array.from(out);
  for (const s of sofar) {
    const grave = s.lastIndexOf('è');
    if (grave >= 0) {
      out.add(`${s.slice(0, grave)}e${s.slice(grave + 1)}`);
      out.add(`${s.slice(0, grave)}é${s.slice(grave + 1)}`);
    }
  }
  return [...out];
}

/** Every headword this form could be, the form itself first: the form as
 *  a headword of any part of speech, a determiner's or an irregular
 *  word's headword, a plural or a feminine undone, and the infinitives a
 *  conjugated form could come from — the future and the conditional, which
 *  are the infinitive with an ending, among them. Each lemma and part of
 *  speech once. */
export function bases(form: string): Base[] {
  const word = norm(form).trim();
  const out = new Map<string, Base>();
  const add = (lemma: string, pos: string | null, via: string): void => {
    if (lemma.length < 1) return;
    const id = `${lemma}|${pos ?? ''}`;
    if (!out.has(id)) out.set(id, { lemma, pos, via });
  };
  if (!word) return [];
  add(word, null, '');
  const irregular = FORM_OF[word];
  if (irregular) add(irregular, null, 'a form of');
  if (word.length > 2) {
    for (const [end, was, via] of NOMINAL) {
      if (!word.endsWith(end) || word.length <= end.length) continue;
      const lemma = word.slice(0, word.length - end.length) + was;
      add(lemma, 'noun', via);
      add(lemma, 'adj', via);
      /* A feminine plural: *heureuses* is *heureux*. */
      if (end === 's') {
        for (const [fend, fwas, fvia] of NOMINAL) {
          if (fvia !== 'feminine of' || !lemma.endsWith(fend) || lemma.length <= fend.length) continue;
          add(lemma.slice(0, lemma.length - fend.length) + fwas, 'adj', fvia);
        }
      }
    }
  }
  /* The future and the conditional: the infinitive, or the infinitive
     without its e (*vendr-*), and an ending. */
  const future = /^(.+r)(ai|as|a|ons|ez|ont|ais|ait|ions|iez|aient)$/.exec(word);
  if (future) {
    add(future[1]!, 'verb', 'a form of');
    add(`${future[1]!}e`, 'verb', 'a form of');
  }
  for (const end of ENDINGS) {
    if (!word.endsWith(end) || word.length - end.length < 2) continue;
    const stem = word.slice(0, word.length - end.length);
    for (const s of stems(stem)) {
      const group = end.startsWith('iss') ? ['ir'] : ['er', 'ir', 're', 'oir'];
      for (const inf of group) if (`${s}${inf}` !== word) add(`${s}${inf}`, 'verb', 'a form of');
    }
  }
  return [...out.values()];
}
