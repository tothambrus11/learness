"""The pipeline: frequency list -> Wiktionary -> similarity -> ranking -> SQLite."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

from wordfreq import word_frequency, zipf_frequency

from functools import lru_cache

from . import db
from .config import DEFAULT, DIR_READ, Config, KAIKKI_PATH
from .kaikki import Entry, iter_entries, merge_entries
from .freq import aggregate_zipf, form_mass_zipf, top_words
from .similarity import score_word
from .helvetisms import HELVETISM_SET, is_helvetism
from .stoplist import stop_action

VOWELISH = tuple("aàâeéèêëiîïoôuùûyhAEIOUY")


@lru_cache(maxsize=None)
def zipf_frequency_cached(w: str) -> float:
    return zipf_frequency(w, "fr")


def display_form(entry: Entry) -> str:
    """What the card teaches. Nouns carry an article so gender is never invisible."""
    w = entry.word
    if entry.pos == "noun" and entry.gender:
        vowel = w.lower().startswith(VOWELISH)
        if entry.gender == "m":
            return f"un {w}" if vowel else f"le {w}"
        if entry.gender == "f":
            return f"une {w}" if vowel else f"la {w}"
        return f"le/la {w}"
    return w


def type_answer(entry: Entry, cfg: Config) -> str:
    if cfg.type_with_article and entry.pos == "noun" and entry.gender in {"m", "f"}:
        return display_form(entry)
    return entry.word


@dataclass
class Candidate:
    entry: Entry
    zipf: float
    zipf_lemma: float
    freq_linear: float
    similarity: float
    best_english: str
    tech_boost: float
    rank_score: float
    is_core: bool = False
    is_homograph: bool = False
    is_helvetism: bool = False
    form_mass: float = 0.0

    @property
    def key(self) -> tuple[str, str]:
        return (self.entry.word, self.entry.pos)


def tech_boost_for(entry: Entry, cfg: Config) -> float:
    for cat in entry.categories:
        for t in cfg.tech_categories:
            if t.lower() in cat.lower():
                return cfg.tech_boost
    return 1.0


def build_candidates(kaikki_path: Path, cfg: Config = DEFAULT, log=print) -> list[Candidate]:
    freq = top_words(cfg)
    wanted = {w for w, _ in freq}
    if cfg.include_helvetisms:
        wanted |= HELVETISM_SET     # far below the frequency cut, but daily words here
    log(f"  frequency list: {len(wanted)} words (top {cfg.top_n}, zipf >= {cfg.min_zipf})")

    t0 = time.time()
    entries = merge_entries(iter_entries(kaikki_path, cfg, wanted=wanted))
    log(f"  wiktionary:     {len(entries)} lemma entries matched in {time.time() - t0:.1f}s")

    # A headword that is also another lemma's inflected form inherits that
    # lemma's token count from the frequency list: "est" (east) reads as 7.20
    # because it is overwhelmingly the verb "est" (is). Damp those.
    owners: dict[str, float] = {}
    for (word, pos), e in entries.items():
        lz = zipf_frequency_cached(word)
        for f in e.forms:
            fl = f.lower()
            if fl != word.lower() and lz > owners.get(fl, -1.0):
                owners[fl] = lz

    cands: list[Candidate] = []
    skipped_stop = 0
    for (word, pos), e in entries.items():
        action = stop_action(word, pos) if cfg.drop_stopwords else "keep"
        if action == "drop":
            skipped_stop += 1
            continue
        zipf, zipf_lemma = aggregate_zipf(word, e.forms)
        homograph = owners.get(word.lower(), -1.0) > zipf_lemma or action == "damp"
        if homograph:
            zipf = max(0.0, zipf - cfg.homograph_penalty)
        sc, rank_sim = score_word(word, e.glosses[:8], cfg)
        boost = tech_boost_for(e, cfg)
        rank_score = zipf * (rank_sim ** cfg.similarity_alpha) * boost
        cands.append(Candidate(
            entry=e, zipf=zipf, zipf_lemma=zipf_lemma,
            freq_linear=word_frequency(word, "fr"),
            similarity=rank_sim, best_english=sc.english,
            tech_boost=boost, rank_score=rank_score, is_homograph=homograph,
            form_mass=form_mass_zipf(word, e.forms),
            is_helvetism=cfg.include_helvetisms and is_helvetism(word),
        ))
    if skipped_stop:
        log(f"  dropped {skipped_stop} grammatical words (articles, pronouns, prepositions)")

    if cfg.one_pos_per_lemma:
        # Pick by inflected-form mass when the two parts of speech are clearly
        # different in usage, otherwise by rank score. Ranking alone chose the
        # Italian lira over the verb "lire" (to read).
        best: dict[str, Candidate] = {}
        for c in cands:
            cur = best.get(c.entry.word)
            if cur is None:
                best[c.entry.word] = c
                continue
            if abs(c.form_mass - cur.form_mass) > cfg.pos_form_mass_gap:
                if c.form_mass > cur.form_mass:
                    best[c.entry.word] = c
            elif c.rank_score > cur.rank_score:
                best[c.entry.word] = c
        cands = list(best.values())
        log(f"  one POS per lemma: {len(cands)} candidates")

    # "Core" = the most frequent words overall. They enter the study order on a
    # quota even when they score badly on similarity, because you cannot read a
    # sentence without them. This must happen BEFORE the cut to max_words:
    # ranking on similarity alone drops "lire", "boire" and "dire" entirely.
    eligible = [c for c in cands if not c.is_homograph]
    for c in sorted(eligible, key=lambda c: c.zipf, reverse=True)[: cfg.core_top_n]:
        c.is_core = True

    cands.sort(key=lambda c: c.rank_score, reverse=True)
    kept = cands[: cfg.max_words]
    kept_keys = {c.key for c in kept}
    rescued = [c for c in cands[cfg.max_words:]
               if (c.is_core or c.is_helvetism) and c.key not in kept_keys]
    if rescued:
        n_core = sum(1 for c in rescued if c.is_core)
        log(f"  rescued {n_core} core words that similarity alone would have cut")
        n_helv = sum(1 for c in rescued if c.is_helvetism and not c.is_core)
        if n_helv:
            log(f"  added {n_helv} Swiss words that the frequency cut would have dropped")
    for c in kept + rescued:
        if c.is_helvetism:
            c.entry.swiss = True
        # For a Swiss word, teach the Swiss meaning first. Wiktionary orders by
        # the France French sense, so "linge" reads "linen" when in Valais it is
        # a towel, and "cornet" reads "cone" when it is a carrier bag.
        if c.entry.swiss and c.entry.swiss_glosses:
            rest = [g for g in c.entry.glosses if g not in c.entry.swiss_glosses]
            c.entry.glosses = c.entry.swiss_glosses + rest
    return kept + rescued


def assign_order(cands: list[Candidate], cfg: Config = DEFAULT) -> list[Candidate]:
    """Interleave core high-frequency words into the cognate-ranked order.

    Pure similarity x frequency puts "le", "pas" and "être" nowhere, which makes
    early progress feel unreal. Each level reserves a quota for core words.
    """
    core = sorted([c for c in cands if c.is_core], key=lambda c: c.zipf, reverse=True)
    by_score = sorted(cands, key=lambda c: c.rank_score, reverse=True)
    per_level_core = max(1, round(cfg.level_size * cfg.core_quota))

    placed: set[tuple[str, str]] = set()
    order: list[Candidate] = []
    ci = si = 0
    while len(order) < len(cands):
        filled = 0
        taken_core = 0
        while taken_core < per_level_core and ci < len(core):
            c = core[ci]; ci += 1
            if c.key in placed:
                continue
            order.append(c); placed.add(c.key); taken_core += 1; filled += 1
        while filled < cfg.level_size and si < len(by_score):
            c = by_score[si]; si += 1
            if c.key in placed:
                continue
            order.append(c); placed.add(c.key); filled += 1
        if filled == 0:
            break
    return order


def write_db(order: list[Candidate], cfg: Config = DEFAULT, db_path=None, log=print) -> None:
    """Upsert the ranking.

    Never DELETE: audio files, per-direction scheduling state and the review log
    hang off word ids, so wiping the table to rebuild the ranking would throw away
    the learner's progress. Words that fall out of the new ranking are marked
    inactive and keep their history.
    """
    con = db.connect(db_path or cfg.paths()["db"])
    seen_ids: set[int] = set()
    with con:
        con.execute("UPDATE words SET active=0")
        for i, c in enumerate(order):
            e = c.entry
            level = i // cfg.level_size + 1
            freq_mass = 10 ** c.zipf / 1e9      # includes the inflected forms
            table = json.dumps(e.conjugation, ensure_ascii=False,
                               separators=(",", ":")) if e.conjugation else None
            row = (display_form(e), type_answer(e, cfg), e.gender, e.ipa, c.zipf,
                   c.zipf_lemma, freq_mass, c.similarity, c.best_english, c.tech_boost,
                   c.rank_score, i + 1, level, int(c.is_core), int(e.swiss), table)
            con.execute(
                """INSERT INTO words (lemma,pos,display_form,type_answer,gender,ipa,zipf,
                       zipf_lemma,freq_linear,similarity,best_english,tech_boost,rank_score,
                       rank,level,is_core,is_swiss,conjugation,active)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                   ON CONFLICT(lemma,pos) DO UPDATE SET
                     display_form=excluded.display_form, type_answer=excluded.type_answer,
                     gender=excluded.gender, ipa=excluded.ipa, zipf=excluded.zipf,
                     zipf_lemma=excluded.zipf_lemma, freq_linear=excluded.freq_linear,
                     similarity=excluded.similarity, best_english=excluded.best_english,
                     tech_boost=excluded.tech_boost, rank_score=excluded.rank_score,
                     rank=excluded.rank, level=excluded.level, is_core=excluded.is_core,
                     is_swiss=excluded.is_swiss, conjugation=excluded.conjugation,
                     active=1""",
                (e.word, e.pos) + row)
            wid = con.execute("SELECT id FROM words WHERE lemma=? AND pos=?",
                              (e.word, e.pos)).fetchone()["id"]
            seen_ids.add(wid)

            con.execute("DELETE FROM translations WHERE word_id=?", (wid,))
            con.executemany(
                "INSERT INTO translations (word_id,english,is_primary,sense_index) VALUES (?,?,?,?)",
                [(wid, g, int(j == 0), j) for j, g in enumerate(e.glosses[:12])])

            # Keep any audio we already fetched; refresh the candidate URL list.
            con.execute("DELETE FROM audio WHERE word_id=? AND path IS NULL", (wid,))
            known = {r["url"] for r in con.execute(
                "SELECT url FROM audio WHERE word_id=?", (wid,))}
            con.executemany(
                "INSERT INTO audio (word_id,url,region,region_rank,source,is_primary) "
                "VALUES (?,?,?,?,?,0)",
                [(wid, a.url, a.region, a.region_rank, a.source)
                 for a in e.audio[:6] if a.url not in known])

            con.execute(
                "INSERT INTO card_state (word_id,direction,unlocked) VALUES (?,?,1) "
                "ON CONFLICT(word_id,direction) DO NOTHING", (wid, DIR_READ))
        db.set_meta(con, "built_at", int(time.time()))
        db.set_meta(con, "word_count", len(order))
        db.set_meta(con, "level_size", cfg.level_size)
    retired = con.execute("SELECT COUNT(*) FROM words WHERE active=0").fetchone()[0]
    log(f"  wrote {len(order)} active words to {db_path or cfg.paths()['db']}"
        + (f" ({retired} retired but kept with their history)" if retired else ""))
    con.close()


def run(cfg: Config = DEFAULT, kaikki_path: Path | None = None, db_path=None, log=print) -> None:
    log("Building French cognate database")
    cands = build_candidates(kaikki_path or KAIKKI_PATH, cfg, log=log)
    order = assign_order(cands, cfg)
    write_db(order, cfg, db_path, log=log)
