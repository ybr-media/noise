from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parents[1]))

from aup3_serializer import extract_track, write_wav


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
