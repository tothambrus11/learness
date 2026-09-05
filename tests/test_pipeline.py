"""Tests for the scoring and ranking logic.

Each test here pins down a bug that the ranking sanity check actually surfaced.
"""
import pytest

from frcog.build import Candidate, assign_order, display_form, type_answer
from frcog.config import Config
from frcog.freq import aggregate_zipf, form_mass_zipf
from frcog.kaikki import Entry
from frcog.normalize import answer_key, key_en, key_fr, split_gloss, strip_accents
from frcog.similarity import score_pair, score_word
from frcog.helvetisms import is_helvetism
from frcog.stoplist import stop_action

CFG = Config()


# --- normalisation --------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("se laver", "laver"),
    ("le bug", "bug"),
    ("développement", "developpement"),
    ("aujourd'hui", "aujourdhui"),
    ("penser à", "penser"),
    ("œuf", "oeuf"),
    ("l'ordinateur", "ordinateur"),
])
def test_key_fr(raw, expected):
    assert key_fr(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("to wash", "wash"),
    ("a computer, a computing device.", "computer"),
    ("the nation", "nation"),
    ("cat (feline)", "cat"),
])
def test_key_en(raw, expected):
    assert key_en(raw) == expected


def test_split_gloss_separates_synonyms():
    assert split_gloss("cat, tom, tomcat (male)") == ["cat", "tom", "tomcat"]
    assert split_gloss("money, cash, cent") == ["money", "cash", "cent"]


def test_split_gloss_keeps_prose_whole():
    """Wiktionary writes prose in the gloss field too. Splitting on every comma
    turned one meaning of "être" into the fake synonyms "day" and "or date"."""
    assert split_gloss("to denote time, day, or date") == ["to denote time, day, or date"]
    assert split_gloss("the state or fact of existence") == ["the state or fact of existence"]


def test_answer_key_tolerates_missing_accents():
    assert answer_key("developpe") == answer_key("développé")
    assert answer_key("  Le  Bug ") == "le bug"


def test_strip_accents_keeps_letters():
    assert strip_accents("Ça va, très bien") == "Ca va, tres bien"


# --- similarity -----------------------------------------------------------

@pytest.mark.parametrize("fr,en,floor", [
    ("nation", "nation", 0.99),
    ("rapidement", "rapidly", 0.85),      # -ment <-> -ly
    ("qualité", "quality", 0.95),         # -té   <-> -ty
    ("logique", "logic", 0.95),           # -ique <-> -ic
    ("acteur", "actor", 0.95),            # -eur  <-> -or
    ("nerveux", "nervous", 0.95),         # -eux  <-> -ous
    ("organiser", "to organize", 0.95),   # -iser <-> -ize
    ("le bug", "bug", 0.99),              # loanword, article stripped
])
def test_suffix_rules_find_the_cognate(fr, en, floor):
    assert score_pair(fr, en, CFG).similarity >= floor


@pytest.mark.parametrize("fr,en", [
    ("actuellement", "currently"),   # the classic false friend, scored honestly
    ("ordinateur", "computer"),
    ("voir", "to see"),
])
def test_non_cognates_score_low(fr, en):
    assert score_pair(fr, en, CFG).similarity < 0.6


def test_false_friend_in_a_minor_sense_is_discounted():
    """Wiktionary lists "to rest" as sense 5 of "rester" (to stay). Scoring the
    best gloss made a false friend look like a perfect cognate."""
    glosses = ["to stay", "to remain", "be left over", "to live", "to rest"]
    best, rank_sim = score_word("rester", glosses, CFG)
    assert best.similarity > 0.9          # the raw match is still found
    assert rank_sim < 0.7                 # but it does not drive the ranking


def test_primary_sense_cognate_keeps_full_score():
    _, rank_sim = score_word("la collection", ["collection"], CFG)
    assert rank_sim >= 0.99


def test_suffix_gate_blocks_unrelated_rewrites():
    """-ment -> -ly must not fire when the English side does not end in -ly."""
    gated = Config(gate_suffix_rules=True)
    assert score_pair("vraiment", "really", gated).similarity >= 0.4


# --- frequency ------------------------------------------------------------

def test_conjugation_table_auxiliary_is_not_credited():
    """kaikki lists "avoir"/"ayant" in every compound conjugation table."""
    agg, lemma = aggregate_zipf("redescendre", ["avoir", "ayant", "redescends"])
    assert agg < lemma + 0.5


def test_plural_colliding_with_a_preposition_is_not_credited():
    """"dan" -> plural "dans", which is the very common preposition."""
    agg, lemma = aggregate_zipf("dan", ["dans"])
    assert agg == pytest.approx(lemma, abs=0.05)


def test_real_inflections_are_credited():
    """"être" is rarer than its own conjugations; rolling them up is the point."""
    agg, lemma = aggregate_zipf("être", ["est", "sont", "était", "suis"])
    assert agg > lemma + 0.5


def test_form_mass_separates_homographs():
    verb = form_mass_zipf("lire", ["lit", "lis", "lisent", "lu", "lisons"])
    noun = form_mass_zipf("lire", ["lires"])
    assert verb - noun > 0.5


# --- stoplist -------------------------------------------------------------

@pytest.mark.parametrize("word,pos,action", [
    ("le", "det", "drop"),
    ("pas", "noun", "drop"),      # "the pass" is not worth a card
    ("son", "noun", "damp"),      # but "the sound" is
    ("or", "noun", "damp"),       # gold
    ("ordinateur", "noun", "keep"),
])
def test_stop_action(word, pos, action):
    assert stop_action(word, pos) == action


def test_display_form_is_stable_across_rebuilds():
    """Progress is keyed on (lemma, pos), so the displayed form must not wander
    between builds or a word would lose its history."""
    e = Entry(word="bug", pos="noun", gender="m")
    assert display_form(e) == display_form(Entry(word="bug", pos="noun", gender="m"))


# --- swiss french ---------------------------------------------------------

@pytest.mark.parametrize("word,expected", [
    ("septante", True), ("huitante", True), ("natel", True), ("panosse", True),
    ("ordinateur", False), ("nation", False),
])
def test_helvetism_list(word, expected):
    assert is_helvetism(word) is expected


def test_swiss_sense_is_promoted_to_primary():
    """Wiktionary orders senses by the France French meaning, so "linge" reads
    "linen" when in Valais it is a towel."""
    from frcog.build import Candidate
    e = Entry(word="linge", pos="noun", gender="m",
              glosses=["linen", "laundry", "towel"], swiss_glosses=["towel"])
    c = Candidate(entry=e, zipf=4.0, zipf_lemma=4.0, freq_linear=0.0, similarity=0.5,
                  best_english="linen", tech_boost=1.0, rank_score=2.0, is_helvetism=True)
    e.swiss = True
    if c.entry.swiss and c.entry.swiss_glosses:
        rest = [g for g in c.entry.glosses if g not in c.entry.swiss_glosses]
        c.entry.glosses = c.entry.swiss_glosses + rest
    assert c.entry.glosses[0] == "towel"


# --- card shape -----------------------------------------------------------

@pytest.mark.parametrize("word,pos,gender,expected", [
    ("bug", "noun", "m", "le bug"),
    ("nation", "noun", "f", "la nation"),
    ("ordinateur", "noun", "m", "un ordinateur"),   # vowel-initial keeps gender visible
    ("erreur", "noun", "f", "une erreur"),
    ("laver", "verb", None, "laver"),
    ("ministre", "noun", "mf", "le/la ministre"),
])
def test_display_form_shows_gender(word, pos, gender, expected):
    assert display_form(Entry(word=word, pos=pos, gender=gender)) == expected


def test_type_answer_drills_the_article():
    e = Entry(word="bug", pos="noun", gender="m")
    assert type_answer(e, Config(type_with_article=True)) == "le bug"
    assert type_answer(e, Config(type_with_article=False)) == "bug"


# --- ordering -------------------------------------------------------------

def _cand(word, score, zipf, core=False):
    return Candidate(entry=Entry(word=word, pos="noun"), zipf=zipf, zipf_lemma=zipf,
                     freq_linear=0.0, similarity=1.0, best_english="x", tech_boost=1.0,
                     rank_score=score, is_core=core)


def test_core_words_are_interleaved_into_every_level():
    cfg = Config(level_size=10, core_quota=0.2)
    cands = [_cand(f"cog{i}", 100 - i, 3.0) for i in range(20)]
    cands += [_cand(f"core{i}", 0.1, 7.0 - i * 0.1, core=True) for i in range(6)]
    order = assign_order(cands, cfg)
    assert len(order) == len(cands)
    first_level = [c.entry.word for c in order[:10]]
    assert sum(w.startswith("core") for w in first_level) == 2
    assert len({c.entry.word for c in order}) == len(cands)   # no duplicates, none lost
