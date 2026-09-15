"""The words the deck leaves out on purpose, and how they are taught anyway.

Function words — *sur*, *dans*, *pour*, *depuis* — are excluded from the
ranking (see stoplist.py) because Wiktionary's lemma entry for one is usually
a rare homograph noun: mined, *sur* would be "sour". Together they are about a
sixth of running French text, and nothing in the catalogue taught them. This
module is the inventory that does: written by hand, because that is the only
way a preposition's sense line does not come out as "sour", and small, because
forty words are all there are.

What is authored is only what a corpus cannot say: the core sense in one line
of English, the senses in order, which words it is confused with, and how
soon it is worth meeting. The sentences it is met in are still never written
here — they come from the same Tatoeba corpus as everything else, found by
`find` with a context rule that keeps *entre* the verb ("personne n'entre")
and *sous-* the prefix ("les sous-titres") out of the pool.

Every word in a contrast set is itself in the inventory. That is what makes a
forced-choice card fair: each option is a card of its own, reviewed on its own
schedule, so across a week the right answer is spread evenly over the set
rather than following the corpus, where "always tap *pour*" is right nine
times in ten.
"""
from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass

from .sentences import Corpus, tokenize


@dataclass(frozen=True)
class FunctionWord:
    """One entry of the inventory.

    `en` is the senses in the order they are worth meeting; the first is the
    one `sense` describes. `contrast` names the words this one is chosen
    against on a forced-choice card, all of them inventory words. `avoid` is
    the bigrams in which the spelling is not this word ("d'entre" is a
    partitive, "entre autres" an idiom), matched against the raw sentence.
    """
    word: str
    pos: str
    en: tuple[str, ...]
    sense: str
    ipa: str
    stage: int
    contrast: tuple[str, ...] = ()
    avoid: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.word}|{self.pos}"

    @property
    def tokens(self) -> list[str]:
        return tokenize(self.word)


# Stage 1 is the spatial core: the words with one picture behind them, which
# is where teaching a sense as a picture has its evidence. Stage 2 is the
# commonest abstract ones, each with a short closed list of senses. Stages are
# where the word joins the ranked queue, not levels of difficulty.
INVENTORY: tuple[FunctionWord, ...] = (
    FunctionWord("dans", "prep", ("in", "inside", "into", "within"),
                 "inside a space with edges: a room, a box, a town, a period of time",
                 "/dɑ̃/", 1, ("sur", "sous")),
    FunctionWord("sur", "prep", ("on", "onto", "about", "out of"),
                 "on a surface, resting against it from above",
                 "/syʁ/", 1, ("sous", "dans")),
    FunctionWord("sous", "prep", ("under", "underneath", "beneath"),
                 "beneath something, covered by it",
                 "/su/", 1, ("sur", "dans")),
    FunctionWord("entre", "prep", ("between", "among"),
                 "in the space that two things leave between them",
                 "/ɑ̃tʁ/", 1, ("parmi", "devant"), ("d'entre", "entre autres")),
    FunctionWord("chez", "prep", ("at someone's place", "at the shop of", "among"),
                 "at the home or workplace of a person — the person, not the building",
                 "/ʃe/", 1, ("vers", "dans")),
    FunctionWord("devant", "prep", ("in front of", "before", "ahead of"),
                 "in front of something, facing it",
                 "/də.vɑ̃/", 1, ("derrière", "entre")),
    FunctionWord("derrière", "prep", ("behind",),
                 "behind something, on the far side of it",
                 "/dɛ.ʁjɛʁ/", 1, ("devant", "sous")),
    FunctionWord("vers", "prep", ("towards", "around", "about"),
                 "heading in the direction of a place, or a time near a point",
                 "/vɛʁ/", 1, ("contre", "chez")),
    FunctionWord("contre", "prep", ("against",),
                 "pressed against something, or set against it",
                 "/kɔ̃tʁ/", 1, ("vers", "avec")),
    FunctionWord("près de", "prep", ("near", "close to", "nearly"),
                 "a short distance from something",
                 "/pʁɛ də/", 1, ("loin de", "autour de")),
    FunctionWord("loin de", "prep", ("far from",),
                 "a long way from something",
                 "/lwɛ̃ də/", 1, ("près de", "autour de")),
    FunctionWord("autour de", "prep", ("around", "about"),
                 "on every side of something, circling it",
                 "/o.tuʁ də/", 1, ("près de", "contre")),
    FunctionWord("parmi", "prep", ("among", "amongst"),
                 "one of a group, somewhere inside it",
                 "/paʁ.mi/", 2, ("entre", "dans")),
    FunctionWord("pour", "prep", ("for", "in order to", "to"),
                 "for the benefit of someone, or with an aim in view",
                 "/puʁ/", 2, ("par", "avec"), ("le pour et le contre",)),
    FunctionWord("par", "prep", ("by", "through", "per"),
                 "by way of: the route, the means, or the doer of a passive",
                 "/paʁ/", 2, ("pour", "avec"), ("un par un", "par exemple", "par hasard", "par cœur")),
    FunctionWord("avec", "prep", ("with",),
                 "together with someone, or using something",
                 "/a.vɛk/", 2, ("sans", "par")),
    FunctionWord("sans", "prep", ("without",),
                 "lacking something, or not doing it",
                 "/sɑ̃/", 2, ("avec", "pour")),
    FunctionWord("depuis", "prep", ("since", "for"),
                 "from a point in the past up to now, and still going",
                 "/də.pɥi/", 2, ("pendant", "pour")),
    FunctionWord("pendant", "prep", ("during", "for"),
                 "throughout a stretch of time that is over",
                 "/pɑ̃.dɑ̃/", 2, ("depuis", "pour")),
    FunctionWord("avant", "prep", ("before",),
                 "earlier than a moment, or ahead of a place",
                 "/a.vɑ̃/", 2, ("après", "depuis")),
    FunctionWord("après", "prep", ("after",),
                 "later than a moment, or beyond a place",
                 "/a.pʁɛ/", 2, ("avant", "pendant")),
)

BY_WORD = {w.word: w for w in INVENTORY}


def check_inventory(inventory: tuple[FunctionWord, ...] = INVENTORY) -> list[str]:
    """What is wrong with the inventory, in words; empty when nothing is.

    A contrast partner that is not itself an entry would be a button with no
    card behind it, and that is exactly the case that lets the corpus prior
    win. Checked here and by the tests rather than trusted.
    """
    words = {w.word for w in inventory}
    out = []
    for w in inventory:
        for c in w.contrast:
            if c not in words:
                out.append(f"{w.word}: contrast partner {c!r} is not in the inventory")
        if w.word in w.contrast:
            out.append(f"{w.word}: is its own contrast partner")
        if not w.contrast:
            out.append(f"{w.word}: has no contrast set")
    return out


# ---------------------------------------------------------------------------
# Finding the word in running text

# A preposition is never directly preceded by a subject pronoun, "ne", or
# "que": where it seems to be, the spelling is a verb ("personne n'entre",
# "qu'elle entre") or a partitive. And it is never followed by one.
NOT_BEFORE = {"je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
              "ne", "n", "que", "qu", "qui", "se", "s", "me", "m", "te", "t"}
NOT_AFTER = {"je", "j", "tu", "il", "elle", "on", "ils", "elles", "ne", "n"}

MIN_TOKENS = 4          # "Viens avec." is a sentence, not an example
MAX_TOKENS = 12         # a gap in a long sentence is a reading test
PER_WORD = 8            # sentences a word carries into the app
MIN_SENTENCES = 3       # fewer, and the word is not exported: no pool, no card


@dataclass
class Hit:
    fw: FunctionWord
    fr: str
    en: str
    form: str          # the word as it stands in the sentence
    after: str         # the token following it, for spreading the pool
    length: int
    glossed: bool      # the English carries one of the word's senses
    sid: int


def _hyphenated(word: str, fr: str) -> bool:
    """The spelling occurs joined to something by a hyphen: "sous-titres",
    "Peut-être". Then the sentence is not about the word at all."""
    head = re.escape(word.split()[0])
    joined = rf"-{head}(?![^\W\d_])|(?<![^\W\d_]){head}-"
    return re.search(joined, fr, re.IGNORECASE) is not None


def _glossed(fw: FunctionWord, en: str) -> bool:
    low = en.lower()
    return any(re.search(rf"\b{re.escape(g)}\b", low) for g in fw.en)


def find(fw: FunctionWord, corpus: Corpus) -> list[Hit]:
    """Every sentence in which the word stands as itself.

    The rule is context on both sides of the spelling and nothing about
    French beyond that: no subject pronoun, negation or "que" just before it,
    none just after, no hyphen joined to it, none of its `avoid` bigrams, and
    a token after it to be the thing it governs. A two-word entry ("près de")
    is matched as the two tokens in a row, and only with "de" itself, so the
    gap on the card is the entry and not a contraction of it.
    """
    toks = fw.tokens
    if not toks:
        return []
    out: list[Hit] = []
    for i in corpus.ids(toks[0]):
        fr, en, sent = corpus.kept[i]
        if not (MIN_TOKENS <= len(sent) <= MAX_TOKENS):
            continue
        low = fr.lower()
        if any(a in low for a in fw.avoid) or _hyphenated(fw.word, fr):
            continue
        for at, t in enumerate(sent):
            if t != toks[0] or sent[at:at + len(toks)] != toks:
                continue
            after = at + len(toks)
            if after >= len(sent) or sent[after] in NOT_AFTER:
                continue
            if at > 0 and sent[at - 1] in NOT_BEFORE:
                continue
            out.append(Hit(fw, fr, en, fw.word, sent[after], len(sent), _glossed(fw, en), i))
            break
    return out


def choose(hits: list[Hit], limit: int = PER_WORD) -> list[Hit]:
    """Glossed before not, short before long, and a different word after the
    preposition in every slot while that is possible — eight sentences of
    "sur la table" would teach the table."""
    ranked = sorted(hits, key=lambda h: (not h.glossed, h.length))
    picked: list[Hit] = []
    seen_after: set[str] = set()
    seen_fr: set[str] = set()
    for pass_no in (0, 1):
        for h in ranked:
            if len(picked) >= limit:
                break
            if h.fr in seen_fr or (pass_no == 0 and h.after in seen_after):
                continue
            picked.append(h)
            seen_after.add(h.after)
            seen_fr.add(h.fr)
    return picked


# ---------------------------------------------------------------------------
# Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS function_examples (
    id      INTEGER PRIMARY KEY,
    word    TEXT NOT NULL,
    pos     TEXT NOT NULL,
    form    TEXT NOT NULL,
    fr      TEXT NOT NULL,
    en      TEXT NOT NULL,
    n       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fex_word ON function_examples(word, pos, n);
"""


def corpus_from_db(con: sqlite3.Connection) -> Corpus:
    """The sentences already in the database, as a corpus to mine.

    The verb pass keeps a few sentences per tense and per word, and those are
    a real corpus in miniature. It is what `frcog app` falls back to when the
    Tatoeba dump was never fetched, so the export always carries sentences —
    fewer than the full corpus gives, and the build says so.
    """
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='examples'").fetchone():
        return Corpus.build([])
    rows = con.execute("SELECT DISTINCT fr, en FROM examples").fetchall()
    return Corpus.build([(r[0], r[1]) for r in rows])


def attach(con: sqlite3.Connection, corpus: Corpus, log=print) -> int:
    """Fill function_examples from the corpus. Returns the number stored."""
    problems = check_inventory()
    for p in problems:
        log(f"  function:       inventory: {p}")
    con.executescript(SCHEMA)
    stored = 0
    thin: list[str] = []
    with con:
        con.execute("DELETE FROM function_examples")
        for fw in INVENTORY:
            picked = choose(find(fw, corpus))
            if len(picked) < MIN_SENTENCES:
                thin.append(f"{fw.word} {len(picked)}")
            for n, h in enumerate(picked):
                con.execute(
                    "INSERT INTO function_examples (word,pos,form,fr,en,n) VALUES (?,?,?,?,?,?)",
                    (fw.word, fw.pos, h.form, h.fr, h.en, n))
                stored += 1
    log(f"  function:       {stored} sentences for {len(INVENTORY)} function words")
    if thin:
        log(f"  function:       too few to export: {', '.join(thin)}")
    return stored


def examples_of(con: sqlite3.Connection, fw: FunctionWord) -> list[dict]:
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='function_examples'").fetchone():
        return []
    return [{"fr": r[0], "en": r[1], "f": r[2]} for r in con.execute(
        "SELECT fr, en, form FROM function_examples WHERE word=? AND pos=? ORDER BY n",
        (fw.word, fw.pos))]


def entries(con: sqlite3.Connection) -> list[dict]:
    """The inventory as the app reads it, sentences attached, in stage order.

    A word with too few sentences is left out rather than shipped as a card
    with nothing to ask — the same rule as a word with no English. Its
    partners still list it in `contrast`, and the app shows a partner as a
    button whether or not it is a card, so the set stays whole.
    """
    out = []
    for fw in sorted(INVENTORY, key=lambda w: (w.stage, w.word)):
        ex = examples_of(con, fw)
        if len(ex) < MIN_SENTENCES:
            continue
        out.append({
            "k": fw.key,
            "fr": fw.word,
            "en": list(fw.en),
            "answer": fw.word,
            "lemma": fw.word,
            "pos": fw.pos,
            "lvl": 0,
            "ipa": fw.ipa,
            "kind": "function",
            "sense": fw.sense,
            "stage": fw.stage,
            "contrast": [BY_WORD[c].key for c in fw.contrast],
            "cue": fw.en[0],
            "audio": None,
            "native": None,
            "cue_audio": None,
            "ex": ex,
        })
    return out


def index_entry(word: dict) -> dict:
    """The index row for an exported entry: no similarity score at all, since
    "how much *sur* looks like *on*" is not a question, and the app decides
    the entry rung from the kind instead. Mass is zero so the coverage
    number, which counts inflections of catalogue words, is not moved by a
    word that never had a row in the ranking."""
    return {"k": word["k"], "fr": word["fr"], "en": word["en"], "lvl": 0, "m": 0,
            "kind": "function"}


# Where each stage joins the ranked queue: after this many catalogue words.
# Stage 1 waits for the first fifty, so the very first sittings are cognates
# and the spatial prepositions arrive once there are nouns to put them before.
STAGE_AT = {1: 50, 2: 100}


def interleave(index: list[dict], words: list[dict]) -> list[dict]:
    """The index with the function words placed by stage, later stages later.
    A stage past the end of a short index goes at the end."""
    by_stage: dict[int, list[dict]] = defaultdict(list)
    for w in words:
        by_stage[w["stage"]].append(index_entry(w))
    out = list(index)
    # Positions are in the ranked index as it was; inserting the latest stage
    # first keeps every earlier position valid, and two stages that both fall
    # off the end of a short index still come out in stage order.
    for stage in sorted(by_stage, reverse=True):
        at = min(STAGE_AT.get(stage, len(index)), len(index))
        out[at:at] = by_stage[stage]
    return out
