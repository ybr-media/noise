from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

SCRIPTS = Path(__file__).parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delete_artifacts = _load("delete_artifacts")


class FakeS3:
    def __init__(self, manifest: dict[str, object]) -> None:
        self.manifest = manifest
        self.deleted: list[str] = []
        self.put: dict[str, bytes] = {}

    def get_object(self, Bucket: str, Key: str) -> dict[str, object]:
        class Body:
            def __init__(self, data: bytes) -> None:
                self._data = data

            def read(self) -> bytes:
                return self._data

        return {"Body": Body(json.dumps(self.manifest).encode("utf-8"))}

    def delete_object(self, Bucket: str, Key: str) -> None:
        self.deleted.append(Key)

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:
        self.put[Key] = Body


MANIFEST = {
    "artifacts": [
        {"filename": "doomed_master.wav", "sidecar": {"variant_id": "v_doomed", "role": "master"}},
        {"filename": "doomed_stem_1.wav", "sidecar": {"variant_id": "v_doomed", "role": "stem_1"}},
        {"filename": "kept_master.wav", "sidecar": {"variant_id": "v_kept", "role": "master"}},
        {"filename": "orphan.wav", "sidecar": None},
    ]
}


def test_deletes_matching_artifacts_and_prunes_the_manifest(monkeypatch) -> None:
    fake = FakeS3(MANIFEST)
    monkeypatch.setattr(delete_artifacts, "client", lambda: fake)
    assert delete_artifacts.main(["v_doomed", "--prefix", "labs"]) == 0
    assert fake.deleted == [
        "labs/doomed_master.wav",
        "labs/doomed_master.json",
        "labs/doomed_stem_1.wav",
        "labs/doomed_stem_1.json",
    ]
    manifest = json.loads(fake.put["labs/manifest.json"])
    assert [entry["filename"] for entry in manifest["artifacts"]] == ["kept_master.wav", "orphan.wav"]


def test_no_matches_deletes_nothing(monkeypatch) -> None:
    fake = FakeS3(MANIFEST)
    monkeypatch.setattr(delete_artifacts, "client", lambda: fake)
    assert delete_artifacts.main(["v_unknown"]) == 0
    assert fake.deleted == []
    assert fake.put == {}


def test_rejects_an_empty_variant_list(monkeypatch) -> None:
    assert delete_artifacts.main([" , "]) == 2
