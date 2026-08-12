from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

SCRIPTS = Path(__file__).parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prune_bucket = _load("prune_bucket")


class ClientError(Exception):
    pass


class FakeS3:
    def __init__(self, objects: dict[str, tuple[int, datetime]], documents: dict[str, dict]) -> None:
        self.objects = dict(objects)
        self.documents = dict(documents)
        self.deleted: list[str] = []
        self.put: dict[str, dict] = {}
        self.exceptions = SimpleNamespace(ClientError=ClientError)

    def get_object(self, Bucket: str, Key: str):
        if Key not in self.documents:
            raise ClientError(Key)
        body = json.dumps(self.documents[Key]).encode("utf-8")
        return {"Body": SimpleNamespace(read=lambda: body)}

    def get_paginator(self, name: str):
        contents = [
            {"Key": key, "Size": size, "LastModified": at}
            for key, (size, at) in sorted(self.objects.items())
        ]
        return SimpleNamespace(paginate=lambda **kwargs: [{"Contents": [
            obj for obj in contents
            if obj["Key"].startswith(kwargs.get("Prefix", ""))
        ]}])

    def delete_objects(self, Bucket: str, Delete: dict):
        for entry in Delete["Objects"]:
            self.deleted.append(entry["Key"])
            self.objects.pop(entry["Key"], None)

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str):
        self.put[Key] = json.loads(Body)


NOW = datetime(2026, 8, 12, tzinfo=timezone.utc)


def artifact(name: str, variant: str) -> dict:
    return {"filename": name, "sidecar": {"variant_id": variant}}


def run(s3: FakeS3, monkeypatch: pytest.MonkeyPatch, *argv: str) -> int:
    monkeypatch.setattr(prune_bucket, "client", lambda: s3)
    return prune_bucket.main(list(argv))


def test_strays_are_deleted_and_referenced_files_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = {"artifacts": [artifact("a.wav", "v_a")]}
    s3 = FakeS3(
        objects={
            "a.wav": (100, NOW),
            "a.json": (10, NOW),
            "manifest.json": (10, NOW),
            "stray.wav": (100, NOW),
            "stray.json": (10, NOW),
        },
        documents={"manifest.json": manifest},
    )
    assert run(s3, monkeypatch) == 0
    assert sorted(s3.deleted) == ["stray.json", "stray.wav"]
    assert not s3.put


def test_dry_run_deletes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    s3 = FakeS3(objects={"stray.wav": (100, NOW)}, documents={})
    assert run(s3, monkeypatch, "--dry-run") == 0
    assert s3.deleted == []


def test_oldest_unreleased_variants_retire_until_the_reserve_is_free(monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = {"artifacts": [
        artifact("old.wav", "v_old"),
        artifact("new.wav", "v_new"),
        artifact("released.wav", "v_released"),
    ]}
    releases = {"releases": [{"id": "ep", "tracks": [{"variantId": "v_released"}]}]}
    s3 = FakeS3(
        objects={
            "old.wav": (400, NOW - timedelta(days=2)),
            "old.json": (10, NOW - timedelta(days=2)),
            "new.wav": (400, NOW - timedelta(days=1)),
            "new.json": (10, NOW - timedelta(days=1)),
            "released.wav": (400, NOW),
            "manifest.json": (10, NOW),
            "releases.json": (10, NOW),
        },
        documents={"manifest.json": manifest, "releases.json": releases},
    )
    # Budget of 1000 - 150 = 850 bytes forces one retirement; the oldest goes first.
    assert run(s3, monkeypatch, "--limit-gb", "1e-6", "--reserve-mb", "1.5e-4") == 0
    assert sorted(s3.deleted) == ["old.json", "old.wav"]
    names = [entry["filename"] for entry in s3.put["manifest.json"]["artifacts"]]
    assert names == ["new.wav", "released.wav"]


def test_release_variants_are_never_retired(monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = {"artifacts": [artifact("released.wav", "v_released")]}
    releases = {"releases": [{"id": "ep", "tracks": [{"variantId": "v_released"}]}]}
    s3 = FakeS3(
        objects={"released.wav": (1000, NOW), "manifest.json": (10, NOW), "releases.json": (10, NOW)},
        documents={"manifest.json": manifest, "releases.json": releases},
    )
    assert run(s3, monkeypatch, "--limit-gb", "1e-6", "--reserve-mb", "2e-4") == 1
    assert s3.deleted == []


def test_prefix_scopes_listing_and_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = {"artifacts": [artifact("a.wav", "v_a")]}
    s3 = FakeS3(
        objects={
            "demo/a.wav": (100, NOW),
            "demo/manifest.json": (10, NOW),
            "demo/stray.wav": (100, NOW),
            "other.wav": (100, NOW),
        },
        documents={"demo/manifest.json": manifest},
    )
    assert run(s3, monkeypatch, "--prefix", "demo") == 0
    assert s3.deleted == ["demo/stray.wav"]
