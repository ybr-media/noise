"""Shared high-quality sample-rate conversion for rendered audio."""

from __future__ import annotations

from math import gcd

import numpy as np
from scipy.signal import resample_poly


def resample_stereo(
    samples: np.ndarray, source_rate: int, target_rate: int
) -> np.ndarray:
    """Resample a stereo float matrix with the renderer's fixed polyphase filter."""
    if samples.ndim != 2 or samples.shape[1] != 2:
        raise ValueError("audio must be a stereo sample matrix")
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    if source_rate == target_rate:
        return samples.copy()
    divisor = gcd(source_rate, target_rate)
    converted = np.column_stack(
        [
            resample_poly(
                samples[:, channel],
                target_rate // divisor,
                source_rate // divisor,
                window=("kaiser", 10.0),
            )
            for channel in range(2)
        ]
    )
    expected = round(samples.shape[0] * target_rate / source_rate)
    return converted[:expected]
