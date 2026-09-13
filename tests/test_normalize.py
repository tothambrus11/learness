"""The keys everything else compares on.

Two different keys, and the difference is the point. The scoring key throws
away everything that is not the word — the article, the reflexive, the
accents — because "se développer" and "developed" have to be comparable. The
answer key keeps the article, because on a French noun the article is the
gender, which is the thing the card is there to teach.
"""
import pytest

from frcog.normalize import (
    answer_key, key_en, key_fr, split_gloss, strip_accents, strip_particles,
)


@pytest.mark.parametrize("word,expected", [
    ("développé", "developpe"),
    ("être", "etre"),
    ("cœur", "coeur"),          # a ligature NFD will not take apart on its own
    ("naïve", "naive"),
    ("CAFÉ", "CAFE"),           # case is not this function's business
])
def test_accents_come_off_without_taking_letters_with_them(word, expected):
    assert strip_accents(word) == expected


@pytest.mark.parametrize("word,expected", [
    ("le bus", "bus"),
    ("l'école", "école"),
    ("de la crème", "crème"),   # longest particle first, or "de" would win
    ("se laver", "laver"),
    ("penser à", "penser"),     # a governed preposition is not part of the word
    ("lundi", "lundi"),         # a word that merely starts like an article
    ("les gens", "gens"),
])
def test_particles_come_off_the_front_and_the_governed_preposition_off_the_back(word, expected):
    assert strip_particles(word) == expected


@pytest.mark.parametrize("french,expected", [
    ("se développer", "developper"),
    ("l'hôtel", "hotel"),
    ("le/la ministre", "lelaministre"),   # a pair form is not a particle
    ("", ""),
])
def test_the_french_key_is_letters_and_nothing_else(french, expected):
    assert key_fr(french) == expected


@pytest.mark.parametrize("gloss,expected", [
    ("to wash (oneself)", "wash"),
    ("a mistake", "mistake"),
    ("cat, tom, tomcat", "cat"),          # score against the first sense only
    ("to be located; to be situated", "located"),
    ("", ""),
])
def test_the_english_key_drops_the_infinitive_the_article_and_the_rest(gloss, expected):
    assert key_en(gloss) == expected


def test_the_answer_key_keeps_the_article_because_it_is_the_gender():
    assert answer_key("Le Bus") == "le bus"
    assert answer_key("l'école") == "l'ecole"
    assert answer_key("l'école", keep_accents=True) == "l'école"
    assert answer_key("  le  bus ! ") == "le bus"


def test_a_gloss_of_synonyms_splits_and_a_gloss_of_prose_does_not():
    assert split_gloss("cat, tom, tomcat (male)") == ["cat", "tom", "tomcat"]
    assert split_gloss("to denote time, day, or date") == ["to denote time, day, or date"]
    assert split_gloss("to be located; to be situated") == ["to be located; to be situated"], \
        "a piece that opens with 'to' is the rest of a sentence, not a synonym"
    assert split_gloss("bus, bus") == ["bus"], "the same word twice is one word"
    assert split_gloss("") == []
