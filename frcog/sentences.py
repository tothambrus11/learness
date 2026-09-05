"""Example sentences for every tense of every verb, from the Tatoeba corpus.

A conjugation table says what the forms are. It does not say what they are
for, and a learner who can recite *que j'aille* still needs to have met *il
faut que j'aille* before the subjonctif means anything. So each tense of each
verb gets a few sentences that people actually wrote, with their English.

Sentences are never written here. Everything comes from a real corpus, because
a made-up example sentence teaches made-up French. Where the corpus has nothing
for a rare form (the passé simple of an uncommon verb is genuinely absent from
ordinary speech), the cell simply stays empty and says so.

Finding a tense in running text is the one place this has to infer anything,
because French spells many tenses alike:

* *paie* is the présent of payer and also a paycheque; *porte* is a door. A
  form that Wiktionary lists for any other word is **shared with a lemma**.
* *mange* is the présent, the subjonctif and the impératif of manger; every
  regular -er verb is like this. A form the verb's own table lists under
  another tense is **shared with a tense**.

A form shared with nothing is proof of its tense wherever it occurs. A shared
form is accepted only in a context that pins it down: a subject pronoun of the
right person directly before it, with *que* before that for the subjonctif,
or first in the sentence for the impératif. Those context rules are the only
inference here, so the build scores them on the forms that need no context and
prints the result. An example found by context is marked as such all the way
to the screen.

Tatoeba data is CC-BY 2.0 FR. Attribution travels with the cards.
"""
from __future__ import annotations

import bz2
import re
import sqlite3
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .config import RAW
from . import conjugation as conj

BASE = "https://downloads.tatoeba.org/exports/per_language"
CORPUS_FILES = {
    "fra_sentences.tsv.bz2": f"{BASE}/fra/fra_sentences.tsv.bz2",
    "eng_sentences.tsv.bz2": f"{BASE}/eng/eng_sentences.tsv.bz2",
    "fra-eng_links.tsv.bz2": f"{BASE}/fra/fra-eng_links.tsv.bz2",
}
ATTRIBUTION = "Example sentences from Tatoeba (CC BY 2.0 FR)"
SOURCE = "tatoeba"

# What makes a sentence a good example rather than merely an occurrence.
MIN_TOKENS = 3
MAX_TOKENS = 14
MAX_CHARS = 120
PER_TENSE = 3        # how many examples a tense carries into the app

_TOKEN = re.compile(r"[a-zà-öø-ÿœæ]+", re.IGNORECASE)


def tokenize(text: str) -> list[str]:
    """French words, lowercased. Elision splits: "l'ordinateur" -> l, ordinateur."""
    return _TOKEN.findall(text.lower())


def missing_files(raw: Path = RAW) -> list[str]:
    return [name for name in CORPUS_FILES if not (raw / name).exists()]


def _read_tsv_bz2(path: Path):
    with bz2.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            yield line.rstrip("\n").split("\t")


def load_pairs(raw: Path = RAW, log=print) -> list[tuple[str, str]]:
    """(French, English) sentence pairs, one English translation per French id."""
    fra: dict[str, str] = {}
    for row in _read_tsv_bz2(raw / "fra_sentences.tsv.bz2"):
        if len(row) >= 3:
            fra[row[0]] = row[2]
    log(f"    {len(fra)} French sentences")

    wanted_eng: dict[str, str] = {}      # eng id -> fra id (first link wins)
    for row in _read_tsv_bz2(raw / "fra-eng_links.tsv.bz2"):
        if len(row) >= 2 and row[0] in fra and row[1] not in wanted_eng:
            wanted_eng[row[1]] = row[0]
    log(f"    {len(wanted_eng)} French-English links")

    pairs: dict[str, str] = {}
    for row in _read_tsv_bz2(raw / "eng_sentences.tsv.bz2"):
        if len(row) >= 3 and row[0] in wanted_eng:
            fid = wanted_eng[row[0]]
            if fid not in pairs:
                pairs[fid] = row[2]
    out = [(fra[fid], en) for fid, en in pairs.items()]
    log(f"    {len(out)} usable sentence pairs")
    return out


@dataclass
class Corpus:
    """Sentences worth showing, indexed by the words they contain."""
    kept: list[tuple[str, str, list[str]]] = field(default_factory=list)   # fr, en, tokens
    index: dict[str, list[int]] = field(default_factory=lambda: defaultdict(list))

    def ids(self, token: str) -> list[int]:
        return self.index.get(token.lower(), [])

    @classmethod
    def build(cls, pairs: list[tuple[str, str]]) -> "Corpus":
        c = cls()
        for fr, en in pairs:
            if len(fr) > MAX_CHARS or not en:
                continue
            toks = tokenize(fr)
            if not (MIN_TOKENS <= len(toks) <= MAX_TOKENS):
                continue
            i = len(c.kept)
            c.kept.append((fr, en, toks))
            for t in set(toks):
                c.index[t].append(i)
        return c


def build_index(pairs: list[tuple[str, str]]) -> tuple[list, dict]:
    """Kept for callers that want the bare lists; see Corpus."""
    c = Corpus.build(pairs)
    return [(fr, en, len(t)) for fr, en, t in c.kept], c.index


# ---------------------------------------------------------------------------
# Reading a tense off running text
#
# The pronouns here are the closed class of French subject clitics, and the
# words allowed between pronoun and verb are the closed class of clitics that
# stand there ("je ne le mange pas"). Both lists are scored below against forms
# that need no context, and the score is printed by every build.

SUBJECT = [
    {"je", "j"}, {"tu"}, {"il", "elle", "on"},
    {"nous"}, {"vous"}, {"ils", "elles"},
]
# "Mange-t-il ?" is a question, not an order. The hyphen is the only sign, and
# tokenising drops it, so the impératif rule looks at the raw sentence too.
_INVERTED = re.compile(r"-(t-)?(je|tu|il|elle|on|nous|vous|ils|elles|ce)\b", re.IGNORECASE)
BETWEEN = {"ne", "n", "me", "m", "te", "t", "se", "s", "le", "la", "l", "les",
           "lui", "leur", "y", "en", "nous", "vous"}
QUE = {"que", "qu"}
IMPER_SLOT_PERSON = [1, 3, 4]      # (tu), (nous), (vous) as persons 0..5


def _subject_before(tokens: list[str], at: int) -> tuple[int | None, int | None]:
    """The person of the subject pronoun before `at`, and where it stands."""
    j = at - 1
    hops = 0
    # "nous"/"vous" are clitics in "il nous regarde" but subjects in "nous
    # mangeons": step over them looking for a subject further left, and if
    # none is there, the leftmost one hopped is the subject.
    plural = None
    while j >= 0 and tokens[j] in BETWEEN and hops < 2:
        if tokens[j] in ("nous", "vous"):
            plural = j
        j -= 1
        hops += 1
    if j >= 0:
        for person, words in enumerate(SUBJECT):
            if tokens[j] in words:
                return person, j
    if plural is not None:
        return (3 if tokens[plural] == "nous" else 4), plural
    return None, None


def rule_for(gid: str) -> str:
    if gid == "imper":
        return "imper"
    if gid in ("subj", "subjimp"):
        return "subj"
    return "pronoun"


def context_ok(gid: str, person: int, tokens: list[str], at: int,
               triggers: set[str] | None = None, raw: str = "") -> bool:
    """Does the context at `at` say this token is tense `gid`, person `person`?

    * impératif: first word, or right after an opening "ne".
    * subjonctif: subject pronoun of the right person, "que" before it, and
      before that one of the words the corpus shows to govern the subjonctif
      (`triggers`, see learn_triggers). With no trigger set, any "que" does.
    * everything else: subject pronoun of the right person, and no "que"
      before it, since "que je mange" is where the subjonctif hides.
    """
    rule = rule_for(gid)
    if rule == "imper":
        first = at == 0 or (at == 1 and tokens[0] in {"ne", "n"})
        return first and not _INVERTED.search(raw)
    found, where = _subject_before(tokens, at)
    if found != person:
        return False
    after_que = where > 0 and tokens[where - 1] in QUE
    if rule == "subj":
        if not after_que:
            return False
        if triggers is None:
            return True
        return where > 1 and tokens[where - 2] in triggers
    return not after_que


@dataclass
class Cell:
    gid: str
    person: int                 # 0..5 as in conjugation.PRONOUNS
    form: str
    shared_tense: list[str]     # other tenses of this verb spelt the same
    shared_lemma: list[str]     # other words spelt the same, "lemma|pos"

    @property
    def sure(self) -> bool:
        return not self.shared_tense and not self.shared_lemma


def cells_of(table: dict, owners: dict[str, set[str]], lemma: str) -> list[Cell]:
    """Every (tense, person, spelling) the table lists, with what it collides with."""
    by_form: dict[str, set[str]] = defaultdict(set)
    for g in table["groups"]:
        for r in g["rows"]:
            for f in conj.cell_forms(r):
                by_form[f].add(g["id"])
    out = []
    mine = f"{lemma}|verb"
    for g in table["groups"]:
        persons = IMPER_SLOT_PERSON if g["id"] == "imper" else range(6)
        for person, r in zip(persons, g["rows"]):
            for f in conj.cell_forms(r):
                out.append(Cell(
                    gid=g["id"], person=person, form=f,
                    shared_tense=sorted(by_form[f] - {g["id"]}),
                    shared_lemma=sorted(owners.get(f, set()) - {mine}),
                ))
    return out


@dataclass
class Example:
    gid: str
    form: str
    fr: str
    en: str
    sure: bool
    length: int
    sid: int


def examples_for(cell: Cell, corpus: Corpus, triggers: set[str] | None = None) -> list[Example]:
    out = []
    for i in corpus.ids(cell.form):
        fr, en, toks = corpus.kept[i]
        if cell.sure:
            ok = True
        else:
            ok = any(context_ok(cell.gid, cell.person, toks, at, triggers, fr)
                     for at, t in enumerate(toks) if t == cell.form)
        if ok:
            out.append(Example(cell.gid, cell.form, fr, en, cell.sure, len(toks), i))
    return out


def compound_examples(table: dict, aux_tables: dict[str, dict], corpus: Corpus) -> list[Example]:
    """Auxiliary directly followed by the participle: "j'ai mangé", "que tu sois venu".

    Only the participle Wiktionary lists is looked for, so "elle est venue"
    goes unfound: the agreeing forms are not in the extract, and this file
    does not spell them itself.
    """
    part = next((x["form"] for x in table["impersonal"] if x["label"] == "Participe passé"), "")
    aux = aux_tables.get(table["aux"])
    if not part or not aux:
        return []
    out = []
    for c in table["compound"]:
        g = next((g for g in aux["groups"] if g["id"] == c["aux_key"]), None)
        if not g:
            continue
        aux_forms = {f for r in g["rows"] for f in conj.cell_forms(r)}
        for i in corpus.ids(part):
            fr, en, toks = corpus.kept[i]
            for at in range(1, len(toks)):
                if toks[at] == part and toks[at - 1] in aux_forms:
                    out.append(Example(c["id"], f"{toks[at - 1]} {part}", fr, en, True,
                                       len(toks), i))
                    break
    return out


def choose(examples: list[Example], used: set[int], limit: int = PER_TENSE) -> list[Example]:
    """Sure before inferred, short before long, and never the same sentence twice."""
    picked: list[Example] = []
    seen_forms: set[str] = set()
    ranked = sorted(examples, key=lambda e: (not e.sure, e.length))
    # First pass prefers a different form in every slot, so three examples of
    # the présent are not three sentences with "je vais".
    for pass_no in (0, 1):
        for e in ranked:
            if len(picked) >= limit:
                break
            if e.sid in used or (pass_no == 0 and e.form in seen_forms):
                continue
            picked.append(e)
            used.add(e.sid)
            seen_forms.add(e.form)
    return picked


# ---------------------------------------------------------------------------
# Learning and scoring the context rules on forms that need none
#
# A form nothing else is spelt like (aille, puissions, irait) is a labelled
# occurrence of its tense. Those occurrences teach which words govern the
# subjonctif, and then measure every rule, on verbs the rule was not learnt on.

SAMPLE = 400            # occurrences per form, so "suis" does not drown the rest
MIN_TRIGGER_N = 4       # how often "X que" must precede a sure subjonctif
MIN_TRIGGER_SHARE = 0.9  # and how rarely a sure indicative


def _occurrences(cells: list[Cell], corpus: Corpus):
    """(cell, sentence, tokens) for every sure form's appearance in the corpus."""
    for cell in cells:
        if not cell.sure:
            continue
        for i in corpus.ids(cell.form)[:SAMPLE]:
            yield cell, corpus.kept[i][0], corpus.kept[i][2]


def learn_triggers(cells: list[Cell], corpus: Corpus) -> set[str]:
    """Words that, before "que + pronoun", predict the subjonctif in the corpus.

    "faut", "pour", "bien", "avant" come out of this; "pense", "dit", "sais"
    do not, because the corpus shows the indicative after them.
    """
    seen: dict[str, list[int]] = defaultdict(lambda: [0, 0])   # word -> [subj, other]
    for cell, _, toks in _occurrences(cells, corpus):
        for at, t in enumerate(toks):
            if t != cell.form:
                continue
            person, where = _subject_before(toks, at)
            if person != cell.person or not where or where < 2:
                continue
            if toks[where - 1] in QUE:
                seen[toks[where - 2]][0 if rule_for(cell.gid) == "subj" else 1] += 1
    return {w for w, (s, o) in seen.items()
            if s >= MIN_TRIGGER_N and s / (s + o) >= MIN_TRIGGER_SHARE}


def score_rules(cells: list[Cell], corpus: Corpus, triggers: set[str]) -> list[str]:
    """How each context rule behaves where the answer is already known.

    Two numbers per rule: how often it accepts an occurrence of a form of its
    own tenses (what it finds), and how often it accepts a form of some other
    tense (what it gets wrong). The second is the one to watch: a rule that
    fires on the wrong tense puts a présent sentence in the subjonctif panel.
    """
    own: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    other: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for cell, raw, toks in _occurrences(cells, corpus):
        for rule in ("pronoun", "subj", "imper"):
            # Ask the rule the question it would be asked: is this token the
            # tense I stand for, in this cell's person?
            probe = {"pronoun": "pres", "subj": "subj", "imper": "imper"}[rule]
            fired = any(context_ok(probe, cell.person, toks, at, triggers, raw)
                        for at, t in enumerate(toks) if t == cell.form)
            box = own if rule_for(cell.gid) == rule else other
            box[rule][1] += 1
            box[rule][0] += fired
    names = {"pronoun": "pronoun + form", "subj": "trigger + que + pronoun + form",
             "imper": "form first"}
    out = []
    for rule in ("pronoun", "subj", "imper"):
        a, n = own[rule]
        b, m = other[rule]
        out.append(f"'{names[rule]}' accepts {a}/{n} occurrences of its own tenses"
                   f" and {b}/{m} of other tenses'")
    return out


# ---------------------------------------------------------------------------
# Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS examples (
    id      INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    tense   TEXT NOT NULL,   -- conjugation group id, or a compound id
    form    TEXT NOT NULL,   -- the token(s) the sentence was found by
    fr      TEXT NOT NULL,
    en      TEXT NOT NULL,
    sure    INTEGER NOT NULL DEFAULT 1,  -- 0: found by context, the form is shared
    source  TEXT NOT NULL,
    n       INTEGER DEFAULT 0            -- order within the tense
);
CREATE INDEX IF NOT EXISTS idx_ex_word ON examples(word_id, tense, n);
"""


def attach(con: sqlite3.Connection, owners: dict[str, set[str]], corpus: Corpus | None = None,
           raw: Path = RAW, log=print) -> int:
    """Fill the examples table for every active verb. Returns the number stored."""
    con.executescript(SCHEMA)
    if corpus is None:
        corpus = Corpus.build(load_pairs(raw, log=log))
    verbs = con.execute(
        "SELECT id, lemma, conjugation FROM words WHERE active=1 AND conjugation IS NOT NULL"
    ).fetchall()
    tables = {r["lemma"]: json.loads(r["conjugation"]) for r in verbs}
    aux_tables = {k: tables[k] for k in ("avoir", "être") if k in tables}
    for aux in ("avoir", "être"):
        if aux not in aux_tables:
            log(f"  {aux} is not in the catalogue, so compound tenses get no examples")
    # The compound panel's "j'ai lavé" is composed from a typed-in list of the
    # auxiliaries' first-person forms. Check that list against the tables
    # Wiktionary gives for avoir and être, so a slip there cannot go unnoticed.
    agree = wrong = 0
    for aux, table in aux_tables.items():
        for gid, typed in conj.AUX_FIRST_SINGULAR[aux].items():
            g = next((g for g in table["groups"] if g["id"] == gid), None)
            if g and g["rows"][0] and g["rows"][0]["f"] == typed:
                agree += 1
            else:
                wrong += 1
                log(f"  sentences:      AUX_FIRST_SINGULAR[{aux}][{gid}] = {typed!r} DISAGREES with Wiktionary")
    log(f"  sentences:      auxiliary forms agree with Wiktionary {agree}/{agree + wrong}")
    cells_by_verb = {r["id"]: cells_of(tables[r["lemma"]], owners, r["lemma"]) for r in verbs}

    # Learn the subjonctif triggers on half the verbs and score every rule on
    # the other half, so the printed numbers are not the rules marking their
    # own homework. Then learn on everything for the real run.
    fold = [cells for wid, cells in cells_by_verb.items() if wid % 2]
    rest = [cells for wid, cells in cells_by_verb.items() if not wid % 2]
    held = learn_triggers([c for cs in fold for c in cs], corpus)
    for line in score_rules([c for cs in rest for c in cs], corpus, held):
        log(f"  sentences:      {line}")
    triggers = learn_triggers([c for cs in cells_by_verb.values() for c in cs], corpus)
    log(f"  sentences:      {len(triggers)} words govern the subjonctif in the corpus: "
        + ", ".join(sorted(triggers)[:12]) + (" …" if len(triggers) > 12 else ""))

    stored = 0
    empty: dict[str, int] = defaultdict(int)
    inferred = 0
    with con:
        con.execute("DELETE FROM examples WHERE source=?", (SOURCE,))
        for r in verbs:
            table = tables[r["lemma"]]
            used: set[int] = set()
            by_tense: dict[str, list[Example]] = defaultdict(list)
            for cell in cells_by_verb[r["id"]]:
                by_tense[cell.gid].extend(examples_for(cell, corpus, triggers))
            for e in compound_examples(table, aux_tables, corpus):
                by_tense[e.gid].append(e)
            order = [g["id"] for g in table["groups"]] + [c["id"] for c in table["compound"]]
            for gid in order:
                picked = choose(by_tense.get(gid, []), used)
                if not picked:
                    empty[gid] += 1
                for n, e in enumerate(picked):
                    con.execute(
                        "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (r["id"], gid, e.form, e.fr, e.en, int(e.sure), SOURCE, n))
                    stored += 1
                    inferred += not e.sure
    log(f"  sentences:      {stored} examples for {len(verbs)} verbs, "
        f"{inferred} of them found by context")
    if empty:
        log("  sentences:      tenses with no example: "
            + ", ".join(f"{k} {v}" for k, v in sorted(empty.items(), key=lambda kv: -kv[1])))
    return stored


def for_word(con: sqlite3.Connection, word_id: int) -> dict[str, list[dict]]:
    """Examples grouped by tense id, in stored order, shaped for the app."""
    out: dict[str, list[dict]] = defaultdict(list)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='examples'").fetchone():
        return {}
    for r in con.execute(
            "SELECT tense, form, fr, en, sure FROM examples WHERE word_id=? AND source=? "
            "ORDER BY tense, n", (word_id, SOURCE)):
        ex = {"fr": r["fr"], "en": r["en"], "f": r["form"]}
        if not r["sure"]:
            ex["ctx"] = True
        out[r["tense"]].append(ex)
    return dict(out)


# ---------------------------------------------------------------------------
# A sentence or two for every word, verb or not
#
# The verb pass above wants a sentence per tense and has to read the tense off
# the context. An ordinary word wants only to be met in running text, which is
# what the cloze rung is for: the word blanked out of a sentence it actually
# appears in. That needs no context rule at all, just the word.

SOURCE_WORD = "tatoeba-word"
PER_WORD = 2
WORD_TENSE = "word"          # the `tense` column, for rows that are not a tense


def word_tokens(lemma: str) -> list[str]:
    """The tokens a word's lemma is made of: "se laver" is two, and the
    sentence must contain both; "être" is one."""
    return tokenize(lemma)


def examples_for_word(lemma: str, pos: str, corpus: Corpus) -> list[Example]:
    """Sentences containing the word as spelt, or a noun's plain plural.

    Inflections beyond that are not guessed: a verb's forms come from the
    verb pass, and a spelling the corpus index does not hold is a spelling
    nobody typed. The blank is the token the sentence was found by.
    """
    toks = word_tokens(lemma)
    if not toks:
        return []
    head, rest = toks[0], toks[1:]
    spellings = [head]
    if pos == "noun" and not head.endswith(("s", "x", "z")):
        spellings.append(head + "x" if head.endswith(("eau", "eu", "au")) else head + "s")
    out = []
    for spelt in spellings:
        for i in corpus.ids(spelt):
            fr, en, sent_toks = corpus.kept[i]
            if rest and not all(t in sent_toks for t in rest):
                continue
            out.append(Example(WORD_TENSE, spelt, fr, en, True, len(sent_toks), i))
    return out


def attach_words(con: sqlite3.Connection, corpus: Corpus | None = None,
                 raw: Path = RAW, log=print) -> int:
    """Up to two sentences for every active word. Returns the number stored."""
    con.executescript(SCHEMA)
    if corpus is None:
        corpus = Corpus.build(load_pairs(raw, log=log))
    words = con.execute("SELECT id, lemma, pos FROM words WHERE active=1").fetchall()
    stored = 0
    covered = 0
    with con:
        con.execute("DELETE FROM examples WHERE source=?", (SOURCE_WORD,))
        for r in words:
            picked = choose(examples_for_word(r["lemma"], r["pos"], corpus), set(), PER_WORD)
            if picked:
                covered += 1
            for n, e in enumerate(picked):
                con.execute(
                    "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (r["id"], WORD_TENSE, e.form, e.fr, e.en, 1, SOURCE_WORD, n))
                stored += 1
    log(f"  sentences:      {stored} sentences for {covered} of {len(words)} words "
        f"(the cloze rung opens for those)")
    return stored


def sentences_for_word(con: sqlite3.Connection, word_id: int) -> list[dict]:
    """The word's own sentences, for the cloze rung: text, translation, and
    the token to blank."""
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='examples'").fetchone():
        return []
    return [{"fr": r["fr"], "en": r["en"], "f": r["form"]} for r in con.execute(
        "SELECT form, fr, en FROM examples WHERE word_id=? AND source=? ORDER BY n",
        (word_id, SOURCE_WORD))]
