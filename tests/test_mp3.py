"""Cutting silence off a clip without decoding it (#68).

An mp3 is frames, and each end of a clip is whole frames of silence, so the
cut is a matter of dropping frames and writing the rest back out. No ffmpeg
here: the frames are made by hand, headers and all, which is all the cutter
reads.
"""
from __future__ import annotations

import struct

from frcog import mp3


def frame(version: int = 2, kbps_index: int = 8, rate_index: int = 1, padding: int = 0,
          fill: int = 0x11) -> bytes:
    """One Layer III frame with a valid header and a body of `fill` bytes.
    The defaults are edge-tts's: MPEG-2, 64 kb/s, 24 kHz, 192 bytes, 24 ms."""
    bits = (0x7FF << 21) | (version << 19) | (1 << 17) | (kbps_index << 12) \
        | (rate_index << 10) | (padding << 9)
    head = struct.pack(">I", bits)
    size, _ = mp3._header(head, 0)
    return head + bytes([fill]) * (size - 4)


def id3(n: int = 35) -> bytes:
    return b"ID3\x04\x00\x00" + bytes([0, 0, 0, n]) + b"\x00" * n


def info_frame() -> bytes:
    f = bytearray(frame(fill=0))
    f[4 + 21:4 + 25] = b"Info"
    return bytes(f)


def test_every_frame_is_found_and_the_tag_is_stepped_over():
    data = id3() + info_frame() + frame() * 10
    fs = mp3.frames(data)
    assert len(fs) == 11
    assert fs[0].info and not fs[1].info
    assert fs[1].at == len(id3()) + 192 and fs[1].size == 192 and fs[1].ms == 24.0
    assert mp3.duration_ms(data) == 240.0


def test_the_cut_drops_whole_frames_from_each_end_and_keeps_the_tag():
    data = id3() + info_frame() + bytes().join(frame(fill=i) for i in range(1, 11))
    out = mp3.cut(data, drop_lead_ms=50, drop_tail_ms=100)
    assert out is not None
    assert out.startswith(id3())
    fs = mp3.frames(out)
    assert [f.info for f in fs] == [False] * len(fs), "the Info frame goes: it would count wrong"
    # 50 ms is two 24 ms frames, not three; 100 ms is four.
    assert len(fs) == 10 - 2 - 4
    assert out[len(id3()) + 4] == 3, "the first kept frame is the third"
    assert out[-1] == 6, "the last kept frame is the sixth"


def test_nothing_to_cut_is_nothing_written():
    data = id3() + frame() * 5
    assert mp3.cut(data, 10, 10) is None, "less than a frame at each end"
    assert mp3.cut(data, 0, 0) is None
    assert mp3.cut(b"not an mp3 at all", 100, 100) is None


def test_a_clip_is_never_cut_to_nothing():
    data = frame() * 4
    assert mp3.cut(data, 1000, 1000) is None, "everything asked off: leave it be"
    out = mp3.cut(data, 48, 24)
    assert out is not None and len(mp3.frames(out)) == 1


def test_mpeg1_frames_are_measured_by_their_own_rule():
    # 44.1 kHz, 128 kb/s, MPEG-1: 417 bytes, 1152 samples, 26.12 ms — Lingua Libre's shape.
    f = frame(version=3, kbps_index=9, rate_index=0)
    assert len(f) == 417
    fs = mp3.frames(f * 3 + frame(version=3, kbps_index=9, rate_index=0, padding=1))
    assert [x.size for x in fs] == [417, 417, 417, 418]
    assert round(fs[0].ms, 2) == 26.12
