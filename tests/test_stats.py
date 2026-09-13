"""What `frcog stats` reports.

The headline is a share of running French text, not a count of cards, which is
the same promise the app's home screen makes. A word counts once its reading
card is mature; a word merely seen counts towards the second number only.
"""
import sqlite3

import pytest

from frcog.config import DIR_READ
from frcog.db import connect
from frcog.stats import MATURE_IVL, coverage, format_summary, summary


@pytest.fixture()
def con(tmp_path) -> sqlite3.Connection:
    c = connect(tmp_path / "stats.db")
    with c:
        for i, (lemma, mass, level) in enumerate(
                [("jour", 0.004, 1), ("nation", 0.001, 1), ("galetas", 0.0001, 2)], start=1):
            c.execute(
                """INSERT INTO words (id, lemma, pos, display_form, type_answer,
                     freq_linear, rank, level, active)
                   VALUES (?,?,'noun',?,?,?,?,?,1)""",
                (i, lemma, f"le {lemma}", f"le {lemma}", mass, i, level))
        # jour is known, nation has been met, galetas has never been dealt.
        c.execute("INSERT INTO card_state (word_id, direction, unlocked, reps, ivl) "
                  "VALUES (1,?,1,6,?)", (DIR_READ, MATURE_IVL + 5))
        c.execute("INSERT INTO card_state (word_id, direction, unlocked, reps, ivl) "
                  "VALUES (2,?,1,1,1)", (DIR_READ,))
        c.execute("INSERT INTO reviews (word_id, direction, ts, rating) VALUES (1,?,1,3)",
                  (DIR_READ,))
    return c


def test_coverage_is_a_share_of_text_and_counts_a_word_only_once_it_is_known(con):
    c = coverage(con)
    assert c["text_coverage_mature"] == pytest.approx(0.004), "jour alone"
    assert c["text_coverage_seen"] == pytest.approx(0.005), "and nation, which has been met"
    assert c["deck_ceiling"] == pytest.approx(0.0051), "every active word, known or not"
    assert c["text_coverage_mature"] <= c["text_coverage_seen"] <= c["deck_ceiling"]


def test_the_summary_counts_the_deck_and_the_work_done(con):
    s = summary(con)
    assert s["words"] == 3
    assert s["reviews"] == 1
    assert [l["level"] for l in s["levels"]] == [1, 2]
    read = s["directions"][DIR_READ]
    assert (read["cards"], read["started"], read["mature"]) == (2, 2, 1)


def test_the_report_reads_as_sentences(con):
    text = format_summary(summary(con))
    assert "You know 0.40% of running French text" in text
    assert "1 reviews recorded" in text
    assert "Levels finished: 0 of 2" in text
