"""The commands, and the two names the app and the pipeline share.

Nothing here runs a pipeline stage: these are the wiring — that every command
in the README is registered, that its options parse, and that the clip a word
is exported with is the file the audio step wrote.
"""
import argparse

import pytest

from frcog import audio, cli, webexport
from frcog.config import DEFAULT


COMMANDS = ["refresh", "fetch", "build", "definitions", "dictionary", "sentences", "audio", "stats",
            "top", "app", "import-app"]


@pytest.mark.parametrize("name", COMMANDS)
def test_every_command_is_registered_and_knows_what_to_run(name, capsys):
    with pytest.raises(SystemExit) as exit:
        cli.main([name, "--help"])
    assert exit.value.code == 0
    assert name in capsys.readouterr().out


def test_a_command_that_does_not_exist_is_refused_rather_than_guessed(capsys):
    with pytest.raises(SystemExit) as exit:
        cli.main(["fetchh"])
    assert exit.value.code != 0


def test_all_is_gone_because_refresh_is_what_it_meant():
    """`frcog all` ran every stage from nothing; `frcog refresh` runs the
    stages the recipe says are out of date, which from nothing is every one."""
    with pytest.raises(SystemExit) as exit:
        cli.main(["all"])
    assert exit.value.code != 0


def test_no_command_at_all_is_an_error_rather_than_a_default():
    with pytest.raises(SystemExit) as exit:
        cli.main([])
    assert exit.value.code != 0


def test_a_dial_on_the_front_reaches_the_config_it_names():
    """`--top-n 100` has to land on Config, or the flag is decoration."""
    args = argparse.Namespace(top_n=100, max_words=None, level_size=25,
                              tts_voice="fr-CH-FabriceNeural", english_voice=None)
    cfg = cli._cfg(args)
    assert cfg.top_n == 100
    assert cfg.level_size == 25
    assert cfg.tts_voice == "fr-CH-FabriceNeural"
    assert cfg.max_words == DEFAULT.max_words, "a flag not given changes nothing"
    assert cfg.english_voice == DEFAULT.english_voice


def test_a_clip_is_named_after_the_word_it_says_on_both_sides():
    """The catalogue stores the file name and the app fetches /media/<name>;
    if these two ever disagree the card is silent and nothing says why."""
    assert audio.tts_filename(1234) == "frcog-1234.mp3"
    assert audio.human_filename(1234) == "frcog-1234-native.mp3"
    assert audio.tts_filename(1) != audio.human_filename(1)
    assert webexport.word_key("bug", "noun") == "bug|noun"
