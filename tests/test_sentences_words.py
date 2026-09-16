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


def test_a_gap_never_falls_inside_a_hyphenated_word():
    """"Peut-être" is not être, "sous-titres" is not titre: the app used to
    blank "Peut-___ pas." (#39). A hyphen after the form is a boundary."""
    corpus = Corpus.build([
        ("Peut-être pas, mais je veux être là.", "Maybe not, but I want to be there."),
        ("Les sous-titres sont faux, dit-il.", "The subtitles are wrong, he says."),
        ("Allons-y ensemble, mes amis.", "Let's go together, my friends."),
    ])
    assert [e.fr for e in examples_for_word("titre", "noun", corpus)] == []
    got = examples_for_word("être", "verb", corpus)
    assert [e.fr for e in got] == ["Peut-être pas, mais je veux être là."], "the second être stands alone"
    from frcog.sentences import stands_alone
    assert stands_alone("allons", "Allons-y ensemble, mes amis.")
    assert stands_alone("dit", "Les sous-titres sont faux, dit-il.")
    assert not stands_alone("titres", "Les sous-titres sont faux, dit-il.")


def _suivre():
    """Enough of suivre's table for the forms: the présent, whose "suis" is
    also être; the futur, whose forms are suivre's alone; and the passé
    simple, which is read and never asked for."""
    row = lambda f: {"p": "", "s": "", "e": f, "f": f, "alt": False, "dup": False}
    return {
        "lemma": "suivre", "aux": "avoir",
        "groups": [
            {"id": "pres", "rows": [row("suis"), row("suis"), row("suit"),
                                    row("suivons"), row("suivez"), row("suivent")]},
            {"id": "fut", "rows": [row("suivrai"), row("suivras"), row("suivra"),
                                   row("suivrons"), row("suivrez"), row("suivront")]},
            {"id": "hist", "rows": [row("suivis"), row("suivis"), row("suivit"),
                                    row("suivîmes"), row("suivîtes"), row("suivirent")]},
        ],
        "impersonal": [{"label": "Participe passé", "form": "suivi"}],
        "compound": [],
    }


OWNERS = {"suis": {"suivre|verb", "être|verb"}, "suit": {"suivre|verb"},
          "suivrai": {"suivre|verb"}, "suivent": {"suivre|verb"}, "suivit": {"suivre|verb"}}


def test_a_verb_the_corpus_never_spells_as_an_infinitive_is_met_through_its_own_forms():
    """*préférer*, *concerner*, *inclure* and twenty-odd more shipped without
    a sentence, and the cloze rung never opened for them, because only the
    infinitive was looked for and the corpus writes "je préfère" (#57). A
    form the verb's table lists, and no other word is spelt like, is the
    verb; a form another word owns — "suis" — is not, or a sentence of être
    would be blanked for suivre; and a literary form is not asked for."""
    from frcog.sentences import own_forms, pick_for_word
    corpus = Corpus.build([
        ("Je suis curieux.", "I am curious."),
        ("Un chien suit Tom.", "A dog follows Tom."),
        ("Suivit un long silence.", "A long silence followed."),
        ("Je te suivrai partout.", "I will follow you everywhere."),
    ])
    assert examples_for_word("suivre", "verb", corpus) == [], "the infinitive is not in the corpus"
    forms = own_forms(_suivre(), OWNERS, "suivre")
    assert "suis" not in forms, "être's too"
    assert "suivit" not in forms, "the passé simple is read, never asked for"
    assert "suit" in forms and "suivrai" in forms
    picked = pick_for_word("suivre", "verb", corpus, _suivre(), OWNERS)
    assert [(e.form, e.fr) for e in picked] == [
        ("suit", "Un chien suit Tom."), ("suivrai", "Je te suivrai partout.")]
    assert pick_for_word("suivre", "verb", corpus, _suivre(), None) == [], \
        "with no owners map a form cannot be told from another word's, so none is looked for"


def test_the_infinitive_keeps_its_place_ahead_of_the_forms():
    """A sentence that spells the word out is what the learner studied; the
    forms only fill what the infinitive left empty, so a word that already
    had two sentences keeps the same two."""
    from frcog.sentences import pick_for_word
    corpus = Corpus.build([
        ("Un chien suit Tom.", "A dog follows Tom."),
        ("Veuillez me suivre.", "Please follow me."),
        ("Je te suivrai partout.", "I will follow you everywhere."),
    ])
    picked = pick_for_word("suivre", "verb", corpus, _suivre(), OWNERS)
    assert [e.form for e in picked] == ["suivre", "suit"], "the infinitive first, then the shortest form"
