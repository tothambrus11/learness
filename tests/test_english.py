from frcog.english import cue_text, english_filename, short_translations


def test_cue_is_one_sense_not_the_whole_gloss():
    assert cue_text(["to have; to own; to possess; to get", "must"]) == "to have"
    assert cue_text(["to be"]) == "to be"
    assert cue_text([]) == ""


def test_cue_uses_the_primary_translation_after_filtering():
    # A long grammar note is dropped, so the cue comes from a real translation.
    trs = ["x" * 60, "the table", "the board"]
    assert cue_text(short_translations(trs)) == "the table"


def test_english_clip_sits_beside_the_french_ones():
    assert english_filename(12) == "frcog-12-en.mp3"
