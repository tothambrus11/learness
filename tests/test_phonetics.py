"""The phonological cognate score, pinned on words whose answer is not in doubt.

The spelling score already says "nation" is identical to English. This score
has to say the opposite, and has to say "taxi" really is the same — otherwise
it is not measuring what it claims to.
"""
import pytest

from frcog.phonetics import (
    Pronunciations, distance, english_phones, french_phones, gloss_word,
)

# ARPABET straight from CMUdict, so the test does not need the file.
CMU = Pronunciations({
    "nation": "N EY1 SH AH0 N",
    "attention": "AH0 T EH1 N SH AH0 N",
    "fruit": "F R UW1 T",
    "table": "T EY1 B AH0 L",
    "taxi": "T AE1 K S IY0",
    "photo": "F OW1 T OW0",
    "train": "T R EY1 N",
    "hero": "HH IH1 R OW0",
})


@pytest.mark.parametrize("ipa,expected", [
    ("/na.sjɔ̃/", "nasjon"),       # syllable dots go, the nasal becomes vowel + n
    ("/fʁwi/", "frwi"),           # the French r lands on plain r
    ("/e.ʁo/", "ero"),
    ("/ɛtʁ/", "etr"),
    ("[ɔ̃m]", "onm"),
    (None, ""),
])
def test_french_phones(ipa, expected):
    assert french_phones(ipa) == expected


def test_english_phones_drop_stress():
    assert english_phones("N EY1 SH AH0 N") == "neʃən"
    assert english_phones("T AE1 K S IY0") == "taksi"


def test_distance_is_normalised():
    assert distance("abc", "abc") == 0.0
    assert distance("abc", "") == 1.0
    assert distance("abcd", "abce") == 0.25


@pytest.mark.parametrize("gloss,expected", [
    ("to pass", "pass"),
    ("the hero", "hero"),
    ("Nation", "nation"),
    ("to denote time, day, or date", None),   # a phrase has no one pronunciation
    ("", None),
    (None, None),
])
def test_gloss_word(gloss, expected):
    assert gloss_word(gloss) == expected


@pytest.mark.parametrize("ipa,gloss,low,high", [
    ("/na.sjɔ̃/", "nation", 0.25, 0.45),        # looks identical, sounds nothing alike
    ("/a.tɑ̃.sjɔ̃/", "attention", 0.25, 0.5),
    ("/fʁwi/", "fruit", 0.4, 0.6),
    ("/tabl/", "table", 0.5, 0.7),
    ("/tak.si/", "taxi", 1.0, 1.0),           # genuinely the same word aloud
    ("/fo.to/", "photo", 1.0, 1.0),
    ("/tʁɛ̃/", "train", 1.0, 1.0),
])
def test_sounds_like_on_known_cases(ipa, gloss, low, high):
    score = CMU.sounds_like(ipa, gloss)
    assert score is not None
    assert low <= score <= high, f"{gloss}: {score}"


def test_no_score_without_both_sides():
    assert CMU.sounds_like("/e.ʁo/", "to denote time") is None, "a phrase gloss"
    assert CMU.sounds_like(None, "hero") is None, "no French IPA"
    assert CMU.sounds_like("/e.ʁo/", "zzzz") is None, "not in the dictionary"


def test_h_aspire_is_not_a_sound():
    """The French h is silent whether or not it blocks elision, so it must not
    count as a consonant the English has and the French lacks."""
    assert CMU.sounds_like("/e.ʁo/", "hero") == CMU.sounds_like("/e.ʁo/", "hero")
    assert french_phones("/e.ʁo/") == "ero"
