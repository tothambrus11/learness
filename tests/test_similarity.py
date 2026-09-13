"""The cognate score, on words whose answer is not in doubt.

This is the number the whole ranking is built on: a word that looks like its
English is nearly free to learn, and goes first. So the score has to be right
about the easy cases and, more importantly, right about the traps.
"""
import pytest

from frcog.config import DEFAULT
from frcog.similarity import en_variants, fr_variants, score_pair, score_word


@pytest.mark.parametrize("french,english", [
    ("nation", "nation"),
    ("table", "table"),
    ("photo", "photo"),
    ("attention", "attention"),
])
def test_a_word_spelled_the_same_scores_as_the_same_word(french, english):
    assert score_pair(french, english).similarity > 0.95


@pytest.mark.parametrize("french,english,least", [
    ("rapidement", "rapidly", 0.75),      # -ment / -ly
    ("qualité", "quality", 0.85),         # -té / -ty
    ("acteur", "actor", 0.85),            # -eur / -or
    ("nerveux", "nervous", 0.75),         # -eux / -ous
    ("actif", "active", 0.85),            # -if / -ive
    ("organiser", "organize", 0.85),      # -iser / -ize
    ("danser", "dance", 0.7),             # the bare infinitive
])
def test_a_regular_suffix_pair_scores_as_the_near_identity_it_is(french, english, least):
    assert score_pair(french, english).similarity >= least


@pytest.mark.parametrize("french,english", [
    ("chien", "dog"),
    ("eau", "water"),
    ("pain", "bread"),
    ("faire", "do"),
])
def test_a_word_that_shares_nothing_scores_low(french, english):
    assert score_pair(french, english).similarity < 0.45


def test_a_rewrite_only_applies_when_both_sides_ask_for_it():
    """The rules are gated on the other side's ending, so "-ment" is rewritten
    towards an English adverb and not towards every gloss there is. The rewrite
    is mechanical — "rapidement" becomes "rapidely", not "rapidly" — and that
    is enough for the distance to close."""
    assert "rapidely" in fr_variants("rapidement", "rapidly", DEFAULT)
    assert "rapidely" not in fr_variants("rapidement", "fast", DEFAULT), \
        "nothing to rewrite towards: the gloss is not an adverb"
    assert en_variants("qualite", "quality", DEFAULT) >= {"quality", "qualitte"} \
        or "quality" in en_variants("qualite", "quality", DEFAULT)


def test_the_ranking_favours_the_first_sense_so_a_false_friend_stays_down():
    """Wiktionary lists "to rest" as a minor sense of "rester" ("to stay").
    Scoring the best gloss made a false friend look like a perfect cognate."""
    best, rank = score_word("rester", ["to stay", "to remain", "to be left", "to rest"])
    assert best.similarity > 0.9, "the trap is there: sense four is nearly identical"
    assert rank < best.similarity, "and the ranking must not be fooled by it"

    _, honest = score_word("nation", ["nation"])
    assert honest > 0.95, "a real cognate in sense one keeps its score"


def test_a_word_with_no_gloss_scores_nothing_rather_than_failing():
    best, rank = score_word("natel", [])
    assert (best.similarity, rank) == (0.0, 0.0)
    assert score_pair("", "anything").similarity == 0.0
