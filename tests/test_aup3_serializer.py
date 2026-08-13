from __future__ import annotations

import sqlite3
import struct
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parents[1]))

from aup3_serializer import (
    Aup3Error,
    _BinaryXML,
    extract_stereo_tracks_to_wavs,
    extract_track,
    read_stereo_track,
    stereo_track_indexes,
    write_wav,
)


def _dictionary(*names: str, char_size: int = 4) -> bytes:
    result = bytearray([0, char_size])
    for identifier, name in enumerate(names):
        encoded = name.encode("utf-32-le")
        result += bytes([15]) + struct.pack("<HH", identifier, len(encoded)) + encoded
    return bytes(result)


def test_binary_xml_decoder_resolves_dictionary_names() -> None:
    dictionary = b"\x00\x04" + b"\x0f\x00\x00\x1c\x00" + "project".encode("utf-32-le")
    document = b"\x01\x00\x00\x02\x00\x00"
    assert _BinaryXML(dictionary, document).decode() == "<project></project>"


def test_binary_xml_decoder_escapes_attribute_values() -> None:
    dictionary = (
        b"\x00\x04"
            + b"\x0f\x00\x00\x1c\x00"
        + "project".encode("utf-32-le")
        + b"\x0f\x01\x00\x14\x00"
        + "title".encode("utf-32-le")
    )
    value = "a&\"<".encode("utf-32-le")
    document = (
        b"\x01\x00\x00"
        + b"\x03\x01\x00"
        + len(value).to_bytes(4, "little")
        + value
        + b"\x02\x00\x00"
    )
    assert _BinaryXML(dictionary, document).decode() == (
        '<project title="a&amp;&quot;&lt;"></project>'
    )


def test_binary_xml_rejects_malformed_char_size() -> None:
    with pytest.raises(ValueError, match="character size"):
        _BinaryXML(b"\x00\x03", b"")


def test_binary_xml_rejects_unknown_token_and_name() -> None:
    dictionary = _dictionary("project")
    with pytest.raises(ValueError, match="opcode"):
        _BinaryXML(dictionary, b"\x10").decode()
    with pytest.raises(ValueError, match="unknown name"):
        _BinaryXML(dictionary, b"\x01\x63\x00\x02\x00\x00").decode()
    with pytest.raises(ValueError, match="FT_StartTag"):
        _BinaryXML(dictionary, b"\x0b\x00\x00\x00\x00").decode()


def test_binary_xml_rejects_wrong_schema_attribute_type() -> None:
    dictionary = _dictionary("project", "numsamples")
    document = (
        b"\x01\x00\x00"
        + b"\x04\x01\x00"
        + struct.pack("<i", 4)
        + b"\x02\x00\x00"
    )
    with pytest.raises(ValueError, match="numsamples"):
        _BinaryXML(dictionary, document).decode()


def test_binary_xml_push_pop_scopes_names() -> None:
    dictionary = _dictionary("project")
    scoped = (
        b"\x01\x00\x00"
        b"\x0d"
        + b"\x0f"
        + struct.pack("<HH", 0, len("title".encode("utf-32-le")))
        + "title".encode("utf-32-le")
        + b"\x03\x00\x00\x14\x00\x00\x00"
        + "hello".encode("utf-32-le")
        + b"\x0e"
        + b"\x02\x00\x00"
    )
    assert _BinaryXML(dictionary, scoped).decode() == '<project title="hello"></project>'


def test_binary_xml_longlong_preserves_large_negative_values() -> None:
    dictionary = _dictionary("project", "blockid")
    document = (
        b"\x01\x00\x00"
        + b"\x07\x01\x00"
        + struct.pack("<q", -(2**40))
        + b"\x02\x00\x00"
    )
    assert _BinaryXML(dictionary, document).decode() == (
        '<project blockid="-1099511627776"></project>'
    )


def _project(tmp_path: Path, xml: str, rows: list[tuple[int, np.ndarray]]) -> Path:
    path = tmp_path / "project.aup3"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE sampleblocks "
            "(blockid INTEGER PRIMARY KEY, sampleformat INTEGER, samples BLOB)"
        )
        for block_id, values in rows:
            db.execute(
                "INSERT INTO sampleblocks VALUES (?, ?, ?)",
                (block_id, 262159, values.astype("<f4").tobytes()),
            )
        db.commit()
    (tmp_path / "project.xml").write_text(xml)
    return path


def _xml(sequences: str, rate: int = 48000) -> str:
    return f"""<audacityproject><wavetrack rate="{rate}">
      <waveclip offset="0" trimleft="0" trimright="0">{sequences}</waveclip>
    </wavetrack></audacityproject>"""


def test_noncontiguous_blocks_and_channel_order(tmp_path: Path) -> None:
    xml = _xml(
        """
        <sequence numsamples="4" sampleformat="262159">
          <waveblock start="0" blockid="20"/>
          <waveblock start="2" blockid="7"/>
        </sequence>
        <sequence numsamples="4" sampleformat="262159">
          <waveblock start="0" blockid="91"/>
          <waveblock start="2" blockid="3"/>
        </sequence>
        """
    )
    project = _project(
        tmp_path,
        xml,
        [
            (20, np.array([1, 2], dtype=np.float32)),
            (7, np.array([3, 4], dtype=np.float32)),
            (91, np.array([-1, -2], dtype=np.float32)),
            (3, np.array([-3, -4], dtype=np.float32)),
            # Stale data must not appear in the result.
            (999, np.array([99, 99], dtype=np.float32)),
        ],
    )
    samples, rate = extract_track(project, (tmp_path / "project.xml").read_text())
    np.testing.assert_array_equal(
        samples,
        np.array([[1, -1], [2, -2], [3, -3], [4, -4]], dtype=np.float32),
    )
    assert rate == 48000


def test_silent_runs_are_zero_and_trimmed_clip_position_is_respected(tmp_path: Path) -> None:
    xml = _xml(
        """
        <sequence numsamples="6" sampleformat="262159">
          <waveblock start="0" blockid="-2"/>
          <waveblock start="2" blockid="42"/>
        </sequence>
        <sequence numsamples="6" sampleformat="262159">
          <waveblock start="0" blockid="-2"/>
          <waveblock start="2" blockid="42"/>
        </sequence>
        """
    ).replace('offset="0" trimleft="0"', 'offset="0.0000416666667" trimleft="0.0000208333333"')
    project = _project(tmp_path, xml, [(42, np.array([5, 6, 7, 8], dtype=np.float32))])
    samples, _ = extract_track(project, (tmp_path / "project.xml").read_text())
    np.testing.assert_array_equal(
        samples,
        np.array([[0, 0], [5, 5], [6, 6], [7, 7], [8, 8]], dtype=np.float32),
    )


def test_wav_format_is_verified(tmp_path: Path) -> None:
    output = tmp_path / "out.wav"
    samples = np.array([[0.25, -0.25], [0.5, -0.5]], dtype=np.float32)
    write_wav(samples, 48000, output)
    with sf.SoundFile(output) as info:
        assert info.samplerate == 48000
        assert info.channels == 2
        assert info.subtype == "PCM_24"


def _split_mono_xml(count: int, frames: int, rate: int = 48000) -> str:
    """Audacity's on-disk layout: one leader plus one channel="1" partner."""
    tracks = "".join(
        f"""<wavetrack rate="{rate}" channel="{index % 2}">
          <waveclip offset="0" trimleft="0" trimright="0">
            <sequence numsamples="{frames}" sampleformat="262159">
              <waveblock start="0" blockid="{index + 1}"/>
            </sequence>
          </waveclip>
        </wavetrack>"""
        for index in range(2 * count)
    )
    return f"<audacityproject>{tracks}</audacityproject>"


def _four_track_project(tmp_path: Path) -> tuple[Path, np.ndarray, list[np.ndarray]]:
    generator = np.random.default_rng(7)
    frames = 256
    stems = [generator.normal(0, 0.1, (frames, 2)).astype(np.float32) for _ in range(3)]
    master = np.sum(stems, axis=0).astype(np.float32)
    channels = [
        track[:, channel]
        for track in (*stems, master)
        for channel in (0, 1)
    ]
    project = _project(
        tmp_path,
        _split_mono_xml(4, frames),
        list(enumerate(channels, start=1)),
    )
    return project, master, stems


def test_stereo_tracks_are_paired_with_the_adjacent_right_channel(tmp_path: Path) -> None:
    project, master, stems = _four_track_project(tmp_path)
    xml = tmp_path / "project.xml"
    assert stereo_track_indexes(xml.read_text()) == (0, 2, 4, 6)
    for index, expected in enumerate((*stems, master)):
        samples, rate = read_stereo_track(project, xml, index)
        np.testing.assert_array_equal(samples, expected)
        assert rate == 48000
    with pytest.raises(Aup3Error, match="no stereo track 4"):
        read_stereo_track(project, xml, 4)


def test_extracted_stems_sum_back_to_the_extracted_master(tmp_path: Path) -> None:
    project, master, _ = _four_track_project(tmp_path)
    xml = tmp_path / "project.xml"
    outputs = tuple(
        tmp_path / name
        for name in ("stem_1.wav", "stem_2.wav", "stem_3.wav", "master.wav")
    )
    extract_stereo_tracks_to_wavs(project, xml, outputs)
    written = [sf.read(path, dtype="float64", always_2d=True)[0] for path in outputs]
    for path in outputs:
        with sf.SoundFile(path) as info:
            assert (info.samplerate, info.channels, info.subtype, info.frames) == (
                48000,
                2,
                "PCM_24",
                master.shape[0],
            )
    residual = np.max(np.abs(written[3] - sum(written[:3])))
    # Only 24-bit quantization of four files stands between the sum and zero.
    assert residual < 1e-6

    with pytest.raises(Aup3Error, match="4 stereo track"):
        extract_stereo_tracks_to_wavs(project, xml, outputs[:3])


def test_extraction_downsamples_stems_but_keeps_master_rate(tmp_path: Path) -> None:
    project, master, _ = _four_track_project(tmp_path)
    xml = tmp_path / "project.xml"
    xml.write_text(_split_mono_xml(4, master.shape[0], rate=96000), encoding="utf-8")
    outputs = tuple(
        tmp_path / name
        for name in ("stem_1.wav", "stem_2.wav", "stem_3.wav", "master.wav")
    )
    extract_stereo_tracks_to_wavs(project, xml, outputs, stem_rate=48000)
    for path in outputs[:3]:
        with sf.SoundFile(path) as info:
            assert (info.samplerate, info.channels, info.subtype, info.frames) == (
                48000,
                2,
                "PCM_24",
                master.shape[0] // 2,
            )
    with sf.SoundFile(outputs[3]) as info:
        assert (info.samplerate, info.channels, info.subtype, info.frames) == (
            96000,
            2,
            "PCM_24",
            master.shape[0],
        )
