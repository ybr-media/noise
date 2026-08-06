"""Extract Audacity-rendered PCM from an ``.aup3`` into stereo WAV.

This module deliberately performs no DSP.  Audacity owns generation, effects,
mixing, normalization, and fades; this code only follows the final project's
document references, reads float32 sample blocks, and serializes them.

The project document may be supplied as readable XML, or decoded directly
from Audacity's semi-self-describing project blobs.
"""

from __future__ import annotations

import argparse
import sqlite3
import struct
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

FLOAT32_SAMPLE_FORMAT = 262159


class _BinaryXML:
    """Small decoder for Audacity's documented field-op binary XML."""

    CHAR_SIZE = 0
    START_TAG = 1
    END_TAG = 2
    STRING = 3
    INT = 4
    BOOL = 5
    LONG = 6
    LONG_LONG = 7
    SIZE_T = 8
    FLOAT = 9
    DOUBLE = 10
    DATA = 11
    RAW = 12
    PUSH = 13
    POP = 14
    NAME = 15

    def __init__(self, dictionary: bytes, document: bytes) -> None:
        self.data = dictionary + document
        self.offset = 0
        self.char_size = 0
        self.names: dict[int, str] = {}

    def _read(self, fmt: str) -> int | float:
        size = struct.calcsize(fmt)
        if self.offset + size > len(self.data):
            raise Aup3Error("truncated binary XML")
        value = struct.unpack_from(fmt, self.data, self.offset)[0]
        self.offset += size
        return value

    def _string(self, wide_length: bool) -> str:
        length = int(self._read("<I" if wide_length else "<H"))
        size = length
        if self.offset + size > len(self.data):
            raise Aup3Error("truncated binary XML string")
        raw = self.data[self.offset : self.offset + size]
        self.offset += size
        try:
            return raw.decode({1: "utf-8", 2: "utf-16-le", 4: "utf-32-le"}[self.char_size])
        except (KeyError, UnicodeDecodeError) as exc:
            raise Aup3Error("invalid binary XML string") from exc

    def _name(self, identifier: int) -> str:
        try:
            return self.names[identifier]
        except KeyError as exc:
            raise Aup3Error(f"binary XML references unknown name {identifier}") from exc

    @staticmethod
    def _xml_value(value: object) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, float):
            return repr(value)
        return str(value)

    def decode(self) -> str:
        output: list[str] = []
        pending: list[tuple[str, object]] = []
        stack: list[str] = []
        current_tag: str | None = None

        def flush_start() -> None:
            nonlocal current_tag
            if current_tag is None:
                return
            output.append("<" + current_tag)
            for key, value in pending:
                output.append(f' {key}="{self._xml_value(value)}"')
            pending.clear()
            output.append(">")
            stack.append(current_tag)
            current_tag = None

        while self.offset < len(self.data):
            opcode = int(self._read("<B"))
            if opcode == self.CHAR_SIZE:
                self.char_size = int(self._read("<B"))
            elif opcode == self.NAME:
                identifier = int(self._read("<H"))
                self.names[identifier] = self._string(False)
            elif opcode == self.DATA:
                flush_start()
                output.append(self._string(True))
            elif opcode == self.RAW:
                self._string(True)
            elif opcode in (self.PUSH, self.POP):
                pass
            elif opcode in (self.STRING, self.INT, self.BOOL, self.LONG, self.LONG_LONG, self.SIZE_T,
                            self.FLOAT, self.DOUBLE):
                identifier = int(self._read("<H"))
                if opcode == self.STRING:
                    value = self._string(True)
                elif opcode in (self.INT, self.LONG):
                    value = self._read("<i")
                elif opcode == self.BOOL:
                    value = bool(self._read("<B"))
                elif opcode == self.LONG_LONG:
                    value = self._read("<q")
                elif opcode == self.SIZE_T:
                    value = self._read("<I")
                elif opcode == self.FLOAT:
                    value = self._read("<f")
                    self._read("<I")  # display precision
                else:
                    value = self._read("<d")
                    self._read("<I")  # display precision
                pending.append((self._name(identifier), value))
            elif opcode == self.START_TAG:
                flush_start()
                current_tag = self._name(int(self._read("<H")))
            elif opcode == self.END_TAG:
                flush_start()
                name = self._name(int(self._read("<H")))
                if not stack or stack[-1] != name:
                    raise Aup3Error(f"binary XML tag mismatch: {name}")
                stack.pop()
                output.append(f"</{name}>")
            else:
                raise Aup3Error(f"unsupported binary XML opcode {opcode}")
        if current_tag is not None:
            flush_start()
            name = stack.pop()
            output.append(f"</{name}>")
        if pending or stack:
            raise Aup3Error(
                f"incomplete binary XML document at {self.offset}: "
                f"{len(stack)} open tags, {len(pending)} pending attributes"
            )
        return "".join(output)


def decode_project_xml(project_path: Path, table: str = "project") -> str:
    """Decode Audacity's project/document blobs into readable XML."""
    if table not in {"project", "autosave"}:
        raise Aup3Error(f"unsupported project table: {table}")
    with sqlite3.connect(project_path) as db:
        row = db.execute(f"SELECT dict, doc FROM {table} WHERE id = 1").fetchone()
    if row is None:
        raise Aup3Error(f"{table} table has no project row")
    return _BinaryXML(bytes(row[0]), bytes(row[1])).decode()


class Aup3Error(ValueError):
    """Raised when project metadata or referenced PCM is invalid."""


@dataclass(frozen=True)
class WaveBlock:
    start: int
    block_id: int


@dataclass(frozen=True)
class Sequence:
    num_samples: int
    sample_format: int
    blocks: tuple[WaveBlock, ...]


@dataclass(frozen=True)
class Clip:
    offset: float
    trim_left: int
    trim_right: int
    sequences: tuple[Sequence, ...]


@dataclass(frozen=True)
class Track:
    rate: int
    clips: tuple[Clip, ...]
    channel: int | None = None


def _number(element: ET.Element, name: str, default: str | None = None) -> str:
    value = element.attrib.get(name)
    if value is None:
        value = next(
            (candidate for key, candidate in element.attrib.items() if key.lower() == name.lower()),
            default,
        )
    if value is None:
        raise Aup3Error(f"{element.tag}: missing {name}")
    return value


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if child.tag.rsplit("}", 1)[-1] == name]


def parse_project_xml(xml_text: str) -> tuple[Track, ...]:
    """Parse readable Audacity project XML without decoding binary XML."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise Aup3Error(f"invalid project XML: {exc}") from exc

    tracks: list[Track] = []
    for track_node in root.iter():
        if track_node.tag.rsplit("}", 1)[-1] != "wavetrack":
            continue
        rate = int(float(_number(track_node, "rate")))
        clips: list[Clip] = []
        for clip_node in _children(track_node, "waveclip"):
            sequences: list[Sequence] = []
            for sequence_node in _children(clip_node, "sequence"):
                blocks = tuple(
                    WaveBlock(
                        int(_number(block_node, "start")),
                        int(_number(block_node, "blockid")),
                    )
                    for block_node in _children(sequence_node, "waveblock")
                )
                sequences.append(
                    Sequence(
                        int(_number(sequence_node, "numsamples")),
                        int(_number(sequence_node, "sampleformat")),
                        blocks,
                    )
                )
            clips.append(
                Clip(
                    float(_number(clip_node, "offset", "0")),
                    round(float(_number(clip_node, "trimleft", "0")) * rate),
                    round(float(_number(clip_node, "trimright", "0")) * rate),
                    tuple(sequences),
                )
            )
        channel = track_node.attrib.get("channel")
        tracks.append(Track(rate, tuple(clips), int(channel) if channel is not None else None))
    if not tracks:
        raise Aup3Error("project XML contains no wavetrack")
    return tuple(tracks)


def _read_block(db: sqlite3.Connection, block_id: int, length: int) -> np.ndarray:
    if length < 0:
        raise Aup3Error(f"negative block length: {length}")
    if block_id <= 0:
        silent_length = -block_id
        if silent_length != length:
            raise Aup3Error(
                f"silent block {block_id} spans {length} samples, expected {silent_length}"
            )
        return np.zeros(silent_length, dtype=np.float32)
    row = db.execute(
        "SELECT sampleformat, samples FROM sampleblocks WHERE blockid = ?",
        (block_id,),
    ).fetchone()
    if row is None:
        raise Aup3Error(f"referenced sampleblock {block_id} is missing")
    sample_format, blob = row
    if sample_format != FLOAT32_SAMPLE_FORMAT:
        raise Aup3Error(f"sampleblock {block_id} is not float32: {sample_format}")
    values = np.frombuffer(blob, dtype="<f4")
    if values.size < length:
        raise Aup3Error(
            f"sampleblock {block_id} has {values.size} samples, needs {length}"
        )
    return values[:length].copy()


def _sequence_samples(db: sqlite3.Connection, sequence: Sequence) -> np.ndarray:
    if sequence.sample_format != FLOAT32_SAMPLE_FORMAT:
        raise Aup3Error(f"sequence is not float32: {sequence.sample_format}")
    blocks = sorted(sequence.blocks, key=lambda block: block.start)
    if not blocks:
        return np.zeros(sequence.num_samples, dtype=np.float32)
    pieces: list[np.ndarray] = []
    for index, block in enumerate(blocks):
        next_start = (
            blocks[index + 1].start
            if index + 1 < len(blocks)
            else sequence.num_samples
        )
        if block.start < 0 or next_start < block.start:
            raise Aup3Error("invalid waveblock offsets")
        pieces.append(_read_block(db, block.block_id, next_start - block.start))
    values = np.concatenate(pieces)
    if values.size != sequence.num_samples:
        raise Aup3Error(
            f"sequence resolves to {values.size} samples, expected {sequence.num_samples}"
        )
    return values


def _clip_channel_samples(
    db: sqlite3.Connection, clip: Clip, sequence_index: int, rate: int
) -> tuple[int, np.ndarray]:
    if sequence_index >= len(clip.sequences):
        raise Aup3Error("clip is missing a requested channel sequence")
    sequence = clip.sequences[sequence_index]
    values = _sequence_samples(db, sequence)
    end = sequence.num_samples - clip.trim_right
    if clip.trim_left < 0 or end < clip.trim_left:
        raise Aup3Error("invalid clip trims")
    start = round(clip.offset * rate) - clip.trim_left
    return start, values[clip.trim_left:end]


def extract_track(project_path: Path, project_xml: str, track_index: int = 0) -> tuple[np.ndarray, int]:
    """Extract one final stereo track, returning samples and its sample rate."""
    tracks = parse_project_xml(project_xml)
    try:
        track = tracks[track_index]
    except IndexError as exc:
        raise Aup3Error(f"track index out of range: {track_index}") from exc
    if track.rate <= 0:
        raise Aup3Error("track rate must be positive")
    if all(len(clip.sequences) == 2 for clip in track.clips):
        channel_tracks = (track, track)
        sequence_indexes = (0, 1)
    elif all(len(clip.sequences) == 1 for clip in track.clips):
        partner = next(
            (
                candidate
                for candidate in tracks
                if candidate is not track
                and candidate.rate == track.rate
                and len(candidate.clips) == len(track.clips)
                and all(len(clip.sequences) == 1 for clip in candidate.clips)
                and candidate.channel == 1
            ),
            None,
        )
        if partner is None:
            raise Aup3Error("final track does not have a stereo partner")
        channel_tracks = (track, partner)
        sequence_indexes = (0, 0)
    else:
        raise Aup3Error("unsupported final track sequence layout")
    with sqlite3.connect(project_path) as db:
        clips = []
        for left_clip, right_clip in zip(channel_tracks[0].clips, channel_tracks[1].clips):
            if (left_clip.offset, left_clip.trim_left, left_clip.trim_right) != (
                right_clip.offset,
                right_clip.trim_left,
                right_clip.trim_right,
            ):
                raise Aup3Error("stereo channel clip metadata differs")
            left_start, left = _clip_channel_samples(
                db, left_clip, sequence_indexes[0], track.rate
            )
            right_start, right = _clip_channel_samples(
                db, right_clip, sequence_indexes[1], track.rate
            )
            if left_start != right_start or left.size != right.size:
                raise Aup3Error("stereo channel clip lengths differ")
            clips.append((left_start, np.column_stack((left, right))))
    if not clips:
        raise Aup3Error("selected track contains no clips")
    origin = min(start for start, _ in clips)
    finish = max(start + values.shape[0] for start, values in clips)
    output = np.zeros((finish - origin, 2), dtype=np.float32)
    occupied = np.zeros(finish - origin, dtype=bool)
    for start, values in clips:
        left = start - origin
        right = left + values.shape[0]
        if occupied[left:right].any():
            raise Aup3Error("overlapping clips are ambiguous")
        output[left:right] = values
        occupied[left:right] = True
    return output, track.rate


def write_wav(samples: np.ndarray, rate: int, output_path: Path) -> None:
    """Write extracted samples as the required 48 kHz/24-bit stereo WAV."""
    if samples.ndim != 2 or samples.shape[1] != 2:
        raise Aup3Error("output must be a stereo sample matrix")
    if rate != 48000:
        raise Aup3Error(f"expected 48000 Hz, got {rate}")
    sf.write(output_path, samples, rate, format="WAV", subtype="PCM_24")
    with sf.SoundFile(output_path) as info:
        if (info.samplerate, info.channels, info.subtype) != (48000, 2, "PCM_24"):
            raise Aup3Error("written WAV does not have required format")


def extract_to_wav(
    project_path: Path,
    project_xml_path: Path | None,
    output_path: Path,
    track_index: int = 0,
) -> None:
    project_xml = (
        project_xml_path.read_text()
        if project_xml_path is not None
        else decode_project_xml(project_path)
    )
    samples, rate = extract_track(project_path, project_xml, track_index)
    write_wav(samples, rate, output_path)


def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("project_xml", type=Path, nargs="?")
    parser.add_argument("output", type=Path)
    parser.add_argument("--track", type=int, default=0)
    args = parser.parse_args()
    extract_to_wav(args.project, args.project_xml, args.output, args.track)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
