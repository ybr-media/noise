"""Extract Audacity-rendered PCM from an ``.aup3`` into stereo WAV.

This module deliberately performs no DSP.  Audacity owns generation, effects,
mixing, normalization, and fades; this code only follows the final project's
document references, reads float32 sample blocks, and serializes them.

The project document must be supplied as readable XML, for example from
``audacity-project-tools -extract_project``.  Decoding Audacity's private
binary XML format is intentionally outside this module.
"""

from __future__ import annotations

import argparse
import sqlite3
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

FLOAT32_SAMPLE_FORMAT = 262159


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


def _number(element: ET.Element, name: str, default: str | None = None) -> str:
    value = element.attrib.get(name, default)
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
        tracks.append(Track(rate, tuple(clips)))
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


def _clip_samples(db: sqlite3.Connection, clip: Clip, rate: int) -> tuple[int, np.ndarray]:
    if len(clip.sequences) != 2:
        raise Aup3Error("final stereo track must contain exactly two sequences")
    channels = []
    for sequence in clip.sequences:
        values = _sequence_samples(db, sequence)
        end = sequence.num_samples - clip.trim_right
        if clip.trim_left < 0 or end < clip.trim_left:
            raise Aup3Error("invalid clip trims")
        channels.append(values[clip.trim_left:end])
    start = round(clip.offset * rate) - clip.trim_left
    return start, np.column_stack(channels).astype(np.float32, copy=False)


def extract_track(project_path: Path, project_xml: str, track_index: int = 0) -> tuple[np.ndarray, int]:
    """Extract one final stereo track, returning samples and its sample rate."""
    tracks = parse_project_xml(project_xml)
    try:
        track = tracks[track_index]
    except IndexError as exc:
        raise Aup3Error(f"track index out of range: {track_index}") from exc
    if track.rate <= 0:
        raise Aup3Error("track rate must be positive")
    with sqlite3.connect(project_path) as db:
        clips = [_clip_samples(db, clip, track.rate) for clip in track.clips]
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
    project_xml_path: Path,
    output_path: Path,
    track_index: int = 0,
) -> None:
    samples, rate = extract_track(project_path, project_xml_path.read_text(), track_index)
    write_wav(samples, rate, output_path)


def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("project_xml", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--track", type=int, default=0)
    args = parser.parse_args()
    extract_to_wav(args.project, args.project_xml, args.output, args.track)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
