from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "rename_track.py"
spec = importlib.util.spec_from_file_location("rename_track", SCRIPT)
assert spec and spec.loader
rename_track = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rename_track)


def test_validate_payload_normalizes_title() -> None:
    assert rename_track.validate_payload({"filename": "master-1.wav", "title": "  New title  "}) == ("master-1.wav", "New title")


def test_validate_payload_rejects_invalid_filename_and_title() -> None:
    with pytest.raises(ValueError, match="filename"):
        rename_track.validate_payload({"filename": "master.json", "title": "Title"})
    with pytest.raises(ValueError, match="required"):
        rename_track.validate_payload({"filename": "master.wav", "title": "  "})


def test_rename_manifest_changes_only_master_title() -> None:
    manifest = {
        "generatedAt": "today",
        "artifacts": [
            {"filename": "master.wav", "sidecar": {"role": "master", "seo_description": "Keep me"}},
            {"filename": "stem.wav", "sidecar": {"role": "stem_1"}},
        ],
    }
    updated = rename_track.rename_manifest(manifest, "master.wav", "Renamed")
    assert updated["generatedAt"] == "today"
    assert updated["artifacts"][0]["sidecar"] == {
        "role": "master",
        "seo_description": "Keep me",
        "seo_title": "Renamed",
    }
    assert manifest["artifacts"][0]["sidecar"] == {"role": "master", "seo_description": "Keep me"}


def test_rename_manifest_rejects_non_master() -> None:
    with pytest.raises(ValueError, match="master"):
        rename_track.rename_manifest(
            {"artifacts": [{"filename": "stem.wav", "sidecar": {"role": "stem_1"}}]},
            "stem.wav",
            "Renamed",
        )
