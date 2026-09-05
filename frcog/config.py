"""Central configuration. Every tunable in one place."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
MEDIA = DATA / "media"
BUILD = DATA / "build"
DB_PATH = DATA / "french.db"
APP_DIR = ROOT / "app"
KAIKKI_PATH = RAW / "kaikki-fr.jsonl"
KAIKKI_URL = "https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl"

# Study directions. These are the keys used in card_state, reviews and Anki templates.
DIR_READ = "fr_en"        # see French, recall English
DIR_RECALL = "en_fr"      # see English, type French
DIR_LISTEN_FR = "audio_fr"  # hear French, type French
DIR_LISTEN_EN = "audio_en"  # hear French, recall English
DIR_SPEAK = "speak"       # hear English, say French (walking mode)
DIRECTIONS = [DIR_READ, DIR_RECALL, DIR_LISTEN_FR, DIR_LISTEN_EN, DIR_SPEAK]

DIRECTION_LABELS = {
    DIR_READ: "Read FR->EN",
    DIR_RECALL: "Recall EN->FR",
    DIR_LISTEN_FR: "Listen->write FR",
    DIR_LISTEN_EN: "Listen->EN",
    DIR_SPEAK: "Speak (walking)",
}

# A direction unlocks once its prerequisite is mature. DIR_READ is always unlocked.


@dataclass
class Config:
    # --- source selection -------------------------------------------------
    top_n: int = 20000          # how many French words by frequency to consider
    min_zipf: float = 2.5       # drop anything rarer than this
    min_len: int = 2            # drop single-letter clitics ("l", "d", "qu")
    max_words: int = 5000       # how many words to keep in the DB after ranking
    one_pos_per_lemma: bool = True  # one card per spelling; "être" verb beats "être" noun
    pos_form_mass_gap: float = 0.5  # Zipf gap at which inflected-form mass decides the POS

    # --- similarity -------------------------------------------------------
    w_levenshtein: float = 0.6  # blend weight: edit distance
    w_jaro_winkler: float = 0.4  # blend weight: prefix-sensitive, cognates share prefixes
    gate_suffix_rules: bool = True  # only apply -ment<->-ly if the EN side really ends in -ly
    similarity_alpha: float = 1.0   # rank = zipf * similarity**alpha
    secondary_sense_discount: float = 0.88  # per-sense-position decay; a cognate in sense 5 counts less

    # --- ranking ----------------------------------------------------------
    tech_boost: float = 1.15    # multiplier for words in tech/professional sense categories
    core_top_n: int = 500       # the N most frequent words are "core" regardless of similarity
    homograph_penalty: float = 1.0  # Zipf penalty when a headword is also another lemma's inflection
    drop_stopwords: bool = True     # keep grammatical words out of the vocabulary deck
    include_helvetisms: bool = True # force in Swiss words the frequency cut would drop
    core_quota: float = 0.15    # fraction of each level reserved for core words
    level_size: int = 100       # words per level == per Anki subdeck

    # --- audio ------------------------------------------------------------
    tts_voice: str = "fr-CH-ArianeNeural"   # Swiss French; user lives in Valais
    tts_rate: str = "-10%"                  # slightly slow, easier for ear training
    lead_silence_ms: int = 300              # padding so players cannot clip the onset
    prefer_regions: tuple = ("Switzerland", "France", "Paris", "Belgium")
    reject_regions: tuple = ("Canada", "Quebec", "Québec", "Acadia", "Louisiana")
    audio_concurrency: int = 8       # edge-tts, which tolerates parallelism
    native_concurrency: int = 2      # Wikimedia, which does not
    native_rate_limit: float = 1.0   # requests/second shared across threads; it
                                     # answers a burst of ~5 with HTTP 429

    # --- cards ------------------------------------------------------------
    type_with_article: bool = True  # answer "le bug", not "bug", so gender gets drilled

    # --- tech register ----------------------------------------------------
    tech_categories: tuple = (
        "Computing", "Internet", "Software", "Programming", "Mathematics",
        "Physics", "Engineering", "Sciences", "Electronics", "Telecommunications",
        "Business", "Economics", "Finance", "Management", "Statistics", "Networking",
        "Cryptography", "Robotics", "Data", "Linguistics", "Medicine",
    )

    def paths(self) -> dict:
        return {"db": DB_PATH, "media": MEDIA, "build": BUILD, "kaikki": KAIKKI_PATH}


DEFAULT = Config()
