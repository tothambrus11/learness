"""The function words: the inventory that is written by hand, and the rule
that finds each one in running text without mistaking it for its homograph.
"""
import sqlite3

from frcog.function import (
    INVENTORY, MIN_SENTENCES, BY_WORD, attach, check_inventory, choose, corpus_from_db,
    entries, find, index_entry, interleave,
)
from frcog.sentences import SCHEMA as EXAMPLES_SCHEMA, Corpus

PAIRS = [
    ("Les feuilles tombaient sur le sol.", "The leaves were falling on the ground."),
    ("Je notai son numéro sur un morceau de papier.", "I wrote his number on a piece of paper."),
    ("Un livre sur la guerre.", "A book about the war."),
    ("Les sous-titres sont faux.", "The subtitles are wrong."),          # a prefix, not sous
    ("Il avait laissé le vélo sous la pluie.", "He had left the bike in the rain."),
    ("Assure-toi que personne n'entre.", "Make sure nobody comes in."),  # the verb entrer
    ("Certains d'entre eux sont partis.", "Some of them left."),           # a partitive
    ("Placez le mot entre parenthèses.", "Put the word in brackets."),
    ("Ils sortirent un par un.", "They went out one by one."),            # an idiom
    ("Contactez-les par téléphone.", "Contact them by phone."),
    ("Viens avec.", "Come along."),                                        # nothing governed
    ("Il rentre chez lui.", "He is going home."),
    ("L'accident se produisit près de chez lui.", "The accident happened near his home."),
    ("Il habite près du parc.", "He lives near the park."),                # a contraction
]
CORPUS = Corpus.build(PAIRS)


def test_every_contrast_partner_is_a_word_of_its_own():
    """A button with no card behind it is what lets "always tap pour" win."""
    assert check_inventory() == []
    for w in INVENTORY:
        assert w.contrast, w.word
        assert all(c in BY_WORD for c in w.contrast)


def test_a_preposition_is_found_where_it_governs_something():
    got = {h.fr for h in find(BY_WORD["sur"], CORPUS)}
    assert got == {
        "Les feuilles tombaient sur le sol.",
        "Je notai son numéro sur un morceau de papier.",
        "Un livre sur la guerre.",
    }
    assert all(h.form == "sur" for h in find(BY_WORD["sur"], CORPUS)), "the gap is the word itself"


def test_a_prefix_joined_by_a_hyphen_is_not_the_word():
    """"Les sous-___ sont faux." was the card this rule exists to prevent."""
    assert {h.fr for h in find(BY_WORD["sous"], CORPUS)} == {"Il avait laissé le vélo sous la pluie."}


def test_the_verb_and_the_partitive_are_not_the_preposition():
    """"personne n'entre" is entrer; "d'entre eux" is a partitive. Only the
    sentence where entre stands between two things is kept."""
    assert {h.fr for h in find(BY_WORD["entre"], CORPUS)} == {"Placez le mot entre parenthèses."}


def test_an_idiom_the_word_does_not_mean_itself_in_is_left_out():
    assert {h.fr for h in find(BY_WORD["par"], CORPUS)} == {"Contactez-les par téléphone."}


def test_a_word_with_nothing_after_it_governs_nothing():
    assert find(BY_WORD["avec"], CORPUS) == []


def test_a_two_word_entry_is_the_two_words_and_not_a_contraction():
    """"près du" would put "près du" in the gap of a card whose answer is
    "près de"; the contraction is another lesson."""
    got = find(BY_WORD["près de"], CORPUS)
    assert [h.fr for h in got] == ["L'accident se produisit près de chez lui."]
    assert got[0].form == "près de"


def test_choosing_spreads_the_pool_over_what_follows_the_word():
    """Eight sentences of "sur la table" would teach the table."""
    hits = find(BY_WORD["sur"], CORPUS)
    picked = choose(hits, limit=2)
    assert len({h.after for h in picked}) == 2
    assert picked[0].glossed, "a sentence whose English carries the sense comes first"


def test_the_english_gloss_is_what_ranks_a_sentence_first():
    hits = find(BY_WORD["sous"], CORPUS)
    assert hits and not hits[0].glossed, '"in the rain" does not say under, and the card should know'


def _db_with(pairs) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript("CREATE TABLE words (id INTEGER PRIMARY KEY);")
    con.executescript(EXAMPLES_SCHEMA)
    con.executemany(
        "INSERT INTO examples (word_id, tense, form, fr, en, sure, source, n) "
        "VALUES (1, 'word', 'x', ?, ?, 1, 'test', 0)", pairs)
    return con


def test_the_database_is_a_corpus_when_the_dump_was_never_fetched():
    con = _db_with(PAIRS)
    corpus = corpus_from_db(con)
    assert len(corpus.kept) == len({fr for fr, _ in PAIRS if 3 <= len(fr.split()) <= 14})
    attach(con, corpus, log=lambda *_: None)
    n = con.execute("SELECT COUNT(*) FROM function_examples WHERE word='sur'").fetchone()[0]
    assert n == 3


def test_a_word_with_too_few_sentences_is_not_exported():
    """A card with nothing to ask is the blank card DESIGN.md already had once."""
    con = _db_with(PAIRS)
    attach(con, corpus_from_db(con), log=lambda *_: None)
    out = entries(con)
    assert [w["fr"] for w in out] == ["sur"], f"only sur has {MIN_SENTENCES} sentences here"
    sur = out[0]
    assert sur["k"] == "sur|prep"
    assert sur["kind"] == "function"
    assert sur["lvl"] == 0
    assert sur["contrast"] == ["sous|prep", "dans|prep"], "partners by key, whether exported or not"
    assert sur["sense"].startswith("on a surface")
    assert sur["ex"][0]["f"] == "sur"
    assert "looks" not in sur and "sounds" not in sur, "no similarity score: it is not a question"


def test_the_index_row_carries_no_mass_and_no_score():
    row = index_entry({"k": "sur|prep", "fr": "sur", "en": ["on"], "stage": 1})
    assert row == {"k": "sur|prep", "fr": "sur", "en": ["on"], "lvl": 0, "m": 0, "kind": "function"}


def test_function_words_join_the_ranked_index_by_stage():
    index = [{"k": f"w{i}|noun"} for i in range(120)]
    words = [{"k": "sur|prep", "fr": "sur", "en": ["on"], "stage": 1},
             {"k": "pour|prep", "fr": "pour", "en": ["for"], "stage": 2}]
    out = interleave(index, words)
    assert len(out) == 122
    assert out[50]["k"] == "sur|prep", "stage 1 after the first fifty catalogue words"
    assert out[101]["k"] == "pour|prep", "stage 2 after a hundred, counting the one already in"
    short = interleave(index[:10], words)
    assert [w["k"] for w in short[-2:]] == ["sur|prep", "pour|prep"], "a short index: at the end"
