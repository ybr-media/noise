from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

SCRIPTS = Path(__file__).parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


publish_artifacts = _load("publish_artifacts")
select_variants = _load("select_variants")


@pytest.fixture()
def rendered(tmp_path: Path) -> Path:
    (tmp_path / "one.wav").write_bytes(b"RIFF" + b"\0" * 60)
    (tmp_path / "one.json").write_text(json.dumps({"variant_id": "v_one", "cell_seconds": 60}), encoding="utf-8")
    (tmp_path / "two.wav").write_bytes(b"RIFF")
    (tmp_path / "render_log.jsonl").write_text(
        "\n".join(
            [
                json.dumps({"variant_id": "v_one", "exit_state": "failed"}),
                json.dumps({"variant_id": "v_one", "exit_state": "ok"}),
                "not json",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "qa_results.json").write_text(
        json.dumps({"files": [{"filename": "one.wav", "checks": [{"name": "Loudness", "passed": True}]}]}),
        encoding="utf-8",
    )
    return tmp_path


def test_manifest_pairs_masters_with_sidecars_qa_and_latest_status(rendered: Path) -> None:
    manifest = publish_artifacts.build_manifest(rendered)
    one, two = manifest["artifacts"]
    assert one["filename"] == "one.wav"
    assert one["sizeBytes"] == 64
    assert one["sidecar"]["variant_id"] == "v_one"
    assert one["qaChecks"] == [{"name": "Loudness", "passed": True}]
    assert one["renderStatus"] == "ok"
    assert two["sidecar"] is None
    assert two["renderStatus"] == "Not rendered"


def test_manifest_keeps_previously_published_masters(rendered: Path) -> None:
    manifest = publish_artifacts.build_manifest(rendered)
    published = {"artifacts": [{"filename": "old.wav", "renderStatus": "ok"}, {"filename": "one.wav", "renderStatus": "stale"}]}
    names = [entry["filename"] for entry in publish_artifacts.merged(manifest, published)["artifacts"]]
    assert names == ["old.wav", "one.wav", "two.wav"]
    fresh = next(entry for entry in publish_artifacts.merged(manifest, published)["artifacts"] if entry["filename"] == "one.wav")
    assert fresh["renderStatus"] == "ok"


def test_dry_run_writes_a_manifest_without_credentials(rendered: Path) -> None:
    assert publish_artifacts.main([str(rendered), "--dry-run"]) == 0
    manifest = json.loads((rendered / "manifest.json").read_text(encoding="utf-8"))
    assert [entry["filename"] for entry in manifest["artifacts"]] == ["one.wav", "two.wav"]


def test_uploads_cover_masters_sidecars_and_evidence(rendered: Path) -> None:
    manifest = publish_artifacts.build_manifest(rendered)
    names = {path.name: content_type for path, content_type in publish_artifacts.uploads(rendered, manifest)}
    assert names["one.wav"] == "audio/wav"
    assert names["one.json"] == "application/json"
    assert names["render_log.jsonl"] == "application/x-ndjson"
    assert "qa_results.json" in names
    assert "two.json" not in names


def test_selection_supports_pilot_full_and_explicit_ids(tmp_path: Path) -> None:
    full = select_variants.select("full")
    assert len(full["variants"]) == 144
    assert len(select_variants.select("pilot")["variants"]) < len(full["variants"])
    chosen = full["variants"][7]["variant_id"]
    assert [row["variant_id"] for row in select_variants.select(f" {chosen} ")["variants"]] == [chosen]


def test_selection_rejects_unknown_ids() -> None:
    with pytest.raises(SystemExit):
        select_variants.select("not_a_variant")


def test_stems_are_published_but_only_masters_count_as_releases(tmp_path: Path) -> None:
    names = ["wn_v_master", "wn_v_stem_1", "wn_v_stem_2", "wn_v_stem_3"]
    for index, name in enumerate(names):
        (tmp_path / f"{name}.wav").write_bytes(b"RIFF")
        (tmp_path / f"{name}.json").write_text(
            json.dumps({
                "variant_id": "v",
                "role": "master" if not index else f"stem_{index}",
                "stem_filenames": [f"{stem}.wav" for stem in names[1:]],
            }),
            encoding="utf-8",
        )
    manifest = publish_artifacts.build_manifest(tmp_path)
    assert [entry["filename"] for entry in manifest["artifacts"]] == [
        f"{name}.wav" for name in names
    ]
    # Four files ship, but the library gains one track.
    assert publish_artifacts.master_count(manifest) == 1
    uploaded = {path.name for path, _ in publish_artifacts.uploads(tmp_path, manifest)}
    assert {f"{name}.wav" for name in names} <= uploaded
    assert {f"{name}.json" for name in names} <= uploaded


def test_releases_merge_without_dropping_published_entries() -> None:
    local = {"releases": [{"id": "new", "title": "New"}]}
    published = {"releases": [{"id": "old", "title": "Old"}, {"id": "new", "title": "Stale"}]}
    merged = publish_artifacts.merged_releases(local, published)
    assert [release["id"] for release in merged["releases"]] == ["new", "old"]
    assert next(release for release in merged["releases"] if release["id"] == "new")["title"] == "New"


def test_releases_are_uploaded_when_present(rendered: Path) -> None:
    (rendered / "releases.json").write_text(json.dumps({"releases": [{"id": "pilot-ep"}]}), encoding="utf-8")
    manifest = publish_artifacts.build_manifest(rendered)
    assert {path.name for path, _ in publish_artifacts.uploads(rendered, manifest)} >= {"releases.json"}
