from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "publish_releases.py"
spec = importlib.util.spec_from_file_location("publish_releases", SCRIPT)
assert spec and spec.loader
publish_releases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish_releases)


def test_validate_release_requires_tracks() -> None:
    with pytest.raises(ValueError, match="track"):
        publish_releases.validate_release({"id": "pilot-ep"})


def test_merge_keeps_releases_absent_from_payload() -> None:
    merged = publish_releases.merged_releases(
        {"releases": [{"id": "new", "title": "Fresh"}]},
        {"releases": [{"id": "old", "title": "Keep"}, {"id": "new", "title": "Stale"}]},
    )
    assert [release["id"] for release in merged["releases"]] == ["new", "old"]
    assert merged["releases"][0]["title"] == "Fresh"
