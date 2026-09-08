from __future__ import annotations

import hashlib
import json
import socket
import uuid
from pathlib import Path

import numpy as np
import pytest

from signal_semantic_lab.workspace_engine import (
    DEFAULT_WORKSPACE_ENGINE_CONFIG,
    INPUT_CONTRACT,
    WorkspaceEngineError,
    _guide_matrix,
    _select_representatives,
    reconcile_cluster_ids,
    run_workspace_engine,
)

WORKSPACE = "00000000-0000-4000-8000-000000000099"


def sha(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def file_sha(path: Path) -> str:
    return sha(path.read_bytes())


def root_id(index: int) -> str:
    return str(uuid.UUID(int=index + (4 << 76) + (8 << 60)))


def read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def representative_fixture(roots_and_strengths):
    records, strengths = [], []
    for root, values in roots_and_strengths:
        for chunk_index, strength in enumerate(values):
            records.append(
                {
                    "ordinal": len(records),
                    "root_id": root_id(root),
                    "chunk_index": chunk_index,
                    "start": chunk_index,
                    "end": chunk_index + 1,
                    "chunk_sha256": sha(f"{root}/{chunk_index}".encode()),
                    "text": "private fixture body must stay out of evidence references",
                }
            )
            strengths.append(strength)
    return records, np.arange(len(records)), np.asarray(strengths)


def test_representatives_use_distinct_roots_and_preserve_low_affiliation_boundary():
    records, indexes, strengths = representative_fixture(
        [(1, [1.0] + [0.99] * 20 + [0.0])]
        + [(root, [0.9 - root * 0.01]) for root in range(2, 16)]
        + [(16, [0.85, 0.01])]
    )
    original_records = json.dumps(records)
    original_strengths = strengths.copy()
    original_indexes = indexes.copy()
    # The old ten strongest chunks would all belong to one long mention.
    old_top = sorted(indexes, key=lambda index: -strengths[index])[:10]
    assert {records[index]["root_id"] for index in old_top} == {root_id(1)}
    selected = _select_representatives(records, indexes, strengths)
    assert len(selected) == len({item["root_id"] for item in selected}) == 10
    assert [item["root_id"] for item in selected[:-1]] == [root_id(i) for i in range(1, 10)]
    assert all(item["selection_reason"] == "high_affiliation" for item in selected[:-1])
    assert selected[-1]["root_id"] == root_id(16)
    assert selected[-1]["chunk_index"] == 1
    assert selected[-1]["strength"] == 0.01
    assert selected[-1]["selection_reason"] == "low_affiliation_boundary"
    assert all("text" not in item for item in selected)
    assert _select_representatives(records, indexes[::-1], strengths) == selected
    assert json.dumps(records) == original_records
    np.testing.assert_array_equal(strengths, original_strengths)
    np.testing.assert_array_equal(indexes, original_indexes)


def test_representatives_small_clusters_and_ties_are_deterministic():
    records, indexes, strengths = representative_fixture([(1, [0.5, 0.5]), (2, [0.5, 0.5])])
    assert _select_representatives(records, indexes[:0], strengths) == []
    one_root = _select_representatives(records, indexes[:2], strengths)
    assert len(one_root) == 1
    assert one_root[0]["ordinal"] == 0
    assert one_root[0]["selection_reason"] == "high_affiliation"
    two_roots = _select_representatives(records, indexes, strengths)
    assert [item["ordinal"] for item in two_roots] == [0, 2]
    assert two_roots[-1]["selection_reason"] == "low_affiliation_boundary"
    assert _select_representatives(records, indexes[::-1], strengths) == two_roots


def input_fixture(
    directory: Path, source: dict[str, list[tuple[str, np.ndarray]]], *, guides: bool = True
) -> dict:
    directory.mkdir()
    records, vectors = [], []
    for root, pieces in sorted(source.items()):
        full_text = "".join(text for text, _vector in pieces)
        asset = sha(full_text.encode())
        fingerprint = sha((root + full_text).encode())
        offset = 0
        for index, (text, vector) in enumerate(pieces):
            end = offset + len(text.encode("utf-16-le")) // 2
            records.append(
                {
                    "ordinal": len(records),
                    "root_id": root,
                    "root_fingerprint": fingerprint,
                    "asset_sha256": asset,
                    "expected_chunks": len(pieces),
                    "chunk_index": index,
                    "start": offset,
                    "end": end,
                    "chunk_sha256": sha(text.encode()),
                    "text": text,
                }
            )
            vectors.append(vector)
            offset = end
    (directory / "chunks.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records)
    )
    np.save(
        directory / "vectors.npy",
        np.asarray(vectors, dtype=np.float32).reshape((-1, 1024)),
        allow_pickle=False,
    )
    prototype_rows = (
        [
            {
                "ordinal": 0,
                "guide_key": "interest-delivery",
                "role": "topic_positive",
                "input_digest": sha(b"delivery positive"),
            },
            {
                "ordinal": 1,
                "guide_key": "interest-delivery",
                "role": "topic_negative",
                "input_digest": sha(b"delivery negative"),
            },
            {
                "ordinal": 2,
                "guide_key": "brand-context-service",
                "role": "scope_positive",
                "input_digest": sha(b"service positive"),
            },
            {
                "ordinal": 3,
                "guide_key": "brand-context-service",
                "role": "scope_negative",
                "input_digest": sha(b"service negative"),
            },
        ]
        if guides
        else []
    )
    prototype_vectors = (
        np.eye(1024, dtype=np.float32)[[0, 2, 1, 3]]
        if guides
        else np.empty((0, 1024), dtype=np.float32)
    )
    (directory / "guides.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in prototype_rows)
    )
    np.save(directory / "guide-vectors.npy", prototype_vectors, allow_pickle=False)

    def descriptor(name, **extra):
        return {"file": name, "sha256": file_sha(directory / name), **extra}

    manifest = {
        "contract_version": INPUT_CONTRACT,
        "workspace_id": WORKSPACE,
        "input_revision": "1",
        "preparation_run_id": str(uuid.uuid4()),
        "embedding_run_id": str(uuid.uuid4()),
        "embedding_config_digest": sha(b"fixture-f32-1024"),
        "context_digest": sha(b"context-v1"),
        "catalog_digest": sha(b"catalog-v1"),
        "chunk_policy_version": "corpus-text-chunks-v1",
        "records": descriptor("chunks.jsonl", rows=len(records), roots=len(source)),
        "vectors": descriptor("vectors.npy", rows=len(records), dimensions=1024, dtype="float32"),
        "guides": descriptor("guides.jsonl", rows=len(prototype_rows)),
        "guide_vectors": descriptor(
            "guide-vectors.npy", rows=len(prototype_rows), dimensions=1024, dtype="float32"
        ),
        "config": DEFAULT_WORKSPACE_ENGINE_CONFIG,
    }
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return manifest


@pytest.fixture(scope="module")
def real_runs(tmp_path_factory):
    storage = tmp_path_factory.mktemp("workspace-engine")
    rng = np.random.default_rng(709)
    vocabulary = [
        "delivery parcel shipment courier",
        "service refund support telephone",
        "pricing payment invoice discount",
        "battery charging electric energy",
    ]

    def piece(group: int, index: int) -> tuple[str, np.ndarray]:
        vector = rng.normal(0, 0.004, 1024).astype(np.float32)
        vector[group] += 1
        vector /= np.linalg.norm(vector)
        return f"Synthetic 🌞 {vocabulary[group]} experience discussion entry {index}. ", vector

    first_source = {
        root_id(group * 80 + index + 1): [piece(group, index)]
        for group in range(3)
        for index in range(80)
    }
    first_source[root_id(1)].append(piece(1, 900))
    second_source = {key: list(values) for key, values in first_source.items()}
    for index in range(80):
        second_source[root_id(300 + index)] = [piece(3, index)]
    for index in range(20):
        second_source[root_id(500 + index)] = [piece(0, index)]
    second_source[root_id(1)].append(piece(3, 901))
    first_input, second_input, zero_input = (
        storage / "input1",
        storage / "input2",
        storage / "input-zero",
    )
    input_fixture(first_input, first_source)
    input_fixture(second_input, second_source)
    input_fixture(zero_input, first_source, guides=False)
    external_calls = []
    patch = pytest.MonkeyPatch()

    def deny_network(_self, address):
        external_calls.append(address)
        raise RuntimeError("external networking forbidden in local algorithm fixture")

    patch.setattr(socket.socket, "connect", deny_network)
    patch.setenv("HF_HUB_OFFLINE", "1")
    patch.setenv("TRANSFORMERS_OFFLINE", "1")
    patch.setenv("TOKENIZERS_PARALLELISM", "false")
    try:
        first_dir, second_dir, zero_dir = (
            storage / "result1",
            storage / "result2",
            storage / "result-zero",
        )
        first = run_workspace_engine(first_input, first_dir, storage)
        previous_hash = file_sha(first_dir / "manifest.json")
        second = run_workspace_engine(second_input, second_dir, storage, first_dir, previous_hash)
        zero = run_workspace_engine(zero_input, zero_dir, storage)
        yield {
            "storage": storage,
            "first": first,
            "second": second,
            "zero": zero,
            "first_dir": first_dir,
            "second_dir": second_dir,
            "zero_dir": zero_dir,
            "first_input": first_input,
            "second_input": second_input,
            "previous_hash": previous_hash,
            "external_calls": external_calls,
        }
    finally:
        patch.undo()


def test_real_bertopic_two_loads_discover_novelty_inside_already_assigned_root(real_runs):
    first, second = real_runs["first"], real_runs["second"]
    assert first["status"] == second["status"] == "completed"
    assert first["counts"]["roots"] == 240
    assert first["counts"]["occurrences"] == 241
    assert second["counts"]["roots"] == 340
    assert second["counts"]["occurrences"] == 342
    assert second["counts"]["predicted_occurrences"] > 0
    assert second["counts"]["known_predictions"] > 0
    first_roots = {
        row["root_id"]: row for row in read_lines(real_runs["first_dir"] / "roots.jsonl")
    }
    second_roots = {
        row["root_id"]: row for row in read_lines(real_runs["second_dir"] / "roots.jsonl")
    }
    assert len(first_roots[root_id(1)]["open"]) >= 2
    assert len(second_roots[root_id(1)]["open"]) >= 3
    old_ids = {identity for row in first_roots.values() for identity in row["open"]}
    novel_ids = set(second_roots[root_id(1)]["open"]) - old_ids
    assert novel_ids
    assert any(novel_ids & set(second_roots[root_id(300 + index)]["open"]) for index in range(80))
    for lane in second["lanes"]:
        assert len(read_lines(real_runs["second_dir"] / lane["assignments_file"])) == 342
    lineage = json.loads((real_runs["second_dir"] / "lineage.json").read_text())
    assert any(edge["kind"] == "continuation" and edge["from"] == edge["to"] for edge in lineage)
    assert real_runs["external_calls"] == []
    assert second["quality"] == "uncalibrated" and second["approval_policy"] == "none"


def test_zero_interests_runs_open_and_precomputed_guides_change_actual_model_input(real_runs):
    from joblib import load

    zero = real_runs["zero"]
    assert [lane["lane"] for lane in zero["lanes"]] == ["open"]
    assert zero["lanes"][0]["clusters"] >= 2
    guided = next(lane for lane in real_runs["first"]["lanes"] if lane["lane"] == "guided")
    assert guided["guidance"]["guided_occurrences"] > 0
    # Both are server-generated fixture files whose manifest hashes are checked
    # independently here before testing the fit's actual precomputed geometry.
    for artifact in real_runs["first"]["artifacts"]:
        assert file_sha(real_runs["first_dir"] / artifact["file"]) == artifact["sha256"]
    open_model = load(real_runs["first_dir"] / "model.open.joblib")
    guided_model = load(real_runs["first_dir"] / "model.guided.joblib")
    assert not np.array_equal(open_model.umap_model._raw_data, guided_model.umap_model._raw_data)
    assert (
        open_model.umap_model._raw_data.shape
        == guided_model.umap_model._raw_data.shape
        == (241, 1024)
    )


def test_artifact_replay_and_corrupt_prior_model_rejected_before_deserialization(
    real_runs, tmp_path, monkeypatch
):
    import joblib

    replay = run_workspace_engine(
        real_runs["second_input"],
        real_runs["second_dir"],
        real_runs["storage"],
        real_runs["first_dir"],
        real_runs["previous_hash"],
    )
    assert replay["replayed"] is True
    with pytest.raises(WorkspaceEngineError, match="previous_manifest_hash_mismatch"):
        run_workspace_engine(
            real_runs["second_input"],
            real_runs["storage"] / "bad-hash",
            real_runs["storage"],
            real_runs["first_dir"],
            sha(b"wrong manifest"),
        )
    # Tamper an isolated copy, never the persistent fixture used by other tests.
    import shutil

    copied = real_runs["storage"] / "tampered"
    shutil.copytree(real_runs["first_dir"], copied)
    (copied / "model.open.joblib").write_bytes(b"not a trusted model")
    monkeypatch.setattr(
        joblib,
        "load",
        lambda *_args, **_kwargs: pytest.fail("must verify SHA before loading pickle"),
    )
    with pytest.raises(WorkspaceEngineError, match="artifact_hash_mismatch"):
        run_workspace_engine(
            real_runs["second_input"],
            real_runs["storage"] / "tampered-result",
            real_runs["storage"],
            copied,
            real_runs["previous_hash"],
        )


def test_negative_prototype_veto_and_all_prototypes_are_used(tmp_path):
    matrix = np.eye(1024, dtype=np.float32)[:2]
    seeds = np.stack([matrix[0], matrix[0], matrix[1]])
    guides = [
        {"guide_key": "a", "role": "topic_positive"},
        {"guide_key": "a", "role": "topic_negative"},
        {"guide_key": "b", "role": "scope_positive"},
    ]
    guided, labels, stats, _center = _guide_matrix(matrix, guides, seeds, tmp_path / "guided.npy")
    assert labels.tolist() == [-1, 1]
    assert stats["negative_vetoes"] == 1
    assert np.array_equal(guided[0], matrix[0])


def test_insufficient_population_and_missing_fragment_never_fabricate_clusters(tmp_path):
    source = {root_id(1): [("Tiny 🌞 complete text", np.eye(1024, dtype=np.float32)[0])]}
    input_fixture(tmp_path / "small", source, guides=False)
    result = run_workspace_engine(tmp_path / "small", tmp_path / "result", tmp_path)
    assert result["status"] == "insufficient_population"
    assert result["counts"]["roots"] == result["counts"]["occurrences"] == 1
    assert result["lanes"][0]["model_file"] is None
    assert result["lanes"][0]["clusters"] == 0
    manifest = input_fixture(tmp_path / "truncated", source, guides=False)
    records = read_lines(tmp_path / "truncated" / "chunks.jsonl")
    records[0]["expected_chunks"] = 2
    (tmp_path / "truncated" / "chunks.jsonl").write_text(json.dumps(records[0]) + "\n")
    manifest["records"]["sha256"] = file_sha(tmp_path / "truncated" / "chunks.jsonl")
    (tmp_path / "truncated" / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(WorkspaceEngineError, match="root_coverage_incomplete"):
        run_workspace_engine(tmp_path / "truncated", tmp_path / "bad-result", tmp_path)


def test_lineage_records_split_merge_without_forced_hungarian_identity():
    old = {"old-a": {"1", "2", "3", "4"}, "old-b": {"5", "6"}}
    common = set().union(*old.values())
    mapping, edges = reconcile_cluster_ids(
        workspace_id=WORKSPACE,
        lane="open",
        input_digest=sha(b"split"),
        current={0: {"1", "2"}, 1: {"3", "4"}, 2: {"5", "6"}},
        previous=old,
        common_roots=common,
    )
    assert mapping[2] == "old-b"
    assert mapping[0] != "old-a" and mapping[1] != "old-a"
    assert sum(edge["kind"] == "split" for edge in edges) == 2
    mapping, edges = reconcile_cluster_ids(
        workspace_id=WORKSPACE,
        lane="open",
        input_digest=sha(b"merge"),
        current={0: common},
        previous=old,
        common_roots=common,
    )
    assert mapping[0] not in old
    assert all(edge["kind"] == "merge" for edge in edges)


def test_prior_model_must_be_in_verified_artifact_index(real_runs, monkeypatch):
    import shutil

    import joblib

    copied = real_runs["storage"] / "unlisted-model"
    shutil.copytree(real_runs["first_dir"], copied)
    manifest_path = copied / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["artifacts"] = [
        item for item in manifest["artifacts"] if item["file"] != "model.open.joblib"
    ]
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setattr(
        joblib, "load", lambda *_args, **_kwargs: pytest.fail("unlisted model must not load")
    )
    with pytest.raises(WorkspaceEngineError, match="previous_artifact_unverified"):
        run_workspace_engine(
            real_runs["second_input"],
            real_runs["storage"] / "unlisted-result",
            real_runs["storage"],
            copied,
            file_sha(manifest_path),
        )


@pytest.mark.parametrize(
    "changed_field",
    [
        "scipy",
        "numba",
        "llvmlite",
        "pynndescent",
        "pandas",
        "platform_system",
        "platform_machine",
        "context_digest",
    ],
)
def test_previous_runtime_change_refits_full_population_without_loading_pickle(
    tmp_path, monkeypatch, changed_field
):
    import joblib

    from signal_semantic_lab import workspace_engine as engine

    # This tests coordinator routing, not density quality: the real algorithms
    # are exercised separately above and in the Linux offline receipt.
    vectors = np.eye(1024, dtype=np.float32)
    source = {
        root_id(index + 1): [(f"Complete delivery record {index}", vectors[0])]
        for index in range(42)
    }
    input_fixture(tmp_path / "input", source, guides=False)
    fitted = []

    def capture_fit(texts, matrix, _config, _labels, model_path):
        fitted.append((len(texts), len(matrix)))
        model_path.write_bytes(b"test-only model marker; never deserialize")
        return np.zeros(len(texts), dtype=np.int32), np.ones(len(texts)), {0: ["delivery"]}

    monkeypatch.setattr(engine, "_fit", capture_fit)
    monkeypatch.setattr(joblib, "load", lambda *_args, **_kwargs: pytest.fail("no old pickle"))
    previous = engine.run_workspace_engine(tmp_path / "input", tmp_path / "prior", tmp_path)
    if changed_field == "context_digest":
        previous["input_identity"][changed_field] = sha(b"previous context")
    else:
        previous["versions"][changed_field] = "incompatible"
    prior_path = tmp_path / "prior" / "manifest.json"
    prior_path.write_text(json.dumps(previous))
    result = engine.run_workspace_engine(
        tmp_path / "input",
        tmp_path / "refit",
        tmp_path,
        tmp_path / "prior",
        file_sha(prior_path),
    )
    assert fitted == [(42, 42), (42, 42)]
    assert result["status"] == "completed"
    assert result["parent_reuse"] == {
        "mode": "full_refit_only",
        "reason": "inputs_changed" if changed_field == "context_digest" else "runtime_changed",
        "lineage_available": True,
    }
    assert result["counts"]["full_refit_occurrences"] == 42
    assert result["counts"]["changed_occurrences"] == 0
    assert result["counts"]["predicted_occurrences"] == 0
    assert len(read_lines(tmp_path / "refit" / "assignments.open.jsonl")) == 42
    edges = json.loads((tmp_path / "refit" / "lineage.json").read_text())
    assert len(edges) == 1 and edges[0]["kind"] == "continuation"
