"""French grammatical words that do not belong in a vocabulary deck.

These are learned from exposure and from grammar, not from cognate flashcards.
Leaving them in was actively harmful: Wiktionary's lemma entry for a function
word is usually a rare homograph noun, so "la" became "la (musical note A)" and
"pas" became "the pass", both landing in the first level with a perfect
similarity score.

Content words stay, including the irregular high-frequency verbs (etre, avoir,
faire, aller), which are exactly what a beginner needs.
"""

DETERMINERS = {
    "le", "la", "les", "un", "une", "des", "du", "de", "au", "aux", "l",
    "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes",
    "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs",
    "quel", "quelle", "quels", "quelles", "chaque", "aucun", "aucune",
    "tout", "tous", "toute", "toutes", "tel", "telle", "quelque", "quelques",
}
PRONOUNS = {
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
    "me", "te", "se", "lui", "moi", "toi", "soi", "eux", "y", "en",
    "qui", "que", "quoi", "dont", "où", "ceci", "cela", "ça", "ca",
    "celui", "celle", "ceux", "celles", "chacun", "chacune", "autrui",
}
PREPOSITIONS = {
    "à", "a", "de", "dans", "sur", "sous", "par", "pour", "avec", "sans",
    "chez", "vers", "entre", "depuis", "pendant", "avant", "après", "contre",
    "selon", "malgré", "parmi", "dès", "jusque", "jusqu", "hors", "outre",
    "dedans", "dehors", "envers", "durant", "sauf", "via",
}
CONJUNCTIONS = {
    "et", "ou", "mais", "donc", "or", "ni", "car", "que", "si", "quand",
    "comme", "lorsque", "puisque", "parce", "quoique", "soit",
}
GRAMMAR_ADVERBS = {
    "ne", "pas", "plus", "moins", "jamais", "guère", "aussi", "alors",
    "ainsi", "encore", "déjà", "toujours", "très", "trop", "peu", "assez",
    "non", "oui", "si", "y", "là", "ici", "voici", "voilà", "même", "aussi",
}
# Tokens wordfreq emits that are artefacts, abbreviations or bare letters.
ARTEFACTS = {
    "dan", "sou", "est", "an", "ans", "etc", "cf", "ex", "mm", "cm", "km",
    "http", "https", "www", "com", "fr", "org",
}

STOPWORDS = (
    DETERMINERS | PRONOUNS | PREPOSITIONS | CONJUNCTIONS | GRAMMAR_ADVERBS | ARTEFACTS
)


# Grammatical words that also have a genuinely useful content meaning. Their
# det/pron/prep/conj entries are dropped, but "son" (sound), "or" (gold) and
# "car" (coach) survive as vocabulary, with their frequency damped because the
# token count belongs mostly to the grammatical use.
SOFT_KEEP = {"son", "or", "car", "point", "vers", "tour", "part", "sans", "pour"}

GRAMMATICAL_POS = {"det", "pron", "prep", "conj", "particle", "article", "num"}


def is_stopword(word: str) -> bool:
    return word.strip().lower() in STOPWORDS


def stop_action(word: str, pos: str) -> str:
    """One of: "keep", "drop", "damp"."""
    w = word.strip().lower()
    if w not in STOPWORDS:
        return "keep"
    if pos in GRAMMATICAL_POS:
        return "drop"
    if w in SOFT_KEEP:
        return "damp"
    return "drop"
