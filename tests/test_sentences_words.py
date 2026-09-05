"""Sentences for ordinary words, for the cloze rung.

The verb pass has to read a tense off the context. This pass only has to find
the word, so what it pins down is narrower: the word as spelt, a noun's plain
plural, both halves of a two-word lemma, and nothing invented.
"""
from frcog.sentences import Corpus, choose, examples_for_word, word_tokens

PAIRS = [
    ("Tous sont heureux.", "All are happy."),
    ("Le bug est corrigé.", "The bug is fixed."),
    ("Il y a des bugs partout.", "There are bugs everywhere."),
    ("Je vais me laver les mains.", "I am going to wash my hands."),
    ("Il faut laver la voiture.", "The car needs washing."),
    ("Les oiseaux chantent le matin.", "The birds sing in the morning."),
    ("Un mot.", "A word."),                                  # too short to be an example
]
CORPUS = Corpus.build(PAIRS)


def test_a_word_is_found_as_spelt():
    got = examples_for_word("bug", "noun", CORPUS)
    assert {e.fr for e in got} == {"Le bug est corrigé.", "Il y a des bugs partout."}
    assert {e.form for e in got} == {"bug", "bugs"}, "the blank is the token as it stands"


def test_a_noun_plural_is_the_plain_one_only():
    assert {e.form for e in examples_for_word("oiseau", "noun", CORPUS)} == {"oiseaux"}
    assert examples_for_word("sont", "verb", CORPUS)[0].form == "sont"
    assert not examples_for_word("bugs", "noun", CORPUS) or all(
        e.form == "bugs" for e in examples_for_word("bugs", "noun", CORPUS))


def test_a_two_word_lemma_needs_both_words():
    assert word_tokens("se laver") == ["se", "laver"]
    got = examples_for_word("se laver", "verb", CORPUS)
    assert [e.fr for e in got] == ["Je vais me laver les mains."] or got == [], \
        "'se' is not in that sentence, and 'me laver' is not looked for"
    assert {e.fr for e in examples_for_word("laver", "verb", CORPUS)} == {
        "Je vais me laver les mains.", "Il faut laver la voiture."}


def test_nothing_is_invented():
    assert examples_for_word("chanter", "verb", CORPUS) == [], "'chantent' is an inflection this pass does not guess"
    assert examples_for_word("", "noun", CORPUS) == []


def test_short_sentences_first_and_two_at_most():
    picked = choose(examples_for_word("laver", "verb", CORPUS), set(), 2)
    assert len(picked) == 2
    assert picked[0].length <= picked[1].length
