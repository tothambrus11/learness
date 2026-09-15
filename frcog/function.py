"""The words the deck leaves out on purpose, and how they are taught anyway.

Function words — *sur*, *dans*, *pour*, *depuis* — are excluded from the
ranking (see stoplist.py) because Wiktionary's lemma entry for one is usually
a rare homograph noun: mined, *sur* would be "sour". Together they are about a
sixth of running French text, and nothing in the catalogue taught them. This
module is the inventory that does: written by hand, because that is the only
way a preposition's sense line does not come out as "sour", and small, because
fifty words are all there are: the prepositions, the negation, the
connectives, the adverbs of degree — and, at the end of this file, the
prepositions a verb governs, which are not words of their own at all but
belong to the verb they follow.

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
    #: A connective: what follows is a clause, so a subject pronoun after it
    #: is the rule rather than the sign of a homograph ("mais je", "si tu").
    clause: bool = False
    #: The second half of a negation: it stands within three tokens after
    #: "ne", and nothing need follow it — "Je ne sais pas." ends there. Without
    #: the "ne", "plus" is "more" and "pas" is a step.
    after_ne: bool = False
    #: A spelling that is the word only in some of its uses — "si" is "if",
    #: "so" and "yes" — is kept only where the English carries one of its
    #: senses, rather than ranked by it.
    only_glossed: bool = False

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
    FunctionWord("selon", "prep", ("according to", "depending on"),
                 "as someone says it is, or as something turns out",
                 "/sə.lɔ̃/", 2, ("par", "pour")),
    FunctionWord("malgré", "prep", ("despite", "in spite of"),
                 "although something stood in the way",
                 "/mal.ɡʁe/", 2, ("sans", "avec")),
    FunctionWord("sauf", "prep", ("except", "apart from"),
                 "everything but this one",
                 "/sof/", 2, ("avec", "sans")),
    # Stage 2 also: the negation. "ne … pas" wraps the verb, and the second
    # half is the one that carries the meaning — the first is dropped in
    # speech. Each is chosen against the others, because that is where the
    # confusion is: not, no longer, never.
    FunctionWord("pas", "adv", ("not", "no"),
                 "the second half of ne … pas, which wraps the verb to say no; in speech the ne is often dropped",
                 "/pa/", 2, ("plus", "jamais"), after_ne=True),
    FunctionWord("plus", "adv", ("no longer", "anymore", "no more", "any more"),
                 "the second half of ne … plus: something that was, and has stopped",
                 "/ply/", 2, ("pas", "jamais"), after_ne=True, only_glossed=True),
    FunctionWord("jamais", "adv", ("never", "ever"),
                 "the second half of ne … jamais: at no time at all",
                 "/ʒa.mɛ/", 2, ("pas", "plus"), after_ne=True),
    # Stage 3 is the connectives: what joins one clause to the next. Chosen
    # against each other by what the English says the join is — but, or, so,
    # because, if, when — never two that translate the same way.
    FunctionWord("mais", "conj", ("but", "yet"),
                 "the clause that follows goes against the one before",
                 "/mɛ/", 3, ("ou", "donc"), clause=True),
    FunctionWord("ou", "conj", ("or", "either"),
                 "one or the other",
                 "/u/", 3, ("mais", "ni"), clause=True, only_glossed=True),
    FunctionWord("ni", "conj", ("nor", "neither"),
                 "not this one either: ni … ni is neither … nor",
                 "/ni/", 3, ("ou", "sans"), clause=True),
    FunctionWord("donc", "conj", ("so", "therefore", "then"),
                 "what follows is the consequence of what came before",
                 "/dɔ̃k/", 3, ("mais", "car"), clause=True),
    FunctionWord("car", "conj", ("for", "because"),
                 "the reason for what was just said, added after it; written more than spoken",
                 "/kaʁ/", 3, ("donc", "mais"), clause=True, only_glossed=True),
    FunctionWord("parce que", "conj", ("because",),
                 "the reason, answering why",
                 "/paʁs kə/", 3, ("mais", "quand"), clause=True),
    FunctionWord("puisque", "conj", ("since", "as", "given that"),
                 "a reason both people already know",
                 "/pɥisk/", 3, ("si", "mais"), clause=True),
    FunctionWord("quand", "conj", ("when", "whenever"),
                 "at the time that something happens",
                 "/kɑ̃/", 3, ("si", "mais"), clause=True),
    FunctionWord("lorsque", "conj", ("when",),
                 "at the time that — the written cousin of quand",
                 "/lɔʁsk/", 3, ("si", "mais"), clause=True),
    FunctionWord("si", "conj", ("if", "whether"),
                 "on the condition that; what follows may or may not happen",
                 "/si/", 3, ("quand", "mais"), clause=True, only_glossed=True),
    FunctionWord("comme", "conj", ("like", "as", "since"),
                 "in the same way as, or in the role of",
                 "/kɔm/", 3, ("si", "quand"), clause=True, only_glossed=True),
    FunctionWord("alors", "adv", ("then", "so", "at that time"),
                 "and then, or in that case",
                 "/a.lɔʁ/", 3, ("mais", "quand"), clause=True),
    FunctionWord("pourtant", "adv", ("yet", "however", "and yet"),
                 "even so: what follows is a surprise after what came before",
                 "/puʁ.tɑ̃/", 3, ("mais", "donc"), clause=True),
    FunctionWord("bien que", "conj", ("although", "even though"),
                 "even though; the verb after it is in the subjonctif",
                 "/bjɛ̃ kə/", 3, ("si", "mais"), clause=True),
    FunctionWord("tandis que", "conj", ("whereas", "while"),
                 "at the same time as, and usually in contrast with",
                 "/tɑ̃.di kə/", 3, ("si", "mais"), clause=True),
    # Stage 4 is the adverbs of degree and time that have no content of their
    # own: how much, and whether still.
    FunctionWord("très", "adv", ("very",),
                 "to a high degree; before an adjective or an adverb",
                 "/tʁɛ/", 4, ("trop", "assez")),
    FunctionWord("trop", "adv", ("too", "too much", "too many"),
                 "more than is right",
                 "/tʁo/", 4, ("très", "assez")),
    FunctionWord("assez", "adv", ("enough", "quite", "fairly"),
                 "as much as is needed, or fairly",
                 "/a.se/", 4, ("très", "trop")),
    FunctionWord("encore", "adv", ("still", "again", "more", "yet"),
                 "going on, or one more time",
                 "/ɑ̃.kɔʁ/", 4, ("déjà", "jamais"), only_glossed=True),
    FunctionWord("déjà", "adv", ("already",),
                 "sooner than expected, or before now",
                 "/de.ʒa/", 4, ("encore", "jamais")),
    FunctionWord("toujours", "adv", ("always", "still", "forever"),
                 "at every time, or going on as before",
                 "/tu.ʒuʁ/", 4, ("jamais", "déjà"), only_glossed=True),
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
    """Does the English carry one of the word's senses? "not" counts as
    carried by "don't", "isn't", "can't": that is how English says it."""
    low = en.lower()
    if "not" in fw.en and "n't" in low:
        return True
    return any(re.search(rf"\b{re.escape(g)}\b", low) for g in fw.en)


NE = {"ne", "n"}


def _after_ne(sent: list[str], at: int) -> bool:
    """Does "ne" stand within three tokens before `at`? "Je ne sais pas", "Il
    n'y a jamais eu", "Nous ne le voulons plus"."""
    return any(t in NE for t in sent[max(0, at - 3):at])


def find(fw: FunctionWord, corpus: Corpus) -> list[Hit]:
    """Every sentence in which the word stands as itself.

    The rule is context on both sides of the spelling and nothing about
    French beyond that: no subject pronoun, negation or "que" just before it,
    none just after, no hyphen joined to it, none of its `avoid` bigrams, and
    a token after it to be the thing it governs. A two-word entry ("près de")
    is matched as the two tokens in a row, and only with "de" itself, so the
    gap on the card is the entry and not a contraction of it.

    Two kinds of word bend the rule, and say so on their entry. A connective
    (`clause`) is followed by a clause, so a subject pronoun after it is
    expected rather than refused. The second half of a negation (`after_ne`)
    has to stand within three tokens after "ne", and nothing need follow it:
    "Je ne sais pas." is the commonest sentence it is in. And a spelling that
    is the word only sometimes (`only_glossed`) is kept only where the
    English says which.
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
        glossed = _glossed(fw, en)
        if fw.only_glossed and not glossed:
            continue
        for at, t in enumerate(sent):
            if t != toks[0] or sent[at:at + len(toks)] != toks:
                continue
            after = at + len(toks)
            if fw.after_ne:
                if not _after_ne(sent, at):
                    continue
            elif after >= len(sent) or (not fw.clause and sent[after] in NOT_AFTER):
                continue
            if at > 0 and sent[at - 1] in NOT_BEFORE and not (fw.after_ne and sent[at - 1] in NE):
                continue
            following = sent[after] if after < len(sent) else ""
            out.append(Hit(fw, fr, en, fw.word, following, len(sent), glossed, i))
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
# and the spatial prepositions arrive once there are nouns to put them before;
# the negation and the abstract prepositions after a hundred, the connectives
# after a hundred and fifty, the adverbs of degree after two hundred.
STAGE_AT = {1: 50, 2: 100, 3: 150, 4: 200}


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


# ---------------------------------------------------------------------------
# What a verb governs

@dataclass(frozen=True)
class Chunk:
    """A verb with the preposition it takes, as one thing to learn.

    *à* and *de* are the two commonest prepositions in French and the two
    that mean nothing on their own: in "penser à", "dépendre de", "jouer du
    piano" the verb decides, and no picture of *à* will say which. So they
    are not taught as words. They ride on the verb instead, shown with it on
    the back of every one of its cards — the chunk, not the rule — and the
    list is written by hand, because mined adjacency is noise: "jouer"
    followed by au, avec, du, sur, aux and de in one corpus.
    """
    lemma: str        # the verb as the catalogue keys it: "souvenir" for "se souvenir"
    fr: str           # the chunk as it is said
    en: str


CHUNKS: tuple[Chunk, ...] = (
    Chunk("penser", "penser à qch", "to think about something"),
    Chunk("penser", "penser de qch", "to think of something (have an opinion)"),
    Chunk("parler", "parler de qch", "to talk about something"),
    Chunk("parler", "parler à qn", "to talk to someone"),
    Chunk("jouer", "jouer à un jeu", "to play a game or sport"),
    Chunk("jouer", "jouer d'un instrument", "to play an instrument"),
    Chunk("dépendre", "dépendre de", "to depend on"),
    Chunk("souvenir", "se souvenir de", "to remember"),
    Chunk("arriver", "arriver à faire", "to manage to do"),
    Chunk("commencer", "commencer à faire", "to start doing"),
    Chunk("continuer", "continuer à faire", "to keep doing"),
    Chunk("finir", "finir de faire", "to finish doing"),
    Chunk("essayer", "essayer de faire", "to try to do"),
    Chunk("décider", "décider de faire", "to decide to do"),
    Chunk("oublier", "oublier de faire", "to forget to do"),
    Chunk("permettre", "permettre à qn de faire", "to let someone do"),
    Chunk("demander", "demander à qn de faire", "to ask someone to do"),
    Chunk("dire", "dire à qn de faire", "to tell someone to do"),
    Chunk("aider", "aider qn à faire", "to help someone do"),
    Chunk("apprendre", "apprendre à faire", "to learn to do"),
    Chunk("occuper", "s'occuper de", "to take care of, to deal with"),
    Chunk("servir", "se servir de", "to use"),
    Chunk("servir", "servir à faire", "to be for doing, to be of use"),
    Chunk("intéresser", "s'intéresser à", "to be interested in"),
    Chunk("ressembler", "ressembler à", "to look like"),
    Chunk("répondre", "répondre à", "to answer"),
    Chunk("obéir", "obéir à", "to obey"),
    Chunk("plaire", "plaire à qn", "to please someone, to be liked by"),
    Chunk("manquer", "manquer de", "to lack"),
    Chunk("manquer", "manquer à qn", "to be missed by someone"),
    Chunk("tenir", "tenir à", "to care about, to insist on"),
    Chunk("croire", "croire en", "to believe in"),
    Chunk("entrer", "entrer dans", "to go into"),
    Chunk("sortir", "sortir de", "to go out of"),
    Chunk("venir", "venir de faire", "to have just done"),
    Chunk("changer", "changer de", "to change (one for another)"),
    Chunk("cesser", "cesser de faire", "to stop doing"),
    Chunk("arrêter", "arrêter de faire", "to stop doing"),
    Chunk("refuser", "refuser de faire", "to refuse to do"),
    Chunk("accepter", "accepter de faire", "to agree to do"),
    Chunk("choisir", "choisir de faire", "to choose to do"),
    Chunk("promettre", "promettre de faire", "to promise to do"),
    Chunk("proposer", "proposer de faire", "to suggest doing"),
    Chunk("risquer", "risquer de faire", "to be likely to, to risk"),
    Chunk("hésiter", "hésiter à faire", "to hesitate to do"),
    Chunk("chercher", "chercher à faire", "to try to do"),
    Chunk("renoncer", "renoncer à", "to give up"),
    Chunk("participer", "participer à", "to take part in"),
    Chunk("assister", "assister à", "to attend"),
    Chunk("avoir", "avoir besoin de", "to need"),
    Chunk("avoir", "avoir peur de", "to be afraid of"),
    Chunk("avoir", "avoir envie de", "to feel like, to want"),
    Chunk("faire", "faire attention à", "to pay attention to, to watch out for"),
    Chunk("douter", "douter de", "to doubt"),
    Chunk("compter", "compter sur", "to count on"),
    Chunk("inviter", "inviter qn à faire", "to invite someone to do"),
    Chunk("forcer", "forcer qn à faire", "to force someone to do"),
    Chunk("obliger", "obliger qn à faire", "to oblige someone to do"),
    Chunk("mettre", "se mettre à faire", "to start doing"),
    Chunk("rendre", "se rendre à", "to go to"),
    Chunk("attendre", "s'attendre à", "to expect"),
    Chunk("inquiéter", "s'inquiéter de", "to worry about"),
    Chunk("excuser", "s'excuser de", "to apologise for"),
    Chunk("tromper", "se tromper de", "to get the wrong one"),
    Chunk("marier", "se marier avec", "to marry"),
    Chunk("réfléchir", "réfléchir à", "to think something over"),
    Chunk("résister", "résister à", "to resist"),
    Chunk("survivre", "survivre à", "to survive"),
    Chunk("mourir", "mourir de", "to die of"),
    Chunk("vivre", "vivre de", "to live on"),
    Chunk("couvrir", "couvrir de", "to cover with"),
    Chunk("accuser", "accuser qn de", "to accuse someone of"),
    Chunk("traiter", "traiter qn de", "to call someone (a name)"),
    Chunk("discuter", "discuter de", "to discuss"),
    Chunk("tomber", "tomber sur", "to come across"),
    Chunk("descendre", "descendre de", "to get off, to come down from"),
    Chunk("monter", "monter dans", "to get on, to get into"),
    Chunk("aller", "aller à", "to go to"),
    Chunk("partir", "partir pour", "to leave for"),
    Chunk("content", "content de", "glad about, happy to"),
    Chunk("prêt", "prêt à faire", "ready to do"),
    Chunk("facile", "facile à faire", "easy to do"),
    Chunk("difficile", "difficile à faire", "hard to do"),
    Chunk("capable", "capable de faire", "able to do"),
    Chunk("sûr", "sûr de", "sure of"),
    Chunk("fier", "fier de", "proud of"),
    Chunk("plein", "plein de", "full of"),
)

CHUNKS_OF: dict[str, list[Chunk]] = defaultdict(list)
for _c in CHUNKS:
    CHUNKS_OF[_c.lemma].append(_c)


def chunks_of(lemma: str) -> list[dict]:
    """The chunks a catalogue word carries, as the app reads them; empty for
    a word that governs nothing worth saying."""
    return [{"fr": c.fr, "en": c.en} for c in CHUNKS_OF.get(lemma, [])]
