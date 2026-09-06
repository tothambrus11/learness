"""The noun-use rule on a corpus small enough to read."""
from frcog.posuse import NounUse, count_noun_use, score

PAIRS = [(fr, "x") for fr in [
    "La vidéo est très bonne.",
    "J'ai regardé la vidéo hier.",
    "Cette vidéo dure une heure.",
    "C'est un jeu vidéo.",
    "Un petit garçon dort.",
    "Le petit garçon dort.",
    "Mon petit frère chante.",
    "Il est très petit.",
    "La politique est compliquée.",
    "Un homme politique parle.",
    "Il fait beau.",
    "Le fait est là.",
    "Il a fait une erreur.",
    "Elle a fait le tour.",
    "On a fait la fête.",
    "Ça fait mal.",
    "Il fait froid ici.",
    "Qui a fait ça ?",
]] * 10   # repeated so every lemma clears the minimum count

NOUN_FORMS = {"vidéo", "vidéos", "garçon", "garçons", "frère", "frères", "jeu", "jeux",
              "heure", "heures", "homme", "hommes", "erreur", "erreurs", "fait", "faits",
              "politique", "politiques"}
USE = count_noun_use({"vidéo", "petit", "politique", "fait"}, NOUN_FORMS, pairs=PAIRS)


def test_a_noun_stands_after_a_determiner_with_no_noun_after_it():
    assert USE.share("vidéo") == 0.75        # three of four; "un jeu vidéo" is the adjective
    assert USE.is_noun("vidéo")


def test_an_adjective_before_a_noun_is_not_a_noun():
    assert USE.share("petit") == 0.0          # "un petit garçon": a noun follows
    assert not USE.is_noun("petit")


def test_a_word_used_both_ways_is_measured_not_guessed():
    assert USE.share("politique") == 0.5      # "la politique est" yes, "un homme politique" no
    assert USE.is_noun("politique")


def test_a_participle_mostly_used_as_a_verb_is_not_called_a_noun():
    assert USE.share("fait") == 0.125        # "le fait est" once in eight
    assert not USE.is_noun("fait")


def test_too_few_sightings_is_no_answer():
    thin = count_noun_use({"vidéo"}, NOUN_FORMS, pairs=PAIRS[:4])   # four sightings
    assert thin.share("vidéo") is None
    assert not thin.is_noun("vidéo")


def test_the_rule_is_scored_on_words_whose_class_is_known():
    hit, spare, n_nouns, n_adjs = score(USE, {"vidéo"}, {"petit"})
    assert (hit, spare, n_nouns, n_adjs) == (1.0, 1.0, 1, 1)
