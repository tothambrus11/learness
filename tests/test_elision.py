"""Tests for how "le X" is told apart from "l'X".

The point of frcog/elision.py is that no French is decided here: every verdict
traces to a phoneme, a dictionary category or a corpus count. These tests pin
down the combination rules and, above all, the refusals -- a word nobody has
classified must come back unknown rather than plausible.
"""
import pytest

from frcog import elision
from frcog.conjugation import _elide
from frcog.elision import BLOCK, ELIDE, first_sound, needs_lookup, resolve


# --- reading the first sound off the IPA -----------------------------------

@pytest.mark.parametrize("ipa,expected", [
    ("/e.ʁo/", "vowel"),          # héros
    ("/o.pi.tal/", "vowel"),      # hôpital
    ("/œj/", "vowel"),            # œil, which no hand-typed vowel list caught
    ("/bʁɔ̃z/", "consonant"),
    ("/ˈetʁ/", "vowel"),          # a stress mark is not a phoneme
    ("/ja.uʁt/", "semivowel"),    # yaourt: blocks
    ("/wa.zo/", "semivowel"),     # oiseau: elides. Same onset class, so the
    ("/ɥil/", "semivowel"),       # sound alone settles neither
    (None, None),
    ("", None),
])
def test_first_sound(ipa, expected):
    assert first_sound(ipa) == expected


# --- the wiktionary categories ---------------------------------------------

def test_h_class_from_categories():
    assert elision.h_class_from_categories(["French terms with aspirated h"]) == BLOCK
    assert elision.h_class_from_categories(["French terms with mute h"]) == ELIDE
    assert elision.h_class_from_categories(["Anatomy", "French lemmas"]) is None


def test_a_word_in_both_categories_is_not_settled():
    """Wiktionary files "haricot" under both, which is it reporting that usage
    is divided rather than that it cannot make up its mind."""
    assert elision.h_class_from_categories(
        ["French terms with aspirated h", "French terms with mute h"]) is None


# --- corpus counting --------------------------------------------------------

def test_corpus_needs_enough_evidence_and_a_clear_margin():
    counts = elision.CorpusCounts()
    counts.elide["a"] = 1
    assert counts.verdict("a") is None, "one sighting decides nothing"
    counts.elide["b"], counts.block["b"] = 9, 0
    assert counts.verdict("b") == ELIDE
    counts.elide["c"], counts.block["c"] = 5, 4
    assert counts.verdict("c") is None, "divided usage is not a verdict"


def test_corpus_is_scored_against_the_dictionaries():
    counts = elision.CorpusCounts()
    counts.block["héros"] = 9
    counts.elide["hôpital"] = 9
    counts.elide["haine"] = 9              # a corpus rule that got one wrong
    agree, wrong, examples = elision.score_against_dictionaries(
        counts, {"héros": BLOCK, "hôpital": ELIDE, "haine": BLOCK})
    assert (agree, wrong, examples) == (2, 1, ["haine"])


# --- putting the sources together -------------------------------------------

def test_a_consonant_needs_no_source():
    assert resolve("bronze", "/bʁɔ̃z/", None, None, None) == elision.Verdict(
        False, "consonant onset")


def test_a_plain_vowel_needs_no_source():
    v = resolve("ordinateur", "/ɔʁ.di.na.tœʁ/", None, None, None)
    assert v.elides is True


def test_the_dictionary_beats_the_spelling():
    """héros and hôpital are the same shape and the same first phoneme."""
    assert resolve("héros", "/e.ʁo/", BLOCK, None, None).elides is False
    assert resolve("hôpital", "/o.pi.tal/", ELIDE, None, None).elides is True


def test_an_h_nobody_classified_stays_unknown():
    for word, ipa in [("hectare", "/ɛk.taʁ/"), ("hercule", "/ɛʁ.kyl/")]:
        assert resolve(word, ipa, None, None, None).elides is None


def test_a_semivowel_nobody_classified_stays_unknown():
    """"l'oiseau" and "le yaourt" both start /j w ɥ/-ish, so the onset alone
    cannot be allowed to answer."""
    assert resolve("yuan", "/ɥan/", None, None, None).elides is None


def test_the_corpus_answers_where_the_dictionaries_are_silent():
    assert resolve("yacht", "/jɔt/", None, None, BLOCK).elides is False
    assert resolve("hémisphère", "/e.mi.sfɛʁ/", None, None, ELIDE).elides is True


def test_sources_that_disagree_settle_nothing():
    assert resolve("haricot", "/a.ʁi.ko/", BLOCK, ELIDE, None).elides is None
    assert resolve("havre", "/ɑvʁ/", BLOCK, None, ELIDE).elides is None


def test_only_ambiguous_spellings_cost_a_lookup():
    assert needs_lookup("héros", "/e.ʁo/") is True
    assert needs_lookup("yaourt", "/ja.uʁt/") is True
    assert needs_lookup("ordinateur", "/ɔʁ.di.na.tœʁ/") is False
    assert needs_lookup("bronze", "/bʁɔ̃z/") is False
    assert needs_lookup("natel", None) is False, "a consonant is a consonant untranscribed"
    assert needs_lookup("ouate", None) is True


# --- the same question inside a conjugation table ---------------------------

def test_je_elides_by_the_same_rule():
    assert _elide("je", "ai") == "j'"
    assert _elide("je", "vais") == "je "
    assert _elide("je", "hésite", h_elides=True) == "j'"
    assert _elide("je", "hais", h_elides=False) == "je "
    assert _elide("que je", "hésite", h_elides=True) == "que j'"
