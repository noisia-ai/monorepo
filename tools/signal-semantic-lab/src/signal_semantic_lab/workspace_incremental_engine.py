"""Frozen-model delta and cohort discovery. Private numeric artifacts, never approval.

The full-fit v1 adapter is unchanged. This adapter uses its validators and real
BERTopic operations, with the same explicit input-memory limitation.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import shutil
import struct
import sys
import uuid
from collections import Counter
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np

from . import workspace_engine as base

INPUT_CONTRACT = "workspace-topic-incremental-input-v1"
OUTPUT_CONTRACT = "workspace-topic-incremental-output-v1"
POLICY = "workspace-frozen-model-cohort-v1"
PAGE_SIZE = 128
MODEL_BANK_MAX_BYTES = 4_294_967_296
ROOT_FIELDS = (
    "root_id",
    "root_fingerprint",
    "asset_sha256",
    "expected_chunks",
    "chunk_coverage_digest",
    "correction_digest",
)
EMPTY_HASH = "sha256:" + hashlib.sha256(b"").hexdigest()


def fail(code: str) -> Any:
    return base._fail("incremental_" + code)


def canonical(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, float) and item.is_integer():
            return int(item)
        return item

    return base._json(normalize(value))


def digest(value: Any) -> str:
    return base._hash_bytes(canonical(value).encode())


def membership_digest(row):
    # JSON exponent spelling differs between Python and JS. Preserve the exact
    # binary score only in the digest recipe; the public numeric value is intact.
    if not np.isfinite(row["strength"]):
        fail("membership_invalid")
    metadata = {key: value for key, value in row.items() if key != "strength"}
    return digest({**metadata, "strength_ieee754_be": struct.pack(">d", row["strength"]).hex()})


def exact(value: Any, fields: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != fields:
        fail("shape_invalid")


def descriptor(path: Path, rows: int | None = None) -> dict[str, Any]:
    return {
        "file": path.name,
        "sha256": base._hash_file(path),
        "bytes": path.stat().st_size,
        **({"rows": rows} if rows is not None else {}),
    }


def checked(directory: Path, ref: dict[str, Any]) -> Path:
    if not isinstance(ref, dict) or not {"file", "sha256", "bytes"} <= set(ref) <= {
        "file",
        "sha256",
        "bytes",
        "rows",
    }:
        fail("artifact_invalid")
    path = base._checked_file(directory, ref)
    if type(ref["bytes"]) is not int or path.stat().st_size != ref["bytes"]:
        fail("artifact_invalid")
    if "rows" in ref and base._natural(ref["rows"]) != sum(1 for _ in base._jsonl(path)):
        fail("artifact_rows_invalid")
    return path


def population(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in record.items() if key != "text"} for record in records]


def occurrence(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: record[key]
        for key in ("ordinal", "root_id", "chunk_index", "start", "end", "chunk_sha256")
    }


def coverage_hash(rows: list[dict[str, Any]]) -> str:
    hasher = hashlib.sha256()
    for row in rows:
        hasher.update(
            (
                base._json([row["chunk_index"], row["start"], row["end"], row["chunk_sha256"]])
                + "\n"
            ).encode()
        )
    return "sha256:" + hasher.hexdigest()


def root_metadata(records: list[dict[str, Any]], corrections: dict[str, str] | None = None):
    groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        groups.setdefault(record["root_id"], []).append(record)
    return [
        {
            "root_id": key,
            "root_fingerprint": rows[0]["root_fingerprint"],
            "asset_sha256": rows[0]["asset_sha256"],
            "expected_chunks": len(rows),
            "chunk_coverage_digest": coverage_hash(rows),
            "correction_digest": (corrections or {}).get(key, EMPTY_HASH),
        }
        for key, rows in sorted(groups.items())
    ]


def validate_roots(rows: list[dict[str, Any]]) -> None:
    prior = ""
    for row in rows:
        exact(row, set(ROOT_FIELDS))
        base._uuid(row["root_id"])
        if row["root_id"] <= prior:
            fail("root_order_invalid")
        prior = row["root_id"]
        base._natural(row["expected_chunks"], positive=True)
        for key in ROOT_FIELDS[1:]:
            if key != "expected_chunks" and not base._HASH.fullmatch(str(row[key])):
                fail("root_invalid")


def build_root_delta(prior: list[dict[str, Any]], current: list[dict[str, Any]]):
    validate_roots(prior)
    validate_roots(current)
    before, after = {r["root_id"]: r for r in prior}, {r["root_id"]: r for r in current}
    result = []
    for key in sorted(before.keys() | after.keys()):
        a, b = before.get(key), after.get(key)
        if a is None:
            state = "added"
        elif b is None:
            state = "removed_or_ineligible"
        elif any(
            a[field] != b[field]
            for field in ("asset_sha256", "expected_chunks", "chunk_coverage_digest")
        ):
            state = "content_changed"
        elif (
            a["root_fingerprint"] != b["root_fingerprint"]
            or a["correction_digest"] != b["correction_digest"]
        ):
            state = "metadata_changed"
        else:
            state = "unchanged"
        result.append({"root_id": key, "transition": state, "prior": a, "current": b})
    return result


def compatibility(manifest: dict[str, Any], guides: list[dict[str, Any]], vectors_sha: str):
    return {
        "embedding_config_digest": manifest["embedding_config_digest"],
        "chunk_policy_version": manifest["chunk_policy_version"],
        "context_digest": manifest["context_digest"],
        "input_interest_catalog_digest": manifest["catalog_digest"],
        "guides_digest": digest({"rows": guides, "vectors": vectors_sha}),
        "fit_config_digest": digest(manifest["config"]),
        "runtime_digest": digest(base._versions()),
    }


def membership(record, component, execution, pop_digest, label, strength, method):
    if not np.isfinite(strength):
        fail("algorithm_output_invalid")
    units = {unit["local_label"]: unit["unit_key"] for unit in component["units"]}
    if label == -1:
        return None
    if label not in units:
        fail("algorithm_label_invalid")
    return {
        **{
            key: record[key]
            for key in (
                "root_id",
                "root_fingerprint",
                "chunk_index",
                "start",
                "end",
                "chunk_sha256",
            )
        },
        "lane": component["lane"],
        "unit_key": units[label],
        "model_component_key": component["component_key"],
        "strength": float(strength),
        "model_origin": component["model_origin"],
        "evaluation_origin": {
            "execution_id": execution,
            "input_population_digest": pop_digest,
            "evaluation_key": digest([execution, component["component_key"], pop_digest, method]),
            "basis": method,
        },
        "carried_from": None,
    }


def _parent(directory, expected_hash, execution, workspace, identity):
    if base._hash_file(directory / "manifest.json") != expected_hash:
        fail("previous_manifest_hash_mismatch")
    manifest = base._read_json(directory / "manifest.json")
    if manifest.get("workspace_id") != workspace:
        fail("previous_workspace_mismatch")
    refs = {}
    for ref in manifest.get("artifacts", []):
        checked(directory, ref)
        if ref["file"] in refs:
            fail("artifact_duplicate")
        refs[ref["file"]] = ref
    legacy = manifest.get("contract_version") == base.OUTPUT_CONTRACT
    if not legacy and manifest.get("contract_version") != OUTPUT_CONTRACT:
        fail("previous_contract_invalid")
    if not legacy and manifest.get("execution_id") != execution:
        fail("previous_execution_invalid")
    required = {"population.jsonl", "roots.jsonl", "guides.jsonl", "guide-vectors.npy"}
    if not legacy:
        required |= {"memberships.jsonl", "pending-cohort.jsonl", "model-components.json"}
    if not required <= refs.keys():
        fail("previous_artifact_missing")
    guides = list(base._jsonl(directory / "guides.jsonl"))
    if legacy:
        prior_identity = compatibility(
            {**manifest["input_identity"], "config": manifest["config"]},
            guides,
            refs["guide-vectors.npy"]["sha256"],
        )
        if manifest.get("versions") != base._versions():
            fail("rebuild_required")
    else:
        prior_identity = manifest.get("compatibility")
    if prior_identity != identity:
        fail("rebuild_required")
    records = list(base._jsonl(directory / "population.jsonl"))
    records_digest = digest(records)
    roots_raw = list(base._jsonl(directory / "roots.jsonl"))
    roots = (
        root_metadata(records)
        if legacy
        else [{key: row[key] for key in ROOT_FIELDS} for row in roots_raw]
    )
    validate_roots(roots)
    if root_metadata(records, {row["root_id"]: row["correction_digest"] for row in roots}) != roots:
        fail("previous_population_invalid")
    if [row["root_id"] for row in roots_raw] != [row["root_id"] for row in roots]:
        fail("previous_root_coverage_invalid")
    components, members = [], []
    if legacy:
        for lane in manifest["lanes"]:
            if lane["model_file"] is None:
                continue
            required_lane = {lane["model_file"], lane["assignments_file"], lane["clusters_file"]}
            if lane["lane"] == "guided":
                required_lane.add("guide-center.npy")
            if not required_lane <= refs.keys():
                fail("previous_artifact_missing")
            assignments = list(base._jsonl(directory / lane["assignments_file"]))
            if len(assignments) != len(records):
                fail("previous_population_invalid")
            model_ref = refs[lane["model_file"]]
            center = refs["guide-center.npy"] if lane["lane"] == "guided" else None
            component = {
                "component_key": digest([execution, model_ref["sha256"], lane["lane"]]),
                "lane": lane["lane"],
                "model_origin": {
                    "execution_id": execution,
                    "model_artifact_sha256": model_ref["sha256"],
                },
                "model": model_ref,
                "center": center,
                "units": [],
            }
            by_label = {}
            for row in assignments:
                by_label.setdefault(row["local_label"], []).append(occurrence(row))
            for cluster in base._read_json(directory / lane["clusters_file"]):
                label = cluster["local_label"]
                selected = by_label.get(label, [])
                component["units"].append(
                    {
                        "local_label": label,
                        "unit_key": f"{lane['lane']}:{cluster['stable_cluster_id']}",
                        "birth_membership_digest": digest(selected),
                    }
                )
            for record, row in zip(records, assignments, strict=True):
                if occurrence(record) != occurrence(row):
                    fail("previous_population_invalid")
                item = membership(
                    record,
                    component,
                    execution,
                    records_digest,
                    row["local_label"],
                    row["strength"],
                    "fitted_member",
                )
                if item:
                    members.append(item)
            components.append(component)
        # A bootstrap below the fixed fit minimum has no frozen model yet. Its
        # entire population must remain eligible for the first cohort closure.
        pending = [] if components else records
    else:
        components = manifest["components"]
        if base._read_json(directory / "model-components.json") != components:
            fail("previous_component_invalid")
        members = list(base._jsonl(directory / "memberships.jsonl"))
        pending = list(base._jsonl(directory / "pending-cohort.jsonl"))
        if manifest["population_digest"] != records_digest or manifest["counts"][
            "occurrences"
        ] != len(records):
            fail("previous_population_invalid")
        if len(manifest["coverage"]) != len(components):
            fail("previous_coverage_invalid")
        for component in components:
            rows = [
                row
                for row in manifest["coverage"]
                if row["component_key"] == component["component_key"]
            ]
            if (
                len(rows) != 1
                or rows[0]["population_digest"] != records_digest
                or rows[0]["expected_occurrences"] != len(records)
                or sum(
                    rows[0][key]
                    for key in (
                        "copied_occurrences",
                        "transformed_occurrences",
                        "fitted_occurrences",
                    )
                )
                != len(records)
            ):
                fail("previous_coverage_invalid")
        current_records = {(row["root_id"], row["chunk_index"]): row for row in records}
        pending_roots = {row["root_id"] for row in pending}
        if pending != [row for row in records if row["root_id"] in pending_roots]:
            fail("previous_pending_invalid")
        if any(current_records.get((row["root_id"], row["chunk_index"])) != row for row in pending):
            fail("previous_pending_invalid")
        if manifest["counts"]["memberships"] != len(members) or manifest["counts"][
            "pending_occurrences"
        ] != len(pending):
            fail("previous_population_invalid")
    _validate_members(records, components, members)
    return manifest, records, roots, components, members, pending


def _validate_members(records, components, members):
    occurrences = {(row["root_id"], row["chunk_index"]): row for row in records}
    if len(occurrences) != len(records):
        fail("population_duplicate")
    models = {row["component_key"]: row for row in components}
    if len(models) != len(components):
        fail("component_duplicate")
    seen = set()
    model_units = {}
    for model in components:
        base._uuid(model["model_origin"]["execution_id"])
        if model["lane"] not in ("open", "guided") or model["component_key"] != digest(
            [model["model_origin"]["execution_id"], model["model"]["sha256"], model["lane"]]
        ):
            fail("model_origin_invalid")
        units = model["units"]
        if len({unit["local_label"] for unit in units}) != len(units) or len(
            {unit["unit_key"] for unit in units}
        ) != len(units):
            fail("unit_duplicate")
        if model["model"]["sha256"] != model["model_origin"]["model_artifact_sha256"]:
            fail("model_origin_invalid")
        if (model["center"] is not None) != (model["lane"] == "guided"):
            fail("component_invalid")
        for unit in units:
            base._natural(unit["local_label"])
            if not unit["unit_key"].startswith(model["lane"] + ":") or not base._HASH.fullmatch(
                unit["birth_membership_digest"]
            ):
                fail("unit_invalid")
            base._uuid(unit["unit_key"].split(":", 1)[1])
        model_units[model["component_key"]] = {unit["unit_key"] for unit in units}
    for row in members:
        key = (row["root_id"], row["chunk_index"], row["model_component_key"])
        original = occurrences.get(key[:2])
        model = models.get(key[2])
        if key in seen or original is None or model is None:
            fail("membership_invalid")
        seen.add(key)
        evaluation = row.get("evaluation_origin")
        exact(evaluation, {"execution_id", "input_population_digest", "evaluation_key", "basis"})
        base._uuid(evaluation["execution_id"])
        if (
            evaluation["basis"] not in ("fitted_member", "predicted_member")
            or not base._HASH.fullmatch(evaluation["input_population_digest"])
            or evaluation["evaluation_key"]
            != digest(
                [
                    evaluation["execution_id"],
                    model["component_key"],
                    evaluation["input_population_digest"],
                    evaluation["basis"],
                ]
            )
            or (
                evaluation["basis"] == "fitted_member"
                and evaluation["execution_id"] != model["model_origin"]["execution_id"]
            )
        ):
            fail("evaluation_origin_invalid")
        if (
            any(
                row[field] != original[field]
                for field in ("root_fingerprint", "start", "end", "chunk_sha256")
            )
            or row["lane"] != model["lane"]
            or row["unit_key"] not in model_units[model["component_key"]]
            or row["model_origin"] != model["model_origin"]
            or not np.isfinite(row["strength"])
        ):
            fail("membership_invalid")


def _copy_component(component, directory, stage):
    result = json.loads(json.dumps(component))
    for field, prefix, suffix in (("model", "model", "joblib"), ("center", "center", "npy")):
        ref = component[field]
        if ref is None:
            continue
        original = checked(directory, ref)
        destination = stage / f"{prefix}-{ref['sha256'][7:]}.{suffix}"
        if not destination.exists():
            shutil.copyfile(original, destination)
            destination.chmod(0o600)
        result[field] = descriptor(destination)
    return result


def _transform(
    component,
    indexes,
    records,
    matrix,
    stage,
    execution,
    pop_digest,
    guides,
    guide_vectors,
    operations,
):
    from joblib import load

    if not indexes:
        return []
    # All parent/artifact/runtime validation precedes this first deserialization.
    model = load(checked(stage, component["model"]), mmap_mode="r")
    center = (
        np.load(checked(stage, component["center"]), allow_pickle=False)
        if component["center"]
        else None
    )
    if center is not None and (center.shape != (1024,) or not np.isfinite(center).all()):
        fail("center_invalid")
    result, pages, max_rows = [], 0, 0
    for start in range(0, len(indexes), PAGE_SIZE):
        selected = indexes[start : start + PAGE_SIZE]
        block = np.asarray(matrix[selected])
        if component["lane"] == "guided":
            block, _labels, _stats, _center = base._guide_matrix(
                block, guides, guide_vectors, stage / "scratch-transform.npy", center
            )
        labels, strengths = model.transform(
            [records[index]["text"] for index in selected], embeddings=block
        )
        if len(labels) != len(selected) or len(strengths) != len(selected):
            fail("algorithm_output_invalid")
        for index, label, strength in zip(selected, labels, strengths, strict=True):
            if int(label) != label:
                fail("algorithm_label_invalid")
            row = membership(
                records[index],
                component,
                execution,
                pop_digest,
                int(label),
                strength,
                "predicted_member",
            )
            if row:
                result.append(row)
        pages += 1
        max_rows = max(max_rows, len(selected))
    operations.append(
        {
            "component_key": component["component_key"],
            "occurrences": len(indexes),
            "pages": pages,
            "maximum_page_rows": max_rows,
        }
    )
    return result


def _capacity(stage, components):
    import psutil

    names = {
        ref["file"] for model in components for ref in (model["model"], model["center"]) if ref
    }
    size = sum((stage / name).stat().st_size for name in names)
    if (
        size > MODEL_BANK_MAX_BYTES
        or psutil.Process().memory_info().rss
        > base.DEFAULT_WORKSPACE_ENGINE_CONFIG["memory_budget_bytes"]
    ):
        fail("capacity_exceeded")
    return size


def run_workspace_incremental_engine(
    input_dir: Path,
    output_dir: Path,
    storage_root: Path,
    previous_dir: Path,
    previous_manifest_sha256: str,
):
    started = perf_counter()
    input_dir = base._private_dir(input_dir, storage_root)
    output_dir = base._private_dir(output_dir, storage_root)
    previous_dir = base._private_dir(previous_dir, storage_root)
    if len({input_dir, output_dir, previous_dir}) != 3:
        fail("artifact_path_invalid")
    config = base._read_json(input_dir / "incremental.json")
    exact(
        config,
        {
            "contract_version",
            "workspace_id",
            "execution_id",
            "mode",
            "policy_version",
            "current_input_manifest",
            "current_roots",
            "parent",
            "compatibility",
            "discovery",
        },
    )
    if (
        config["contract_version"] != INPUT_CONTRACT
        or config["mode"] != "frozen-model-delta"
        or config["policy_version"] != POLICY
    ):
        fail("input_contract_invalid")
    exact(config["parent"], {"execution_id", "manifest_sha256"})
    exact(config["discovery"], {"cohort_key", "close_requested"})
    for value in (config["workspace_id"], config["execution_id"], config["parent"]["execution_id"]):
        base._uuid(value)
    if (
        type(config["discovery"]["close_requested"]) is not bool
        or config["parent"]["manifest_sha256"] != previous_manifest_sha256
    ):
        fail("parent_invalid")
    if checked(input_dir, config["current_input_manifest"]).name != "manifest.json":
        fail("input_manifest_invalid")
    manifest, records, matrix, guides, guide_vectors = base._load_input(input_dir)
    identity = compatibility(manifest, guides, manifest["guide_vectors"]["sha256"])
    if manifest["workspace_id"] != config["workspace_id"] or identity != config["compatibility"]:
        fail("input_identity_invalid")
    current_roots = list(base._jsonl(checked(input_dir, config["current_roots"])))
    validate_roots(current_roots)
    if (
        root_metadata(records, {row["root_id"]: row["correction_digest"] for row in current_roots})
        != current_roots
    ):
        fail("root_coverage_invalid")
    _manifest, _prior_records, prior_roots, prior_components, prior_members, pending = _parent(
        previous_dir,
        previous_manifest_sha256,
        config["parent"]["execution_id"],
        config["workspace_id"],
        identity,
    )
    transitions = build_root_delta(prior_roots, current_roots)
    delta_roots = {
        row["root_id"] for row in transitions if row["transition"] in ("added", "content_changed")
    }
    reusable = {
        row["root_id"]
        for row in transitions
        if row["transition"] in ("unchanged", "metadata_changed")
    }
    delta_indexes = [i for i, row in enumerate(records) if row["root_id"] in delta_roots]
    current_pop = population(records)
    pop_digest = digest(current_pop)
    # Pending entries are root-version references. Replaced/removed versions are
    # dropped only through this complete snapshot join, never hidden sampling.
    pending_roots = {row["root_id"] for row in pending}
    cohort_indexes = [
        i for i, row in enumerate(records) if row["root_id"] in delta_roots | pending_roots
    ]
    cohort_pop = [current_pop[i] for i in cohort_indexes]
    cohort_digest = digest(cohort_pop)
    cohort_key = digest({"policy_version": POLICY, "population": cohort_pop})
    if cohort_key != config["discovery"]["cohort_key"]:
        fail("cohort_invalid")
    request_digest = digest({"input": config, "runtime_digest": identity["runtime_digest"]})
    if output_dir.exists():
        receipt = base._read_json(output_dir / "manifest.json")
        if (
            receipt.get("request_digest") != request_digest
            or receipt.get("contract_version") != OUTPUT_CONTRACT
        ):
            fail("output_replay_mismatch")
        for ref in receipt["artifacts"]:
            checked(output_dir, ref)
        return {**receipt, "replayed": True}
    output_dir.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    stage = output_dir.parent / f".workspace-incremental-{uuid.uuid4()}"
    stage.mkdir(mode=0o700)
    try:
        components = [_copy_component(model, previous_dir, stage) for model in prior_components]
        _capacity(stage, components)
        current_lookup = {(row["root_id"], row["chunk_index"]): row for row in records}
        members = []
        for row in prior_members:
            if row["root_id"] in reusable:
                current = current_lookup[(row["root_id"], row["chunk_index"])]
                members.append(
                    {
                        **row,
                        "root_fingerprint": current["root_fingerprint"],
                        "carried_from": {
                            "output_manifest_sha256": previous_manifest_sha256,
                            "membership_digest": membership_digest(row),
                        },
                    }
                )
        base._write_jsonl(stage / "guides.jsonl", guides)
        np.save(stage / "guide-vectors.npy", np.asarray(guide_vectors), allow_pickle=False)
        operations: dict[str, list] = {"fit": [], "transform": []}
        coverage, candidates = [], []
        with (
            open(os.devnull, "w") as muted,
            contextlib.redirect_stdout(muted),
            contextlib.redirect_stderr(muted),
        ):
            for component in components:
                members.extend(
                    _transform(
                        component,
                        delta_indexes,
                        records,
                        matrix,
                        stage,
                        config["execution_id"],
                        pop_digest,
                        guides,
                        guide_vectors,
                        operations["transform"],
                    )
                )
                coverage.append(
                    {
                        "component_key": component["component_key"],
                        "population_digest": pop_digest,
                        "expected_occurrences": len(records),
                        "copied_occurrences": len(records) - len(delta_indexes),
                        "transformed_occurrences": len(delta_indexes),
                        "fitted_occurrences": 0,
                    }
                )
                _capacity(stage, components)
            minimum = max(
                manifest["config"][key]
                for key in ("hdbscan_min_cluster_size", "hdbscan_min_samples", "umap_n_neighbors")
            )
            fit_now = config["discovery"]["close_requested"] and len(cohort_indexes) > minimum
            if fit_now:
                cohort_records = [records[i] for i in cohort_indexes]
                cohort_matrix = np.asarray(matrix[cohort_indexes])
                outside = [
                    i
                    for i, row in enumerate(records)
                    if row["root_id"] not in delta_roots | pending_roots
                ]
                lanes = (
                    ["open", "guided"]
                    if any(row["role"].endswith("positive") for row in guides)
                    else ["open"]
                )
                for lane in lanes:
                    lane_matrix, seeds, center_ref = cohort_matrix, None, None
                    if lane == "guided":
                        lane_matrix, seeds, _stats, center = base._guide_matrix(
                            cohort_matrix, guides, guide_vectors, stage / "scratch-guided.npy"
                        )
                        center_path = stage / "new-center.npy"
                        np.save(center_path, center, allow_pickle=False)
                        center_name = stage / f"center-{base._hash_file(center_path)[7:]}.npy"
                        center_path.replace(center_name)
                        center_ref = descriptor(center_name)
                    model_path = stage / f"new-{lane}.joblib"
                    labels, strengths, terms = base._fit(
                        [row["text"] for row in cohort_records],
                        lane_matrix,
                        manifest["config"],
                        seeds,
                        model_path,
                    )
                    model_name = stage / f"model-{base._hash_file(model_path)[7:]}.joblib"
                    model_path.replace(model_name)
                    model_ref = descriptor(model_name)
                    component = {
                        "component_key": digest(
                            [config["execution_id"], model_ref["sha256"], lane]
                        ),
                        "lane": lane,
                        "model_origin": {
                            "execution_id": config["execution_id"],
                            "model_artifact_sha256": model_ref["sha256"],
                        },
                        "model": model_ref,
                        "center": center_ref,
                        "units": [],
                    }
                    for label in sorted(set(int(value) for value in labels) - {-1}):
                        indexes = np.flatnonzero(labels == label)
                        birth = digest(
                            [occurrence(cohort_records[int(index)]) for index in indexes]
                        )
                        name = f"{cohort_key}:{lane}:{label}:{birth}"
                        unit_key = f"{lane}:{uuid.uuid5(uuid.UUID(config['workspace_id']), name)}"
                        component["units"].append(
                            {
                                "local_label": label,
                                "unit_key": unit_key,
                                "birth_membership_digest": birth,
                            }
                        )
                        candidates.append(
                            {
                                "unit_key": unit_key,
                                "component_key": component["component_key"],
                                "birth_membership_digest": birth,
                                "root_count": len(
                                    {cohort_records[int(index)]["root_id"] for index in indexes}
                                ),
                                "chunk_count": len(indexes),
                                "terms": [term for term in terms.get(label, []) if term.strip()],
                                "representatives": base._select_representatives(
                                    cohort_records, indexes, strengths
                                ),
                            }
                        )
                    components.append(component)
                    _capacity(stage, components)
                    for row, label, strength in zip(cohort_records, labels, strengths, strict=True):
                        item = membership(
                            row,
                            component,
                            config["execution_id"],
                            cohort_digest,
                            int(label),
                            strength,
                            "fitted_member",
                        )
                        if item:
                            members.append(item)
                    members.extend(
                        _transform(
                            component,
                            outside,
                            records,
                            matrix,
                            stage,
                            config["execution_id"],
                            pop_digest,
                            guides,
                            guide_vectors,
                            operations["transform"],
                        )
                    )
                    operations["fit"].append(
                        {
                            "component_key": component["component_key"],
                            "occurrences": len(cohort_indexes),
                            "population_digest": cohort_digest,
                        }
                    )
                    coverage.append(
                        {
                            "component_key": component["component_key"],
                            "population_digest": pop_digest,
                            "expected_occurrences": len(records),
                            "copied_occurrences": 0,
                            "transformed_occurrences": len(outside),
                            "fitted_occurrences": len(cohort_indexes),
                        }
                    )
        members.sort(
            key=lambda row: (row["root_id"], row["chunk_index"], row["model_component_key"])
        )
        _validate_members(records, components, members)
        root_units: dict[str, set[str]] = {row["root_id"]: set() for row in current_roots}
        unit_roots: dict[str, set[str]] = {}
        for row in members:
            root_units[row["root_id"]].add(row["unit_key"])
            unit_roots.setdefault(row["unit_key"], set()).add(row["root_id"])
        old_units = {unit["unit_key"] for model in prior_components for unit in model["units"]}
        relations = []
        for candidate in candidates:
            target = unit_roots.get(candidate["unit_key"], set())
            overlaps = [
                {
                    "unit_key": key,
                    "shared_roots": len(target & unit_roots.get(key, set())),
                    "known_roots": len(unit_roots.get(key, set())),
                }
                for key in sorted(old_units)
                if target & unit_roots.get(key, set())
            ]
            relations.append(
                {
                    "candidate_unit_key": candidate["unit_key"],
                    "candidate_roots": len(target),
                    "overlaps": overlaps,
                    "status": "proposed",
                    "alias": None,
                }
            )
        pending_next = [] if fit_now else cohort_pop
        pending_next_roots = {row["root_id"] for row in pending_next}
        base._write_jsonl(stage / "population.jsonl", current_pop)
        base._write_jsonl(
            stage / "roots.jsonl",
            [
                {
                    **row,
                    "unit_keys": sorted(root_units[row["root_id"]]),
                    "state": "computed"
                    if root_units[row["root_id"]]
                    else "discovery_pending"
                    if row["root_id"] in pending_next_roots
                    else "outlier",
                    "discovery_pending": row["root_id"] in pending_next_roots,
                }
                for row in current_roots
            ],
        )
        base._write_jsonl(stage / "root-transitions.jsonl", transitions)
        base._write_jsonl(stage / "memberships.jsonl", members)
        base._write_jsonl(stage / "pending-cohort.jsonl", pending_next)
        base._write_json(stage / "model-components.json", components)
        base._write_json(stage / "candidate-groups.json", candidates)
        base._write_json(stage / "relations.json", relations)
        for name in ("scratch-transform.npy", "scratch-guided.npy"):
            (stage / name).unlink(missing_ok=True)
        counts = Counter(row["transition"] for row in transitions)
        import psutil

        receipt = {
            "contract_version": OUTPUT_CONTRACT,
            "workspace_id": config["workspace_id"],
            "execution_id": config["execution_id"],
            "request_digest": request_digest,
            "previous_manifest_sha256": previous_manifest_sha256,
            "compatibility": identity,
            "policy_version": POLICY,
            "status": "completed",
            "quality": "uncalibrated",
            "approval_policy": "none",
            "discovery_status": "complete"
            if fit_now or not cohort_pop
            else "pending_insufficient_population"
            if len(cohort_pop) <= minimum
            else "pending_cohort_close",
            "relations_status": "pending" if candidates else "none",
            "population_digest": pop_digest,
            "counts": {
                "roots": len(current_roots),
                "occurrences": len(records),
                "added_roots": counts["added"],
                "content_changed_roots": counts["content_changed"],
                "metadata_changed_roots": counts["metadata_changed"],
                "unchanged_roots": counts["unchanged"],
                "removed_roots": counts["removed_or_ineligible"],
                "delta_occurrences": len(delta_indexes),
                "cohort_occurrences": len(cohort_indexes),
                "pending_occurrences": len(pending_next),
                "memberships": len(members),
                "components": len(components),
                "new_components": len(operations["fit"]),
                "model_bank_bytes": _capacity(stage, components),
            },
            "components": components,
            "coverage": coverage,
            "operations": operations,
            "artifacts": [descriptor(path) for path in sorted(stage.iterdir())],
            "metrics": {
                "resident_bytes": psutil.Process().memory_info().rss,
                "elapsed_seconds": perf_counter() - started,
            },
            "limitations": [
                "Numeric membership is uncalibrated; no semantic aliases or approvals.",
                "Input records/texts and sparse output are in memory; "
                "not a two-million-root capacity proof.",
                "New components require historical inference; model bank disk/time "
                "grows until explicit consolidation.",
                "Manifest only: no database, monitoring admission, provider or Signal publication.",
            ],
        }
        base._write_json(stage / "manifest.json", receipt)
        for path in stage.iterdir():
            path.chmod(0o600)
        stage.rename(output_dir)
        return receipt
    except BaseException:
        shutil.rmtree(stage)
        raise


def describe_contract():
    return {
        "input_contract": INPUT_CONTRACT,
        "output_contract": OUTPUT_CONTRACT,
        "policy_version": POLICY,
        "page_size": PAGE_SIZE,
        "model_bank_max_bytes": MODEL_BANK_MAX_BYTES,
        "full_fit_profile": base.DEFAULT_WORKSPACE_ENGINE_CONFIG,
        "root_fields": list(ROOT_FIELDS),
        "quality": "uncalibrated",
        "approval_policy": "none",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--describe-contract", action="store_true")
    for name in ("input-dir", "output-dir", "storage-root", "previous-dir"):
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--previous-manifest-sha256")
    args = parser.parse_args()
    if args.describe_contract:
        print(canonical(describe_contract()))
        return 0
    if any(
        getattr(args, name) is None
        for name in (
            "input_dir",
            "output_dir",
            "storage_root",
            "previous_dir",
            "previous_manifest_sha256",
        )
    ):
        parser.error("all private directories and the previous manifest hash are required")
    try:
        receipt = run_workspace_incremental_engine(
            args.input_dir,
            args.output_dir,
            args.storage_root,
            args.previous_dir,
            args.previous_manifest_sha256,
        )
        print(canonical({"status": receipt["status"], "counts": receipt["counts"]}))
        return 0
    except Exception as error:
        code = (
            error.code
            if isinstance(error, base.WorkspaceEngineError)
            else "workspace_engine_incremental_failed"
        )
        print(canonical({"error_code": code}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
