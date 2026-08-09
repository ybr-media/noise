"""Extract Audacity-rendered PCM from an ``.aup3`` into stereo WAV.

This module deliberately performs no DSP.  Audacity owns generation, effects,
mixing, normalization, and fades; this code only follows the final project's
document references, reads float32 sample blocks, and serializes them.

The project document may be supplied as readable XML, or decoded directly
from Audacity's semi-self-describing project blobs.
"""

from __future__ import annotations

import argparse
import html
import sqlite3
import struct
import xml.etree.ElementTree as ET
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

FLOAT32_SAMPLE_FORMAT = 262159


class _BinaryXML:
    """Strict decoder for Audacity's documented field-op binary XML."""

    CHAR_SIZE, START_TAG, END_TAG = 0, 1, 2
    STRING, INT, BOOL, LONG = 3, 4, 5, 6
    LONG_LONG, SIZE_T, FLOAT, DOUBLE = 7, 8, 9, 10
    DATA, RAW, PUSH, POP, NAME = 11, 12, 13, 14, 15

    def __init__(self, dictionary: bytes, document: bytes) -> None:
        self.dictionary = dictionary
        self.document = document
        self.char_size = 0
        self.names: dict[int, str] = {}
        self._parse_dictionary()

    @staticmethod
    def _read(blob: bytes, offset: int, fmt: str) -> tuple[int | float, int]:
        size = struct.calcsize(fmt)
        if offset + size > len(blob):
            raise Aup3Error("truncated binary XML")
        return struct.unpack_from(fmt, blob, offset)[0], offset + size

    def _decode_text(self, raw: bytes) -> str:
        try:
            return raw.decode({1: "utf-8", 2: "utf-16-le", 4: "utf-32-le"}[self.char_size])
        except (KeyError, UnicodeDecodeError) as exc:
            raise Aup3Error("invalid binary XML string") from exc

    def _read_text(self, blob: bytes, offset: int, length_fmt: str) -> tuple[str, int]:
        length, offset = self._read(blob, offset, length_fmt)
        length = int(length)
        if length < 0 or offset + length > len(blob):
            raise Aup3Error("truncated binary XML string")
        return self._decode_text(blob[offset : offset + length]), offset + length

    def _parse_dictionary(self) -> None:
        token, offset = self._read(self.dictionary, 0, "<B")
        if token != self.CHAR_SIZE:
            raise Aup3Error("dictionary must start with FT_CharSize")
        self.char_size, offset = self._read(self.dictionary, offset, "<B")
        self.char_size = int(self.char_size)
        if self.char_size not in {1, 2, 4}:
            raise Aup3Error(f"invalid binary XML character size: {self.char_size}")
        while offset < len(self.dictionary):
            token, offset = self._read(self.dictionary, offset, "<B")
            if token != self.NAME:
                raise Aup3Error(f"unexpected dictionary token {token}")
            identifier, offset = self._read(self.dictionary, offset, "<H")
            name, offset = self._read_text(self.dictionary, offset, "<H")
            identifier = int(identifier)
            if identifier in self.names:
                raise Aup3Error(f"duplicate binary XML name {identifier}")
            self.names[identifier] = name

    @staticmethod
    def _xml_value(value: object) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        return html.escape(repr(value) if isinstance(value, float) else str(value), quote=True)

    @staticmethod
    def _check_attribute_type(name: str, opcode: int, parent: str | None) -> None:
        expected: dict[str, set[int]] = {
            "start": {7}, "numsamples": {7}, "blockid": {7},
            "offset": {10}, "trimleft": {10}, "trimright": {10},
            "maxsamples": {8}, "effectivesampleformat": {8},
            "rate": {10}, "volume": {10}, "pan": {10},
        }
        allowed = ({8} if parent == "sequence" else {4, 6, 8}) if name == "sampleformat" else expected.get(name)
        if allowed is not None and opcode not in allowed:
            raise Aup3Error(f"binary XML attribute {name} has token {opcode}, expected {sorted(allowed)}")

    def decode(self) -> str:
        blob, offset = self.document, 0
        output: list[str] = []
        pending: list[tuple[str, object]] = []
        tags: list[str] = []
        scopes: list[dict[int, str]] = []
        identifiers = self.names.copy()
        scoped_names = False
        current_tag: str | None = None
        saw_root = saw_non_raw = False
        first_record = True

        def name(identifier: int) -> str:
            try:
                return identifiers[identifier]
            except KeyError as exc:
                raise Aup3Error(f"binary XML references unknown name {identifier}") from exc

        def flush_start() -> None:
            nonlocal current_tag, saw_root
            if current_tag is None:
                return
            if not saw_root:
                if current_tag != "project":
                    raise Aup3Error("binary XML root is not project")
                saw_root = True
            output.append("<" + current_tag)
            for key, value in pending:
                output.append(f' {key}="{self._xml_value(value)}"')
            pending.clear()
            output.append(">")
            tags.append(current_tag)
            current_tag = None

        while offset < len(blob):
            opcode, offset = self._read(blob, offset, "<B")
            opcode = int(opcode)
            if opcode not in range(16):
                raise Aup3Error(f"unsupported binary XML opcode {opcode}")
            if opcode == self.CHAR_SIZE:
                raise Aup3Error("FT_CharSize is only valid at dictionary start")
            if opcode == self.NAME:
                if not scoped_names:
                    raise Aup3Error("inline FT_Name is not valid in document stream")
                identifier, offset = self._read(blob, offset, "<H")
                scoped_name, offset = self._read_text(blob, offset, "<H")
                identifiers[int(identifier)] = scoped_name
                continue
            if opcode == self.RAW:
                _, offset = self._read_text(blob, offset, "<i")
                if saw_non_raw:
                    raise Aup3Error("FT_Raw is only valid before the document root")
                continue
            if opcode == self.PUSH:
                if first_record:
                    raise Aup3Error("document must begin with FT_StartTag after FT_Raw")
                scopes.append(identifiers)
                identifiers = {}
                scoped_names = True
                continue
            if opcode == self.POP:
                if first_record:
                    raise Aup3Error("document must begin with FT_StartTag after FT_Raw")
                if not scopes:
                    raise Aup3Error("binary XML scope stack underflow")
                identifiers = scopes.pop()
                scoped_names = bool(scopes)
                continue
            if first_record and opcode != self.START_TAG:
                raise Aup3Error("document must begin with FT_StartTag after FT_Raw")
            first_record = False
            saw_non_raw = True
            if opcode == self.DATA:
                flush_start()
                value, offset = self._read_text(blob, offset, "<i")
                output.append(html.escape(value))
                continue
            if opcode == self.START_TAG:
                flush_start()
                identifier, offset = self._read(blob, offset, "<H")
                current_tag = name(int(identifier))
                continue
            if opcode == self.END_TAG:
                flush_start()
                identifier, offset = self._read(blob, offset, "<H")
                tag = name(int(identifier))
                if not tags or tags[-1] != tag:
                    raise Aup3Error(f"binary XML tag mismatch: {tag}")
                tags.pop()
                output.append(f"</{tag}>")
                continue
            identifier, offset = self._read(blob, offset, "<H")
            attr_name = name(int(identifier))
            if opcode == self.STRING:
                value, offset = self._read_text(blob, offset, "<i")
            elif opcode in (self.INT, self.LONG):
                value, offset = self._read(blob, offset, "<i")
            elif opcode == self.BOOL:
                value, offset = self._read(blob, offset, "<B")
                if value not in (0, 1):
                    raise Aup3Error("invalid binary XML boolean")
                value = bool(value)
            elif opcode == self.LONG_LONG:
                value, offset = self._read(blob, offset, "<q")
            elif opcode == self.SIZE_T:
                value, offset = self._read(blob, offset, "<I")
            elif opcode == self.FLOAT:
                value, offset = self._read(blob, offset, "<f")
                _, offset = self._read(blob, offset, "<i")
            else:
                value, offset = self._read(blob, offset, "<d")
                _, offset = self._read(blob, offset, "<i")
            self._check_attribute_type(attr_name, opcode, tags[-1] if tags else current_tag)
            pending.append((attr_name, value))
        if current_tag is not None:
            flush_start()
        if pending or tags or scopes or not saw_root:
            raise Aup3Error(f"incomplete binary XML document at {offset}")
        return "".join(output)


def decode_project_xml(project_path: Path, table: str = "project") -> str:
    """Decode Audacity's project/document blobs into readable XML."""
    if table not in {"project", "autosave"}:
        raise Aup3Error(f"unsupported project table: {table}")
    with closing(sqlite3.connect(project_path)) as db:
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


def stereo_track_indexes(project_xml: str) -> tuple[int, ...]:
    """Return the document index of each stereo track, in project order.

    Audacity stores a stereo track either as one track holding two sequences
    per clip or as a leader track followed by its ``channel="1"`` partner.
    Only the leaders are returned, so the result indexes the tracks the user
    sees -- and, for a render, the outputs one per track.
    """
    tracks = parse_project_xml(project_xml)
    return tuple(
        index
        for index, track in enumerate(tracks)
        if track.channel != 1
    )


def extract_track(project_path: Path, project_xml: str, track_index: int = 0) -> tuple[np.ndarray, int]:
    """Extract one final stereo track, returning samples and its sample rate.

    ``track_index`` is a document index, as returned by
    :func:`stereo_track_indexes`.
    """
    tracks = parse_project_xml(project_xml)
    if track_index < 0 or track_index >= len(tracks):
        raise Aup3Error(f"track index out of range: {track_index}")
    track = tracks[track_index]
    if track.rate <= 0:
        raise Aup3Error("track rate must be positive")
    if all(len(clip.sequences) == 2 for clip in track.clips):
        channel_tracks = (track, track)
        sequence_indexes = (0, 1)
    elif all(len(clip.sequences) == 1 for clip in track.clips):
        # Split-mono layouts store the right channel in the very next track,
        # so the partner is positional: a project with several stereo tracks
        # would otherwise pair every leader with the first right channel.
        partner = next(
            (
                candidate
                for candidate in tracks[track_index + 1 : track_index + 2]
                if candidate.rate == track.rate
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
    with closing(sqlite3.connect(project_path)) as db:
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


def _project_xml(project_path: Path, project_xml_path: Path | None) -> str:
    return (
        project_xml_path.read_text()
        if project_xml_path is not None
        else decode_project_xml(project_path)
    )


def extract_to_wav(
    project_path: Path,
    project_xml_path: Path | None,
    output_path: Path,
    track_index: int = 0,
) -> None:
    project_xml = _project_xml(project_path, project_xml_path)
    samples, rate = extract_track(project_path, project_xml, track_index)
    write_wav(samples, rate, output_path)


def read_stereo_track(
    project_path: Path,
    project_xml_path: Path | None,
    index: int,
) -> tuple[np.ndarray, int]:
    """Extract one stereo track by its position in the project's track order."""
    project_xml = _project_xml(project_path, project_xml_path)
    indexes = stereo_track_indexes(project_xml)
    try:
        document_index = indexes[index]
    except IndexError as exc:
        raise Aup3Error(f"project has no stereo track {index}") from exc
    return extract_track(project_path, project_xml, document_index)


def extract_stereo_tracks_to_wavs(
    project_path: Path,
    project_xml_path: Path | None,
    output_paths: tuple[Path, ...],
) -> None:
    """Write one WAV per stereo track, pairing tracks and paths in order."""
    project_xml = _project_xml(project_path, project_xml_path)
    indexes = stereo_track_indexes(project_xml)
    if len(indexes) != len(output_paths):
        raise Aup3Error(
            f"project has {len(indexes)} stereo track(s), "
            f"expected {len(output_paths)}"
        )
    for index, output_path in zip(indexes, output_paths):
        samples, rate = extract_track(project_path, project_xml, index)
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
