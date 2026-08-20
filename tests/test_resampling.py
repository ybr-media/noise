"""Unit tests for the renderer's shared sample-rate conversion."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from resampling import resample_stereo


def _tone(frames: int, rate: int, hz: float = 440.0) -> np.ndarray:
    times = np.arange(frames) / rate
    left = np.sin(2 * np.pi * hz * times)
    right = np.sin(2 * np.pi * (hz / 2) * times)
    return np.column_stack((left, right))


def test_equal_rates_return_an_independent_copy() -> None:
    samples = _tone(128, 48000)
    converted = resample_stereo(samples, 48000, 48000)
    assert np.array_equal(converted, samples)
    converted[0, 0] = 99.0
    assert samples[0, 0] != 99.0


@pytest.mark.parametrize(
    ("source", "target", "frames"),
    [(96000, 48000, 9600), (48000, 96000, 4800), (44100, 48000, 4410), (48000, 44100, 4800)],
)
def test_output_length_follows_the_rate_ratio(source: int, target: int, frames: int) -> None:
    converted = resample_stereo(_tone(frames, source), source, target)
    assert converted.shape == (round(frames * target / source), 2)


def test_downsampling_preserves_a_tone_well_below_the_new_nyquist() -> None:
    rate, frames = 96000, 96000
    converted = resample_stereo(_tone(frames, rate, hz=1000.0), rate, 48000)
    # Ignore the filter's edges, where the polyphase transient lives.
    interior = converted[2400:-2400, 0]
    expected = np.sin(2 * np.pi * 1000.0 * (np.arange(2400, len(converted) - 2400) / 48000))
    assert float(np.max(np.abs(interior - expected))) < 0.01


def test_a_mono_or_multichannel_matrix_is_rejected() -> None:
    with pytest.raises(ValueError, match="stereo"):
        resample_stereo(np.zeros(64), 48000, 24000)
    with pytest.raises(ValueError, match="stereo"):
        resample_stereo(np.zeros((64, 3)), 48000, 24000)


@pytest.mark.parametrize(("source", "target"), [(0, 48000), (48000, 0), (-48000, 48000)])
def test_nonpositive_rates_are_rejected(source: int, target: int) -> None:
    with pytest.raises(ValueError, match="positive"):
        resample_stereo(np.zeros((64, 2)), source, target)
