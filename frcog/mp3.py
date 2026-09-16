"""Cutting an mp3 at its frames, without decoding it.

An mp3 is a run of frames, each a few tens of milliseconds, each starting
with a four-byte header that says how long it is. Silence at either end of a
clip is whole frames of nothing, so it can be cut off by dropping frames from
each end and writing the rest back out, byte for byte — no decode, no second
encode, no loss (#68). ffmpeg would re-encode; every clip has been through
libmp3lame once already for its padding, and twice is a step down at 48 kb/s.

What is kept: the ID3v2 tag at the front, and the frames between the cuts.
What is dropped: the LAME "Info" frame that ffmpeg puts first, since it
counts the frames that follow and would count wrong, and it is silent.
Dropping the first real frames leaves the first kept frame without the bit
reservoir it may have borrowed from them; a decoder plays that as silence
or near it, and since a margin of silence is kept before the speech starts,
it is never heard.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

# Bitrates in kb/s by version (1 for MPEG-1, 2 for MPEG-2 and 2.5) and index.
_BITRATE = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
# Sample rates by the header's version bits (3 = MPEG-1, 2 = MPEG-2, 0 = 2.5).
_SAMPLE_RATE = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


@dataclass(frozen=True)
class Frame:
    """One frame: where it starts, how many bytes it is, how long it plays."""
    at: int
    size: int
    ms: float
    info: bool   # a LAME/Xing "Info" frame, which carries no sound


def _header(data: bytes, at: int) -> tuple[int, float] | None:
    """The frame length in bytes and its duration in ms, if a Layer III
    frame starts at `at`; None where the bytes are not a frame header."""
    if at + 4 > len(data):
        return None
    h = struct.unpack(">I", data[at:at + 4])[0]
    if (h >> 21) & 0x7FF != 0x7FF:
        return None
    version = (h >> 19) & 3
    layer = (h >> 17) & 3
    bitrate_index = (h >> 12) & 15
    rate_index = (h >> 10) & 3
    padding = (h >> 9) & 1
    if version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
        return None
    v = 1 if version == 3 else 2
    kbps = _BITRATE[v][bitrate_index]
    rate = _SAMPLE_RATE[version][rate_index]
    size = (144000 if v == 1 else 72000) * kbps // rate + padding
    samples = 1152 if v == 1 else 576
    return size, samples / rate * 1000


def id3v2_length(data: bytes) -> int:
    """How many bytes the ID3v2 tag at the front takes, 0 when there is none."""
    if data[:3] != b"ID3" or len(data) < 10:
        return 0
    size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
    return 10 + size


def frames(data: bytes) -> list[Frame]:
    """Every frame in the file, in order. Bytes that are not a frame — a tag,
    junk between frames — are stepped over; a file with no frames is []."""
    out: list[Frame] = []
    at = id3v2_length(data)
    while at + 4 <= len(data):
        got = _header(data, at)
        if got is None:
            at += 1
            continue
        size, ms = got
        if at + size > len(data):
            break                              # a truncated last frame is not a frame
        body = data[at + 4:at + size]
        info = not out and (b"Xing" in body or b"Info" in body)
        out.append(Frame(at, size, ms, info))
        at += size
    return out


def cut(data: bytes, drop_lead_ms: float, drop_tail_ms: float) -> bytes | None:
    """The file with up to `drop_lead_ms` cut from the front and `drop_tail_ms`
    from the back, in whole frames — never more than asked, so the margin
    the caller keeps is at least what it meant. None when there is nothing
    to cut, or nothing left after cutting, or the file has no frames."""
    fs = [f for f in frames(data) if not f.info]
    if not fs:
        return None
    lead = 0
    dropped = 0.0
    while lead < len(fs) and dropped + fs[lead].ms <= drop_lead_ms:
        dropped += fs[lead].ms
        lead += 1
    tail = len(fs)
    dropped = 0.0
    while tail > lead and dropped + fs[tail - 1].ms <= drop_tail_ms:
        dropped += fs[tail - 1].ms
        tail -= 1
    if lead == 0 and tail == len(fs):
        return None
    if lead >= tail:
        return None
    kept = fs[lead:tail]
    head = data[:id3v2_length(data)]
    return head + b"".join(data[f.at:f.at + f.size] for f in kept)


def duration_ms(data: bytes) -> float:
    """How long the sound runs, from the frames alone."""
    return sum(f.ms for f in frames(data) if not f.info)
