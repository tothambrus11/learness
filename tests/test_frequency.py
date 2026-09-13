"""Frequency: the other half of what puts a word in front of you.

These run against the real wordfreq tables, so the assertions are about
relations that hold in any French corpus — "jour" is commoner than "galetas" —
rather than about numbers that would move with the next release.
"""
import math

import pytest

from frcog.freq import (
    CLITICS, FORM_FREQ_MARGIN, aggregate_zipf, form_mass_zipf, linear_to_zipf, top_words,
    total_mass,
)
from frcog.config import DEFAULT, Config
from frcog.helvetisms import HELVETISMS, is_helvetism
from frcog.stoplist import STOPWORDS, is_stopword, stop_action


def test_zipf_is_a_log_scale_with_a_floor_at_nothing():
    assert linear_to_zipf(1e-6) == pytest.approx(3.0)
    assert linear_to_zipf(1e-3) == pytest.approx(6.0)
    assert linear_to_zipf(0) == 0.0, "a word nobody uses is not minus infinity"
    assert linear_to_zipf(-1) == 0.0


def test_the_commoner_word_scores_higher():
    common, _ = aggregate_zipf("jour", [])
    rare, _ = aggregate_zipf("galetas", [])
    assert common > rare > 0


def test_a_verb_carries_its_own_inflections_and_not_another_word_s():
    """A conjugation table lists the auxiliary, and a plural can collide with a
    preposition: "sou" would inherit the frequency of "sous"."""
    alone, lemma = aggregate_zipf("lire", [])
    with_forms, _ = aggregate_zipf("lire", ["lit", "lis", "lisent", "lu"])
    assert with_forms > alone, "the forms are the word being used"
    assert lemma == pytest.approx(alone, abs=0.5)

    honest = form_mass_zipf("sou", ["sous"])
    assert honest == 0.0, (
        "'sous' is the preposition, far commoner than the coin: "
        f"anything over {FORM_FREQ_MARGIN} Zipf above the lemma is somebody else's")


def test_a_form_two_words_share_is_counted_for_neither():
    """"faite" and "faits" are listed under the adjective "fait" and are the
    participle of "faire"; counted for the adjective they outweigh the noun."""
    both = form_mass_zipf("fait", ["faite", "faits", "faites"])
    neither = form_mass_zipf("fait", ["faite", "faits", "faites"],
                             shared={"faite", "faits", "faites"})
    assert neither < both
    assert neither == 0.0


def test_the_headword_itself_is_never_counted_as_one_of_its_forms():
    assert form_mass_zipf("jour", ["jour"]) == 0.0
    assert form_mass_zipf("jour", ["jours"]) > 0


def test_running_text_is_a_share_of_one():
    mass = total_mass(["le", "de", "et"])
    assert 0 < mass < 1
    assert total_mass([]) == 0.0
    assert total_mass(["le"]) < total_mass(["le", "de"])


def test_the_word_list_excludes_the_clitics_and_the_junk():
    words = dict(top_words(Config(**{**DEFAULT.__dict__, "top_n": 400})))
    assert words, "the list is not empty"
    assert not (set(words) & CLITICS), "l', d', j' are not words to learn"
    assert all(len(w) >= DEFAULT.min_len for w in words)
    assert all(math.isfinite(z) for z in words.values())
    assert "jour" in words


def test_grammar_is_dropped_but_a_word_that_is_also_grammar_is_only_damped():
    """"son" is a possessive and also a sound; "or" is a conjunction and also
    gold. The grammatical entry goes, the vocabulary survives."""
    assert is_stopword("le") and is_stopword("  LE ")
    assert not is_stopword("natel")
    assert stop_action("le", "det") == "drop"
    assert stop_action("son", "det") == "drop", "the possessive is grammar"
    assert stop_action("son", "noun") == "damp", "the sound is a word, worth less"
    assert stop_action("pas", "noun") == "drop", "and a homograph nobody means is not"
    assert stop_action("natel", "noun") == "keep"
    assert "le" in STOPWORDS


def test_the_swiss_words_are_forced_in_by_headword_only():
    assert is_helvetism("natel") and is_helvetism(" Septante ")
    assert not is_helvetism("téléphone")
    assert len(HELVETISMS) == len(set(HELVETISMS)), "listed once each"
    assert "septante" in HELVETISMS and "raclette" in HELVETISMS
