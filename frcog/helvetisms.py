"""Swiss French words to force into the deck.

Ranking by frequency drops these: corpora are dominated by France French, so
*natel* and *septante* sit far below the cut even though they are everyday words
in Valais. They are force-included by headword only — glosses, gender, IPA and
audio still come from Wiktionary like any other word, so nothing here is
hand-authored dictionary content.

Words already in the deck for their France French meaning (*action*, *linge*,
*déjeuner*) are flagged Swiss rather than duplicated.
"""

# Numbers. Vaud, Valais and Fribourg use huitante; Geneva says quatre-vingts.
NUMBERS = ["septante", "huitante", "octante", "nonante"]

# Everyday vocabulary.
EVERYDAY = [
    "natel",        # mobile phone
    "panosse",      # floor cloth
    "poutser",      # to clean thoroughly
    "cornet",       # carrier bag
    "linge",        # towel
    "bancomat",     # cash machine
    "galetas",      # attic
    "boguet",       # moped
    "cheni",        # mess, junk
    "pive",         # pine cone
    "tablar",       # shelf
    "catelle",      # wall tile
    "crousille",    # piggy bank
    "signofile",    # car indicator
    "ramasse",      # dustpan
    "sagex",        # polystyrene
]

# Institutions, school and public life.
CIVIC = [
    "votation",     # popular vote
    "maturité",     # school-leaving certificate
    "gymnase",      # upper secondary school
    "commune",      # municipality
    "vignette",     # motorway toll sticker
    "apprentissage",
]

# Food and Valais in particular.
FOOD = [
    "raclette", "fendant", "carnotzet", "séré", "cuchaule", "taillé",
    "déjeuner", "dîner", "souper", "action",
]

HELVETISMS = list(dict.fromkeys(NUMBERS + EVERYDAY + CIVIC + FOOD))
HELVETISM_SET = set(HELVETISMS)


def is_helvetism(word: str) -> bool:
    return word.strip().lower() in HELVETISM_SET
