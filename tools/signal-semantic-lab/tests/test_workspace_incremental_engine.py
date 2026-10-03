from __future__ import annotations

import copy
import json
import shutil
import socket
import uuid

import numpy as np
import pytest
from test_workspace_engine import WORKSPACE, file_sha, read_lines, root_id, sha
from test_workspace_engine import input_fixture as legacy_input_fixture

from signal_semantic_lab import workspace_engine as base
from signal_semantic_lab import workspace_incremental_engine as inc


def input_fixture(directory, source, *, guides=True):
    manifest = legacy_input_fixture(directory, source, guides=guides)
    # Reuse the complete v1 wire while keeping these synthetic snapshot IDs
    # deterministic, independent of the test directory and wall clock.
    for key in ("preparation_run_id", "embedding_run_id"):
        identity = f"{key}:{manifest['records']['sha256']}:{manifest['guide_vectors']['sha256']}"
        manifest[key] = str(uuid.uuid5(uuid.UUID(WORKSPACE), identity))
    base._write_json(directory / "manifest.json", manifest)
    return manifest


def prepare(
    directory,
    source,
    parent_dir,
    parent_execution,
    execution,
    *,
    metadata=False,
    close=True,
    guides=True,
):
    manifest = input_fixture(directory, source, guides=guides)
    records = read_lines(directory / "chunks.jsonl")
    corrections = {}
    if metadata:
        for record in records:
            if record["root_id"] == root_id(2):
                record["root_fingerprint"] = sha(b"new legitimate provenance")
        corrections[root_id(3)] = sha(b"current correction")
        base._write_jsonl(directory / "chunks.jsonl", records)
        manifest["records"]["sha256"] = file_sha(directory / "chunks.jsonl")
        base._write_json(directory / "manifest.json", manifest)
    roots = inc.root_metadata(records, corrections)
    base._write_jsonl(directory / "current-roots.jsonl", roots)
    old_manifest = base._read_json(parent_dir / "manifest.json")
    old_pop = read_lines(parent_dir / "population.jsonl")
    old_roots = (
        inc.root_metadata(old_pop)
        if old_manifest["contract_version"] == base.OUTPUT_CONTRACT
        else [
            {key: row[key] for key in inc.ROOT_FIELDS}
            for row in read_lines(parent_dir / "roots.jsonl")
        ]
    )
    delta = inc.build_root_delta(old_roots, roots)
    changed = {row["root_id"] for row in delta if row["transition"] in ("added", "content_changed")}
    pending = (
        (
            {row["root_id"] for row in old_pop}
            if not any(row["model_file"] for row in old_manifest["lanes"])
            else set()
        )
        if old_manifest["contract_version"] == base.OUTPUT_CONTRACT
        else {row["root_id"] for row in read_lines(parent_dir / "pending-cohort.jsonl")}
    )
    config = {
        "contract_version": inc.INPUT_CONTRACT,
        "workspace_id": WORKSPACE,
        "execution_id": execution,
        "mode": "frozen-model-delta",
        "policy_version": inc.POLICY,
        "current_input_manifest": inc.descriptor(directory / "manifest.json"),
        "current_roots": inc.descriptor(directory / "current-roots.jsonl", len(roots)),
        "parent": {
            "execution_id": parent_execution,
            "manifest_sha256": file_sha(parent_dir / "manifest.json"),
        },
        "compatibility": inc.compatibility(
            manifest,
            read_lines(directory / "guides.jsonl"),
            file_sha(directory / "guide-vectors.npy"),
        ),
        "discovery": {
            "close_requested": close,
            "cohort_key": inc.digest(
                {
                    "policy_version": inc.POLICY,
                    "population": [
                        row
                        for row in inc.population(records)
                        if row["root_id"] in changed | pending
                    ],
                }
            ),
        },
    }
    base._write_json(directory / "incremental.json", config)
    return config


@pytest.fixture(scope="module")
def waves(tmp_path_factory):
    storage = tmp_path_factory.mktemp("incremental-real")
    patch = pytest.MonkeyPatch()
    external = []

    def deny(_self, address):
        external.append(address)
        raise RuntimeError("test forbids all networking")

    patch.setattr(socket.socket, "connect", deny)
    patch.setenv("HF_HUB_OFFLINE", "1")
    patch.setenv("TRANSFORMERS_OFFLINE", "1")
    patch.setenv("TOKENIZERS_PARALLELISM", "false")
    rng = np.random.default_rng(1709)
    vocabulary = [
        "delivery courier parcel shipment",
        "service support refund telephone",
        "electric battery charger energy",
    ]

    def piece(group, index):
        vector = rng.normal(0, 0.004, 1024).astype(np.float32)
        vector[group] += 1
        vector /= np.linalg.norm(vector)
        return f"Synthetic 🌞 {vocabulary[group]} complete statement {index}. ", vector

    first = {root_id(i): [piece(0 if i <= 120 else 1, i)] for i in range(1, 241)}
    first[root_id(1)] = [piece(i % 2, 1000 + i) for i in range(133)]
    first[root_id(4)] = list(
        first[root_id(5)]
    )  # Equal content is not authority to drop an occurrence.
    second = {key: list(values) for key, values in first.items()}
    for i in [*range(10, 15), *range(130, 135)]:
        del second[root_id(i)]
    second[root_id(1)].append(piece(2, 5000))
    for i, group in [(20, 0), (140, 1), (141, 1)]:
        second[root_id(i)] = [piece(group, 6000 + i)]
    for i in range(300, 460):
        second[root_id(i)] = [piece(0 if i < 380 else 2, i)]
    third = {key: list(values) for key, values in second.items()}
    del third[root_id(380)]
    third[root_id(381)] = [piece(0, 7000)]
    for i in range(460, 472):
        third[root_id(i)] = [piece(2, i)]
    first_input, first_output = storage / "input1", storage / "output1"
    input_fixture(first_input, first)
    first_receipt = base.run_workspace_engine(first_input, first_output, storage)
    second_input, second_output = storage / "input2", storage / "output2"
    second_config = prepare(
        second_input, second, first_output, root_id(9001), root_id(9002), metadata=True
    )
    second_receipt = inc.run_workspace_incremental_engine(
        second_input,
        second_output,
        storage,
        first_output,
        second_config["parent"]["manifest_sha256"],
    )
    third_input, third_output = storage / "input3", storage / "output3"
    third_config = prepare(
        third_input, third, second_output, root_id(9002), root_id(9003), metadata=True
    )
    third_receipt = inc.run_workspace_incremental_engine(
        third_input, third_output, storage, second_output, third_config["parent"]["manifest_sha256"]
    )
    try:
        yield {
            "storage": storage,
            "sources": [first, second, third],
            "external": external,
            "inputs": [first_input, second_input, third_input],
            "outputs": [first_output, second_output, third_output],
            "receipts": [first_receipt, second_receipt, third_receipt],
            "configs": [second_config, third_config],
        }
    finally:
        patch.undo()


def test_three_real_waves_preserve_full_delta_known_identity_and_emergence(waves):
    first, second, third = waves["receipts"]
    assert [(r["counts"]["roots"], r["counts"]["occurrences"]) for r in [first, second, third]] == [
        (240, 372),
        (390, 523),
        (401, 534),
    ]
    assert second["counts"]["delta_occurrences"] == 297
    assert second["counts"]["added_roots"] == 160
    assert second["counts"]["content_changed_roots"] == 4
    assert second["counts"]["metadata_changed_roots"] == 2
    assert second["counts"]["removed_roots"] == 10
    assert second["counts"]["unchanged_roots"] == 224
    assert [fit["occurrences"] for fit in second["operations"]["fit"]] == [297, 297]
    assert third["operations"]["fit"] == []
    assert third["counts"]["delta_occurrences"] == third["counts"]["pending_occurrences"] == 13
    assert third["discovery_status"] == "pending_insufficient_population"
    assert all(
        row["maximum_page_rows"] <= 128
        for r in [second, third]
        for row in r["operations"]["transform"]
    )
    for receipt in [second, third]:
        for row in receipt["coverage"]:
            assert row["expected_occurrences"] == receipt["counts"]["occurrences"]
            assert (
                sum(
                    row[key]
                    for key in (
                        "copied_occurrences",
                        "transformed_occurrences",
                        "fitted_occurrences",
                    )
                )
                == row["expected_occurrences"]
            )
        assert receipt["quality"] == "uncalibrated" and receipt["approval_policy"] == "none"
    members2 = read_lines(waves["outputs"][1] / "memberships.jsonl")
    members3 = read_lines(waves["outputs"][2] / "memberships.jsonl")
    new_components = {row["component_key"] for row in second["operations"]["fit"]}
    last_chunk = {
        row["unit_key"]
        for row in members2
        if row["root_id"] == root_id(1)
        and row["chunk_index"] == 133
        and row["model_component_key"] in new_components
        and row["lane"] == "open"
    }
    c_units = {
        row["unit_key"]
        for row in members2
        if row["root_id"] == root_id(390)
        and row["model_component_key"] in new_components
        and row["lane"] == "open"
    }
    assert last_chunk & c_units, "novel C also belongs to a root already assigned to known A/B"
    for i in range(460, 472):
        assert c_units & {row["unit_key"] for row in members3 if row["root_id"] == root_id(i)}, (
            "C retains its component unit ID on wave3"
        )
    assert not any(row["root_id"] == root_id(380) for row in members3)
    assert not c_units & {row["unit_key"] for row in members3 if row["root_id"] == root_id(381)}, (
        "changed text cannot carry its previous membership"
    )
    assert any(
        row["model_origin"]["execution_id"] == root_id(9001)
        and row["evaluation_origin"]["execution_id"] == root_id(9002)
        and row["evaluation_origin"]["basis"] == "predicted_member"
        for row in members2
    )
    assert any(row["root_id"] == root_id(1) and row["carried_from"] for row in members3)
    relations = json.loads((waves["outputs"][1] / "relations.json").read_text())
    assert relations and all(
        row["alias"] is None and row["status"] == "proposed" for row in relations
    )
    assert waves["external"] == []


def test_metadata_change_reuses_only_numeric_evidence_and_replay_performs_no_algorithm(
    waves, monkeypatch
):
    members = read_lines(waves["outputs"][1] / "memberships.jsonl")
    old_components = {row["component_key"] for row in waves["receipts"][1]["components"]} - {
        row["component_key"] for row in waves["receipts"][1]["operations"]["fit"]
    }
    row = next(
        row
        for row in members
        if row["root_id"] == root_id(2) and row["model_component_key"] in old_components
    )
    assert row["root_fingerprint"] == sha(b"new legitimate provenance")
    assert row["evaluation_origin"]["execution_id"] == root_id(9001) and row["carried_from"]
    assert "approval" not in row and "correction_operation_id" not in row
    import joblib

    monkeypatch.setattr(
        joblib, "load", lambda *_a, **_k: pytest.fail("replay must not deserialize")
    )
    monkeypatch.setattr(base, "_fit", lambda *_a, **_k: pytest.fail("replay must not fit"))
    before = file_sha(waves["outputs"][1] / "manifest.json")
    replay = inc.run_workspace_incremental_engine(
        waves["inputs"][1],
        waves["outputs"][1],
        waves["storage"],
        waves["outputs"][0],
        waves["configs"][0]["parent"]["manifest_sha256"],
    )
    assert replay["replayed"] and file_sha(waves["outputs"][1] / "manifest.json") == before


def test_atomic_failure_and_sha_runtime_parent_guards_before_deserialization(
    waves, tmp_path, monkeypatch
):
    storage = waves["storage"]
    source = waves["inputs"][1]
    parent = waves["outputs"][0]
    import joblib

    monkeypatch.setattr(
        joblib, "load", lambda *_a, **_k: pytest.fail("invalid parent must not deserialize")
    )
    with pytest.raises(base.WorkspaceEngineError, match="incremental_parent_invalid"):
        inc.run_workspace_incremental_engine(
            source, storage / "bad-hash-result", storage, parent, sha(b"incorrect")
        )
    bad_hash_input = storage / "bad-hash-input"
    shutil.copytree(source, bad_hash_input)
    config = base._read_json(bad_hash_input / "incremental.json")
    config["parent"]["manifest_sha256"] = sha(b"incorrect")
    base._write_json(bad_hash_input / "incremental.json", config)
    with pytest.raises(base.WorkspaceEngineError, match="previous_manifest_hash_mismatch"):
        inc.run_workspace_incremental_engine(
            bad_hash_input, storage / "bad-hash-result", storage, parent, sha(b"incorrect")
        )
    copied = storage / "runtime-parent"
    shutil.copytree(parent, copied)
    receipt = base._read_json(copied / "manifest.json")
    receipt["versions"]["python"] = "0.0.0"
    base._write_json(copied / "manifest.json", receipt)
    edited_input = storage / "runtime-input"
    shutil.copytree(source, edited_input)
    config = base._read_json(edited_input / "incremental.json")
    config["parent"]["manifest_sha256"] = file_sha(copied / "manifest.json")
    base._write_json(edited_input / "incremental.json", config)
    with pytest.raises(base.WorkspaceEngineError, match="rebuild_required"):
        inc.run_workspace_incremental_engine(
            edited_input,
            storage / "runtime-result",
            storage,
            copied,
            config["parent"]["manifest_sha256"],
        )
    assert not (storage / "runtime-result").exists()
    tampered = storage / "tampered-parent"
    shutil.copytree(parent, tampered)
    model_file = next(row["model_file"] for row in receipt["lanes"] if row["model_file"])
    (tampered / model_file).write_bytes(b"not a model")
    with pytest.raises(base.WorkspaceEngineError, match="artifact_hash_mismatch"):
        inc.run_workspace_incremental_engine(
            source,
            storage / "tamper-result",
            storage,
            tampered,
            waves["configs"][0]["parent"]["manifest_sha256"],
        )


def test_duplicate_or_missing_chunks_are_rejected_and_output_never_partial(waves, monkeypatch):
    source = waves["storage"] / "duplicate-input"
    shutil.copytree(waves["inputs"][1], source)
    records = read_lines(source / "chunks.jsonl")
    records[1] = copy.deepcopy(records[0])
    base._write_jsonl(source / "chunks.jsonl", records)
    manifest = base._read_json(source / "manifest.json")
    manifest["records"]["sha256"] = file_sha(source / "chunks.jsonl")
    base._write_json(source / "manifest.json", manifest)
    config = base._read_json(source / "incremental.json")
    config["current_input_manifest"] = inc.descriptor(source / "manifest.json")
    base._write_json(source / "incremental.json", config)
    output = waves["storage"] / "duplicate-output"
    with pytest.raises(base.WorkspaceEngineError, match="population_order_invalid"):
        inc.run_workspace_incremental_engine(
            source,
            output,
            waves["storage"],
            waves["outputs"][0],
            config["parent"]["manifest_sha256"],
        )
    assert not output.exists()
    # Failure after staging starts still cannot publish an output manifest.
    monkeypatch.setattr(
        inc,
        "_transform",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("simulated local crash")),
    )
    output = waves["storage"] / "crash-output"
    with pytest.raises(RuntimeError, match="simulated local crash"):
        inc.run_workspace_incremental_engine(
            waves["inputs"][1],
            output,
            waves["storage"],
            waves["outputs"][0],
            waves["configs"][0]["parent"]["manifest_sha256"],
        )
    assert not output.exists()
    assert not list(waves["storage"].glob(".workspace-incremental-*"))


def test_pending_cohort_survives_duplicate_snapshot_and_reconciles_retirement(waves, monkeypatch):
    monkeypatch.setattr(base, "_fit", lambda *_a, **_k: pytest.fail("small cohort must not fit"))
    storage = waves["storage"]
    source = dict(waves["sources"][2])
    del source[root_id(460)]
    source[root_id(461)] = list(source[root_id(462)])
    input_dir, output = storage / "pending-input", storage / "pending-output"
    config = prepare(
        input_dir, source, waves["outputs"][2], root_id(9003), root_id(9004), metadata=True
    )
    result = inc.run_workspace_incremental_engine(
        input_dir, output, storage, waves["outputs"][2], config["parent"]["manifest_sha256"]
    )
    assert (result["counts"]["roots"], result["counts"]["occurrences"]) == (400, 533)
    assert result["counts"]["delta_occurrences"] == 1
    assert result["counts"]["pending_occurrences"] == 12
    pending = read_lines(output / "pending-cohort.jsonl")
    assert root_id(460) not in {row["root_id"] for row in pending}
    current = read_lines(input_dir / "chunks.jsonl")
    assert (
        next(row for row in pending if row["root_id"] == root_id(461))["chunk_sha256"]
        == next(row for row in current if row["root_id"] == root_id(461))["chunk_sha256"]
    )
    duplicate_input, duplicate_output = storage / "unchanged-input", storage / "unchanged-output"
    duplicate = prepare(
        duplicate_input, source, output, root_id(9004), root_id(9005), metadata=True
    )
    monkeypatch.setattr(
        inc,
        "_transform",
        lambda *_a, **_k: [] if not _a[1] else pytest.fail("identical snapshot must not transform"),
    )
    same = inc.run_workspace_incremental_engine(
        duplicate_input, duplicate_output, storage, output, duplicate["parent"]["manifest_sha256"]
    )
    assert same["counts"]["delta_occurrences"] == 0 and same["counts"]["pending_occurrences"] == 12
    assert same["counts"]["memberships"] == result["counts"]["memberships"]
    assert same["operations"] == {"fit": [], "transform": []}
    assert all(row["carried_from"] for row in read_lines(duplicate_output / "memberships.jsonl"))


def test_zero_guides_small_bootstrap_keeps_every_root_pending_without_fallback(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(base, "_fit", lambda *_a, **_k: pytest.fail("minimum cannot be lowered"))
    vector = np.eye(1024, dtype=np.float32)[0]
    source = {root_id(i): [(f"Synthetic unassigned root {i}.", vector)] for i in range(1, 4)}
    parent_input, parent_output = tmp_path / "first-input", tmp_path / "first-output"
    input_fixture(parent_input, source, guides=False)
    base.run_workspace_engine(parent_input, parent_output, tmp_path)
    source[root_id(4)] = [("Synthetic next root.", vector)]
    current_input, current_output = tmp_path / "next-input", tmp_path / "next-output"
    config = prepare(
        current_input, source, parent_output, root_id(8001), root_id(8002), guides=False
    )
    result = inc.run_workspace_incremental_engine(
        current_input, current_output, tmp_path, parent_output, config["parent"]["manifest_sha256"]
    )
    assert result["counts"]["roots"] == result["counts"]["pending_occurrences"] == 4
    assert result["counts"]["delta_occurrences"] == 1
    assert result["counts"]["components"] == result["counts"]["memberships"] == 0
    assert result["discovery_status"] == "pending_insufficient_population"
    assert read_lines(current_output / "guides.jsonl") == []
    assert all(
        row["state"] == "discovery_pending" and row["discovery_pending"]
        for row in read_lines(current_output / "roots.jsonl")
    )


def test_model_bank_capacity_is_explicit_and_never_truncates_components(waves, monkeypatch):
    monkeypatch.setattr(inc, "MODEL_BANK_MAX_BYTES", 1)
    import joblib

    monkeypatch.setattr(
        joblib, "load", lambda *_a, **_k: pytest.fail("oversized bank must not deserialize")
    )
    output = waves["storage"] / "capacity-output"
    with pytest.raises(base.WorkspaceEngineError, match="incremental_capacity_exceeded"):
        inc.run_workspace_incremental_engine(
            waves["inputs"][1],
            output,
            waves["storage"],
            waves["outputs"][0],
            waves["configs"][0]["parent"]["manifest_sha256"],
        )
    assert not output.exists()
    assert not list(waves["storage"].glob(".workspace-incremental-*"))


def test_complete_retirement_publishes_zero_roots_without_fit_or_deserialization(
    waves, monkeypatch
):
    import joblib

    monkeypatch.setattr(
        joblib, "load", lambda *_a, **_k: pytest.fail("empty corpus must not deserialize")
    )
    monkeypatch.setattr(base, "_fit", lambda *_a, **_k: pytest.fail("empty corpus must not fit"))
    directory, output = waves["storage"] / "empty-input", waves["storage"] / "empty-output"
    config = prepare(directory, {}, waves["outputs"][2], root_id(9003), root_id(9006))
    result = inc.run_workspace_incremental_engine(
        directory,
        output,
        waves["storage"],
        waves["outputs"][2],
        config["parent"]["manifest_sha256"],
    )
    assert (
        result["counts"]["roots"]
        == result["counts"]["occurrences"]
        == result["counts"]["memberships"]
        == result["counts"]["pending_occurrences"]
        == 0
    )
    assert result["counts"]["removed_roots"] == 401
    assert result["operations"] == {"fit": [], "transform": []}
    for name in ("roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl"):
        assert read_lines(output / name) == []
    assert all(
        row["transition"] == "removed_or_ineligible"
        for row in read_lines(output / "root-transitions.jsonl")
    )
    assert all(row["expected_occurrences"] == 0 for row in result["coverage"])


@pytest.mark.parametrize("kind", ["model", "evaluation"])
def test_parent_origin_corruption_rejected_before_deserialization(waves, monkeypatch, kind):
    import joblib

    monkeypatch.setattr(
        joblib, "load", lambda *_a, **_k: pytest.fail("corrupt origin must not deserialize")
    )
    directory = waves["storage"] / f"{kind}-origin-input"
    parent = waves["storage"] / f"{kind}-origin-parent"
    output = waves["storage"] / f"{kind}-origin-output"
    shutil.copytree(waves["inputs"][2], directory)
    shutil.copytree(waves["outputs"][1], parent)
    receipt = base._read_json(parent / "manifest.json")
    if kind == "model":
        receipt["components"][0]["model_origin"]["execution_id"] = root_id(9099)
        filename = "model-components.json"
        base._write_json(parent / filename, receipt["components"])
    else:
        filename = "memberships.jsonl"
        rows = read_lines(parent / filename)
        rows[0]["evaluation_origin"]["execution_id"] = root_id(9099)
        base._write_jsonl(parent / filename, rows)
    receipt["artifacts"] = [
        inc.descriptor(parent / filename) if row["file"] == filename else row
        for row in receipt["artifacts"]
    ]
    base._write_json(parent / "manifest.json", receipt)
    config = base._read_json(directory / "incremental.json")
    config["parent"]["manifest_sha256"] = file_sha(parent / "manifest.json")
    base._write_json(directory / "incremental.json", config)
    with pytest.raises(base.WorkspaceEngineError, match=f"incremental_{kind}_origin_invalid"):
        inc.run_workspace_incremental_engine(
            directory, output, waves["storage"], parent, config["parent"]["manifest_sha256"]
        )
    assert not output.exists()


def test_membership_digest_preserves_score_bits_across_json_spellings():
    row = {"root_id": root_id(1), "strength": 0.00001}
    assert inc.membership_digest(row) == inc.digest(
        {"root_id": root_id(1), "strength_ieee754_be": "3ee4f8b588e368f1"}
    )
    assert inc.membership_digest({**row, "strength": 0.0}) != inc.membership_digest(
        {**row, "strength": -0.0}
    )
