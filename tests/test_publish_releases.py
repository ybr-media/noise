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


def test_an_edited_release_replaces_the_stored_one() -> None:
    """The dispatched payload is the newer edit, like the console's own merge."""
    document = publish_releases.with_release(
        {"releases": [{"id": "pilot-ep", "title": "Old"}, {"id": "other", "title": "Keep"}]},
        {"id": "pilot-ep", "title": "New"},
    )
    assert [release["id"] for release in document["releases"]] == ["other", "pilot-ep"]
    assert document["releases"][1]["title"] == "New"


def test_a_release_is_added_to_an_empty_document() -> None:
    assert publish_releases.with_release({"releases": []}, {"id": "a"})["releases"] == [{"id": "a"}]
    assert publish_releases.with_release({}, {"id": "a"})["releases"] == [{"id": "a"}]


def test_unidentifiable_stored_releases_are_dropped() -> None:
    document = publish_releases.with_release(
        {"releases": ["junk", {"title": "no id"}, {"id": "keep"}]}, {"id": "a"}
    )
    assert [release["id"] for release in document["releases"]] == ["a", "keep"]


def test_validate_release_requires_an_id_and_track_variants() -> None:
    with pytest.raises(ValueError, match="id"):
        publish_releases.validate_release({"tracks": [{"variantId": "wn_a"}]})
    with pytest.raises(ValueError, match="variantId"):
        publish_releases.validate_release({"id": "ep", "tracks": [{"title": "no variant"}]})
    release = {"id": "ep", "tracks": [{"variantId": "wn_a"}]}
    assert publish_releases.validate_release(release) is release
