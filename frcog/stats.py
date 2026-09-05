"""Progress reporting from the app's own review history.

The app is the learning platform and owns scheduling. It exports its progress,
`frcog import-app` merges it here, and this module turns it into the one number
worth watching: the share of running French text you can read.
"""
from __future__ import annotations

import sqlite3
import time

from .config import DEFAULT, DIRECTION_LABELS, DIR_READ, Config

MATURE_IVL = 21          # days before a word counts as known


def coverage(con: sqlite3.Connection) -> dict:
    """Share of running French text covered, by how well the word is known."""
    mature = con.execute(
        """SELECT COALESCE(SUM(w.freq_linear),0) FROM words w
           JOIN card_state c ON c.word_id=w.id AND c.direction=?
           WHERE w.active=1 AND c.ivl >= ?""", (DIR_READ, MATURE_IVL)).fetchone()[0]
    seen = con.execute(
        """SELECT COALESCE(SUM(w.freq_linear),0) FROM words w
           JOIN card_state c ON c.word_id=w.id AND c.direction=?
           WHERE w.active=1 AND c.reps > 0""", (DIR_READ,)).fetchone()[0]
    ceiling = con.execute(
        "SELECT COALESCE(SUM(freq_linear),0) FROM words WHERE active=1").fetchone()[0]
    return {"text_coverage_mature": mature, "text_coverage_seen": seen,
            "deck_ceiling": ceiling}


def summary(con: sqlite3.Connection, cfg: Config = DEFAULT) -> dict:
    words = con.execute("SELECT COUNT(*) FROM words WHERE active=1").fetchone()[0]
    per_dir = {}
    for d, label in DIRECTION_LABELS.items():
        row = con.execute(
            """SELECT COUNT(*) n,
                      SUM(CASE WHEN c.ivl >= ? THEN 1 ELSE 0 END) mature,
                      SUM(CASE WHEN c.reps > 0 THEN 1 ELSE 0 END) started
               FROM card_state c JOIN words w ON w.id = c.word_id
               WHERE w.active = 1 AND c.direction = ?""",
            (MATURE_IVL, d)).fetchone()
        per_dir[d] = {"label": label, "cards": row["n"] or 0,
                      "mature": row["mature"] or 0, "started": row["started"] or 0}

    levels = [dict(r) for r in con.execute(
        """SELECT w.level,
                  COUNT(*) total,
                  SUM(CASE WHEN c.ivl >= ? THEN 1 ELSE 0 END) mature,
                  SUM(CASE WHEN c.reps > 0 THEN 1 ELSE 0 END) started
           FROM words w LEFT JOIN card_state c
             ON c.word_id=w.id AND c.direction=?
           WHERE w.active=1
           GROUP BY w.level ORDER BY w.level""", (MATURE_IVL, DIR_READ))]

    reviews = con.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    day_ago = int(time.time()) - 86400
    recent = con.execute("SELECT COUNT(*) FROM reviews WHERE ts > ?", (day_ago,)).fetchone()[0]
    return {"words": words, "directions": per_dir, "levels": levels,
            "reviews": reviews, "reviews_24h": recent, **coverage(con)}


def format_summary(s: dict) -> str:
    out = ["Progress", ""]
    out.append(f"  You know {s['text_coverage_mature'] * 100:.2f}% of running French text "
               f"(seen {s['text_coverage_seen'] * 100:.2f}%, "
               f"this catalogue reaches {s['deck_ceiling'] * 100:.2f}%)")
    out.append(f"  {s['reviews']} reviews recorded, {s['reviews_24h']} in the last 24h")
    out.append("")
    out.append("  Direction               cards   started   mature")
    for d in s["directions"].values():
        out.append(f"  {d['label']:<20} {d['cards']:>8}  {d['started']:>8} {d['mature']:>8}")
    done = [l for l in s["levels"] if l["total"] and l["mature"] == l["total"]]
    started = [l for l in s["levels"] if l["started"]]
    out.append("")
    out.append(f"  Levels finished: {len(done)} of {len(s['levels'])}"
               f"   (in progress: {len(started) - len(done)})")
    return "\n".join(out)
