"""Workspace-native BERTopic adapter. No database, provider, approval or serving.

Every input occurrence participates in open discovery. Guidance is a separate
fit with precomputed seeds; its labels are proposals, never approval authority.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import sys
import uuid
from collections import defaultdict
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np

INPUT_CONTRACT = "workspace-topic-engine-input-v1"
OUTPUT_CONTRACT = "workspace-topic-engine-output-v1"
REPRESENTATIVE_SELECTION_POLICY = "distinct-roots-affiliation-boundary-v1"
DEFAULT_WORKSPACE_ENGINE_CONFIG = {
    "profile_version": "workspace-bertopic-guided-open-v1",
    "seed": 17,
    "language_families": ["es", "en"],
    "umap_n_neighbors": 15,
    "umap_n_components": 8,
    "umap_min_dist": 0.0,
    "hdbscan_min_cluster_size": 40,
    "hdbscan_min_samples": 5,
    "cluster_selection_method": "leaf",
    "vectorizer_min_df": 1,
    "vectorizer_max_df": 1.0,
    "vectorizer_max_features": 50_000,
    "ngram_min": 1,
    "ngram_max": 3,
    "top_n_words": 15,
    "guide_mix": 0.25,
    "lineage_min_common_roots": 2,
    "lineage_min_fraction": 0.5,
    "memory_budget_bytes": 4_294_967_296,
}
_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_NAME = re.compile(r"^[a-z][a-z0-9_.-]{0,100}$")
_ROLES = {"topic_positive", "topic_negative", "scope_positive", "scope_negative"}


class WorkspaceEngineError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> Any:
    raise WorkspaceEngineError("workspace_engine_" + code)


def _json(value: Any) -> str:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    )


def _hash_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _hash_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return "sha256:" + result.hexdigest()


def _read_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text("utf-8"), parse_constant=lambda _value: _fail("json_invalid")
        )
    except (ValueError, OSError, UnicodeError):
        return _fail("json_invalid")


def _private_dir(path: Path, storage_root: Path) -> Path:
    root = storage_root.resolve(strict=True)
    actual = path.resolve()
    if actual == root or not actual.is_relative_to(root) or path.is_symlink():
        return _fail("artifact_path_invalid")
    return actual


def _file(directory: Path, name: str) -> Path:
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        return _fail("artifact_name_invalid")
    path = directory / name
    if path.is_symlink() or path.resolve().parent != directory.resolve():
        return _fail("artifact_path_invalid")
    return path


def _checked_file(directory: Path, descriptor: dict[str, Any]) -> Path:
    path = _file(directory, descriptor["file"])
    if (
        not _HASH.fullmatch(str(descriptor.get("sha256", "")))
        or _hash_file(path) != descriptor["sha256"]
    ):
        return _fail("artifact_hash_mismatch")
    return path


def _uuid(value: Any) -> str:
    try:
        normalized = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        return _fail("identity_invalid")
    if normalized != value:
        return _fail("identity_invalid")
    return normalized


def _natural(value: Any, *, positive: bool = False) -> int:
    if type(value) is not int or value < (1 if positive else 0):
        return _fail("count_invalid")
    return value


def _write_json(path: Path, value: Any) -> None:
    path.write_text(_json(value) + "\n", encoding="utf-8")
    path.chmod(0o600)


def _write_jsonl(path: Path, values: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for value in values:
            handle.write(_json(value) + "\n")
    path.chmod(0o600)


def _jsonl(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                yield json.loads(line, parse_constant=lambda _value: _fail("json_invalid"))
            except (ValueError, UnicodeError):
                _fail("json_invalid")


def _versions() -> dict[str, str]:
    packages = [
        "bertopic",
        "hdbscan",
        "umap-learn",
        "numpy",
        "scikit-learn",
        "joblib",
        "scipy",
        "numba",
        "llvmlite",
        "pynndescent",
        "pandas",
    ]
    return {
        "python": platform.python_version(),
        "platform_system": platform.system(),
        "platform_machine": platform.machine(),
        **{name: importlib.metadata.version(name) for name in packages},
    }


def _matrix(directory: Path, descriptor: dict[str, Any]) -> np.ndarray:
    if descriptor.get("dimensions") != 1024 or descriptor.get("dtype") != "float32":
        return _fail("embedding_profile_invalid")
    _natural(descriptor.get("rows"))
    try:
        matrix = np.load(
            _checked_file(directory, descriptor),
            mmap_mode="r" if descriptor["rows"] else None,
            allow_pickle=False,
        )
    except (ValueError, OSError):
        return _fail("embedding_matrix_invalid")
    if matrix.dtype != np.dtype("float32") or matrix.shape != (descriptor["rows"], 1024):
        return _fail("embedding_matrix_invalid")
    for start in range(0, len(matrix), 1024):
        block = matrix[start : start + 1024]
        if not np.isfinite(block).all() or np.any(np.linalg.norm(block, axis=1) == 0):
            return _fail("embedding_matrix_invalid")
    return matrix


def _load_input(
    directory: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], np.ndarray, list[dict[str, Any]], np.ndarray]:
    manifest = _read_json(directory / "manifest.json")
    if (
        manifest.get("contract_version") != INPUT_CONTRACT
        or manifest.get("config") != DEFAULT_WORKSPACE_ENGINE_CONFIG
    ):
        return _fail("input_profile_invalid")
    for key in ["workspace_id", "preparation_run_id", "embedding_run_id"]:
        _uuid(manifest.get(key))
    if not re.fullmatch(r"[1-9][0-9]*", str(manifest.get("input_revision", ""))):
        return _fail("input_revision_invalid")
    for key in ["embedding_config_digest", "context_digest", "catalog_digest"]:
        if not _HASH.fullmatch(str(manifest.get(key, ""))):
            return _fail("identity_invalid")
    if manifest.get("chunk_policy_version") != "corpus-text-chunks-v1":
        return _fail("chunk_policy_invalid")
    records_file = _checked_file(directory, manifest["records"])
    matrix = _matrix(directory, manifest["vectors"])
    if manifest["records"]["rows"] != len(matrix):
        return _fail("population_mismatch")
    # This is a conservative input lower-bound guard, not a guarantee that UMAP's
    # graphs/dataframes fit. Output reports RSS; no sample is substituted on failure.
    lower_bound = matrix.nbytes * 4 + records_file.stat().st_size * 4
    if lower_bound > manifest["config"]["memory_budget_bytes"]:
        return _fail("capacity_exceeded")
    records = []
    prior_key: tuple[str, int] | None = None
    current_root: dict[str, Any] | None = None
    root_hash = hashlib.sha256()
    expected_index = offset = roots = 0

    def finish_root() -> None:
        if current_root and (
            expected_index != current_root["expected_chunks"]
            or "sha256:" + root_hash.hexdigest() != current_root["asset_sha256"]
        ):
            _fail("root_coverage_incomplete")

    for ordinal, record in enumerate(_jsonl(records_file)):
        _uuid(record.get("root_id"))
        for key in ["root_fingerprint", "asset_sha256", "chunk_sha256"]:
            if not _HASH.fullmatch(str(record.get(key, ""))):
                _fail("identity_invalid")
        if record.get("ordinal") != ordinal:
            _fail("population_order_invalid")
        key = (record["root_id"], _natural(record.get("chunk_index")))
        if prior_key is not None and key <= prior_key:
            _fail("population_order_invalid")
        if current_root is None or current_root["root_id"] != record["root_id"]:
            finish_root()
            current_root = record
            roots += 1
            expected_index = offset = 0
            root_hash = hashlib.sha256()
        elif any(
            record[name] != current_root[name]
            for name in ["root_fingerprint", "asset_sha256", "expected_chunks"]
        ):
            _fail("root_identity_invalid")
        _natural(record.get("expected_chunks"), positive=True)
        text = record.get("text")
        if not isinstance(text, str) or not text:
            _fail("chunk_invalid")
        encoded = text.encode("utf-8")
        code_units = len(text.encode("utf-16-le")) // 2
        if (
            code_units > 1400
            or record["chunk_index"] != expected_index
            or record.get("start") != offset
            or record.get("end") != offset + code_units
            or _hash_bytes(encoded) != record["chunk_sha256"]
        ):
            _fail("chunk_invalid")
        root_hash.update(encoded)
        expected_index += 1
        offset += code_units
        records.append(record)
        prior_key = key
    finish_root()
    if len(records) != manifest["records"]["rows"] or roots != manifest["records"]["roots"]:
        _fail("population_mismatch")
    guides = list(_jsonl(_checked_file(directory, manifest["guides"])))
    guide_matrix = _matrix(directory, manifest["guide_vectors"])
    if len(guides) != manifest["guides"]["rows"] or len(guides) != len(guide_matrix):
        _fail("guide_population_mismatch")
    seen = set()
    for ordinal, guide in enumerate(guides):
        if (
            guide.get("ordinal") != ordinal
            or guide.get("role") not in _ROLES
            or not isinstance(guide.get("guide_key"), str)
            or not guide["guide_key"]
            or not _HASH.fullmatch(str(guide.get("input_digest", "")))
        ):
            _fail("guide_invalid")
        key = (guide["guide_key"], guide["role"], guide["input_digest"])
        if key in seen:
            _fail("guide_duplicate")
        seen.add(key)
    return manifest, records, matrix, guides, guide_matrix


def describe_contract() -> dict[str, Any]:
    return {
        "input_contract": INPUT_CONTRACT,
        "output_contract": OUTPUT_CONTRACT,
        "default_config": DEFAULT_WORKSPACE_ENGINE_CONFIG,
        "chunk_fields": [
            "ordinal",
            "root_id",
            "root_fingerprint",
            "asset_sha256",
            "expected_chunks",
            "chunk_index",
            "start",
            "end",
            "chunk_sha256",
            "text",
        ],
        "guide_fields": ["ordinal", "guide_key", "role", "input_digest"],
        "output_manifest_fields": [
            "contract_version",
            "workspace_id",
            "input_manifest_sha256",
            "previous_manifest_sha256",
            "parent_reuse",
            "input_identity",
            "config",
            "versions",
            "status",
            "counts",
            "lanes",
            "artifacts",
            "quality",
            "approval_policy",
            "timings",
            "limitations",
        ],
        "artifact_descriptor": {"file": "basename", "sha256": "sha256:hex", "bytes": "integer"},
        "status": ["completed", "insufficient_population"],
        "model_artifacts": ["model.open.joblib", "model.guided.joblib"],
        "representative_selection": {
            "policy": REPRESENTATIVE_SELECTION_POLICY,
            "maximum": 10,
            "distinct_roots": True,
            "boundary": "lowest strength outside the highest-strength root, when available",
            "remainder": "highest strength per remaining root; ties by ordinal",
            "selection_reasons": ["high_affiliation", "low_affiliation_boundary"],
        },
        "quality": "uncalibrated",
        "approval_policy": "none",
    }


def _unit(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=-1, keepdims=True)
    return np.divide(values, norms, out=np.zeros_like(values), where=norms > 0)


def _guide_matrix(
    matrix: np.ndarray,
    guides: list[dict[str, Any]],
    seeds: np.ndarray,
    output: Path,
    center: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any], np.ndarray]:
    """Precomputed Guided BERTopic's 75/25 rule, with local negative vetoes.

    All prototypes of a guide participate. Scores are block-local, never NxT.
    A seed label guides UMAP; it is not a Topic membership or scope assertion.
    """
    if center is None:
        total = np.zeros(1024, dtype=np.float64)
        for start in range(0, len(matrix), 1024):
            total += matrix[start : start + 1024].sum(axis=0, dtype=np.float64)
        center = (total / max(1, len(matrix))).astype(np.float32)
    groups: dict[str, dict[str, list[int]]] = defaultdict(lambda: {"positive": [], "negative": []})
    for index, guide in enumerate(guides):
        groups[guide["guide_key"]][
            "positive" if guide["role"].endswith("positive") else "negative"
        ].append(index)
    keys = sorted(key for key, group in groups.items() if group["positive"])
    labels = np.full(len(matrix), -1, dtype=np.int32)
    changed = vetoed = 0
    result = np.lib.format.open_memmap(output, mode="w+", dtype=np.float32, shape=matrix.shape)
    for start in range(0, len(matrix), 128):
        block = np.asarray(matrix[start : start + 128])
        normalized = _unit(block)
        best_score = normalized @ _unit(center)
        winner = np.full(len(block), -1, dtype=np.int32)
        winner_seed = np.full(len(block), -1, dtype=np.int32)
        for label, key in enumerate(keys):
            group = groups[key]
            positive = np.full(len(block), -np.inf, dtype=np.float32)
            positive_seed = np.full(len(block), -1, dtype=np.int32)
            negative = np.full(len(block), -np.inf, dtype=np.float32)
            for role, indexes in group.items():
                for offset in range(0, len(indexes), 128):
                    selected = indexes[offset : offset + 128]
                    scores = normalized @ _unit(np.asarray(seeds[selected])).T
                    at = scores.argmax(axis=1)
                    values = scores[np.arange(len(block)), at]
                    if role == "negative":
                        negative = np.maximum(negative, values)
                    else:
                        improve = values > positive
                        positive[improve] = values[improve]
                        positive_seed[improve] = np.asarray(selected)[at[improve]]
            veto = (positive > best_score) & (negative >= positive)
            vetoed += int(veto.sum())
            improve = (positive > best_score) & (positive > negative)
            best_score[improve] = positive[improve]
            winner[improve] = label
            winner_seed[improve] = positive_seed[improve]
        result[start : start + len(block)] = block
        selected = np.flatnonzero(winner >= 0)
        if len(selected):
            result[start + selected] = block[selected] * 0.75 + seeds[winner_seed[selected]] * 0.25
        labels[start : start + len(block)] = winner
        changed += len(selected)
    result.flush()
    return (
        result,
        labels,
        {
            "guide_keys": keys,
            "guided_occurrences": changed,
            "negative_vetoes": vetoed,
            "rule": "precomputed-seed-mean-baseline-local-negative-v1",
            "mix": 0.25,
        },
        center,
    )


def _fit(
    texts: list[str],
    matrix: np.ndarray,
    config: dict[str, Any],
    labels: np.ndarray | None,
    model_file: Path,
) -> tuple[np.ndarray, np.ndarray, dict[int, list[str]]]:
    from bertopic import BERTopic
    from hdbscan import HDBSCAN
    from joblib import dump
    from sklearn.feature_extraction.text import CountVectorizer
    from umap import UMAP

    from .discovery import TimedLocaleAnalyzer
    from .preprocess import LocalePreprocessPolicy

    analyzer = TimedLocaleAnalyzer(
        LocalePreprocessPolicy(
            tuple(config["language_families"]), config["ngram_min"], config["ngram_max"]
        )
    )
    model = BERTopic(
        embedding_model=None,
        calculate_probabilities=False,
        verbose=False,
        umap_model=UMAP(
            n_neighbors=config["umap_n_neighbors"],
            n_components=config["umap_n_components"],
            min_dist=config["umap_min_dist"],
            metric="cosine",
            random_state=config["seed"],
            transform_seed=config["seed"],
            low_memory=True,
            n_jobs=1,
        ),
        hdbscan_model=HDBSCAN(
            min_cluster_size=config["hdbscan_min_cluster_size"],
            min_samples=config["hdbscan_min_samples"],
            metric="euclidean",
            cluster_selection_method=config["cluster_selection_method"],
            prediction_data=True,
        ),
        vectorizer_model=CountVectorizer(
            analyzer=analyzer,
            lowercase=False,
            min_df=config["vectorizer_min_df"],
            max_df=config["vectorizer_max_df"],
            max_features=config["vectorizer_max_features"],
        ),
        top_n_words=config["top_n_words"],
    )
    assigned, strengths = model.fit_transform(texts, embeddings=matrix, y=labels)
    assigned = np.asarray(assigned, dtype=np.int32)
    values = (
        np.asarray(strengths, dtype=np.float32)
        if strengths is not None
        else np.zeros(len(texts), dtype=np.float32)
    )
    if (
        assigned.shape != (len(texts),)
        or values.shape != (len(texts),)
        or not np.isfinite(values).all()
    ):
        _fail("algorithm_output_invalid")
    terms = {
        int(topic): [word for word, _score in model.get_topic(topic)]
        for topic in sorted(set(assigned))
        if topic >= 0 and model.get_topic(topic)
    }
    # Only the server-owned manifest + expected digest authorize this binary's
    # future load. Never load pickle/joblib supplied by product users.
    dump(model, model_file, compress=0)
    model_file.chmod(0o600)
    return assigned, values, terms


def _root_sets(records: list[dict[str, Any]], labels: np.ndarray) -> dict[int, set[str]]:
    result: dict[int, set[str]] = defaultdict(set)
    for record, label in zip(records, labels, strict=True):
        if label >= 0:
            result[int(label)].add(record["root_id"])
    return dict(result)


def _select_representatives(
    records: list[dict[str, Any]], indexes: np.ndarray, strengths: np.ndarray
) -> list[dict[str, Any]]:
    """Select evidence references only; never alter membership or fitted models.

    Keep the highest-strength chunk, plus the lowest-strength chunk from another
    root if one exists. Fill the other places with each remaining root's best
    chunk, up to ten distinct roots. Ties use the immutable input ordinal. The
    boundary is relative affiliation, not calibrated relevance or negative proof.
    Auxiliary selection state stays bounded by ten references.
    """
    if not len(indexes):
        return []

    def high_key(index: int) -> tuple[float, int]:
        return -float(strengths[index]), int(records[index]["ordinal"])

    anchor = int(min(indexes, key=high_key))
    anchor_root = records[anchor]["root_id"]
    boundary = min(
        (int(index) for index in indexes if records[index]["root_id"] != anchor_root),
        key=lambda index: (float(strengths[index]), int(records[index]["ordinal"])),
        default=None,
    )
    boundary_root = records[boundary]["root_id"] if boundary is not None else None
    capacity = 9 if boundary is not None else 10
    selected: dict[str, int] = {}
    for raw_index in indexes:
        index = int(raw_index)
        root = records[index]["root_id"]
        if root == boundary_root:
            continue
        prior = selected.get(root)
        if prior is not None and high_key(prior) <= high_key(index):
            continue
        selected[root] = index
        if len(selected) > capacity:
            worst_root = max(selected, key=lambda key: high_key(selected[key]))
            del selected[worst_root]
    choices = [(index, "high_affiliation") for index in sorted(selected.values(), key=high_key)]
    if boundary is not None:
        choices.append((boundary, "low_affiliation_boundary"))
    return [
        {
            **{
                key: records[index][key]
                for key in ["ordinal", "root_id", "chunk_index", "start", "end", "chunk_sha256"]
            },
            "strength": float(strengths[index]),
            "selection_reason": reason,
        }
        for index, reason in choices
    ]


def reconcile_cluster_ids(
    *,
    workspace_id: str,
    lane: str,
    input_digest: str,
    current: dict[int, set[str]],
    previous: dict[str, set[str]],
    common_roots: set[str],
    min_common_roots: int = 2,
    min_fraction: float = 0.5,
) -> tuple[dict[int, str], list[dict[str, Any]]]:
    """Lineage heuristic, not semantic validation; ambiguous matches get new IDs."""
    candidates: list[dict[str, Any]] = []
    for old_id in sorted(previous):
        old = previous[old_id] & common_roots
        for label in sorted(current):
            new = current[label] & common_roots
            shared = len(old & new)
            if shared < min_common_roots:
                continue
            left, right = shared / len(old), shared / len(new)
            # Record a split/merge when either side contains substantial shared
            # membership. A tiny incidental intersection never forces an ID.
            if max(left, right) < min_fraction:
                continue
            candidates.append(
                {
                    "from": old_id,
                    "label": label,
                    "shared_roots": shared,
                    "previous_common_roots": len(old),
                    "current_common_roots": len(new),
                    "previous_fraction": left,
                    "current_fraction": right,
                }
            )
    parents: dict[int, list[dict[str, Any]]] = defaultdict(list)
    children: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in candidates:
        parents[edge["label"]].append(edge)
        children[edge["from"]].append(edge)
    identities = {}
    for label in sorted(current):
        linked = parents[label]
        unique = len(linked) == 1 and len(children[linked[0]["from"]]) == 1
        if (
            unique
            and min(linked[0]["previous_fraction"], linked[0]["current_fraction"]) >= min_fraction
        ):
            identities[label] = linked[0]["from"]
        else:
            signature = _hash_bytes(_json(sorted(current[label])).encode())
            identities[label] = str(
                uuid.uuid5(uuid.UUID(workspace_id), f"{lane}:{input_digest}:{label}:{signature}")
            )
    edges = []
    for edge in candidates:
        split, merge = len(children[edge["from"]]) > 1, len(parents[edge["label"]]) > 1
        kind = (
            "ambiguous"
            if split and merge
            else "split"
            if split
            else "merge"
            if merge
            else "continuation"
        )
        if kind == "continuation" and identities[edge["label"]] != edge["from"]:
            kind = "related"
        edges.append(
            {
                **{key: value for key, value in edge.items() if key != "label"},
                "to": identities[edge["label"]],
                "kind": kind,
                "lane": lane,
            }
        )
    return identities, edges


def _verified_previous(directory: Path, expected_hash: str, workspace: str) -> dict[str, Any]:
    if (
        not _HASH.fullmatch(expected_hash)
        or _hash_file(directory / "manifest.json") != expected_hash
    ):
        return _fail("previous_manifest_hash_mismatch")
    manifest = _read_json(directory / "manifest.json")
    if (
        manifest.get("contract_version") != OUTPUT_CONTRACT
        or manifest.get("workspace_id") != workspace
    ):
        return _fail("previous_workspace_mismatch")
    checked = set()
    for artifact in manifest["artifacts"]:
        path = _checked_file(directory, artifact)
        if path.name in checked or path.stat().st_size != artifact.get("bytes"):
            _fail("previous_artifact_invalid")
        checked.add(path.name)
    required = {"roots.jsonl"}
    for lane in manifest["lanes"]:
        required.update([lane["assignments_file"], lane["clusters_file"]])
        if lane["model_file"] is not None:
            required.add(lane["model_file"])
        if lane["lane"] == "guided":
            required.update(["guides.jsonl", "guide-vectors.npy", "guide-center.npy"])
    if not required.issubset(checked):
        _fail("previous_artifact_unverified")
    return manifest


def _predict_previous(
    records: list[dict[str, Any]],
    matrix: np.ndarray,
    previous_dir: Path,
    previous: dict[str, Any],
    previous_roots: dict[str, Any],
    output: Path,
    scratch: Path,
) -> dict[str, int]:
    from joblib import load

    changed = [
        index
        for index, record in enumerate(records)
        if previous_roots.get(record["root_id"], {}).get("root_fingerprint")
        != record["root_fingerprint"]
    ]
    count = known = 0
    with output.open("w", encoding="utf-8") as handle:
        for lane in previous["lanes"]:
            if lane["model_file"] is None:
                continue
            # _verified_previous already verified every digest before any load.
            model = load(_file(previous_dir, lane["model_file"]), mmap_mode="r")
            old_clusters = _read_json(_file(previous_dir, lane["clusters_file"]))
            identities = {
                entry["local_label"]: entry["stable_cluster_id"] for entry in old_clusters
            }
            for start in range(0, len(changed), 128):
                indexes = changed[start : start + 128]
                block = np.asarray(matrix[indexes])
                if lane["lane"] == "guided":
                    seeds = np.load(previous_dir / "guide-vectors.npy", allow_pickle=False)
                    guides = list(_jsonl(previous_dir / "guides.jsonl"))
                    center = np.load(previous_dir / "guide-center.npy", allow_pickle=False)
                    block, _y, _stats, _center = _guide_matrix(
                        block, guides, seeds, scratch, center
                    )
                predicted, strengths = model.transform(
                    [records[index]["text"] for index in indexes], embeddings=block
                )
                for index, label, strength in zip(indexes, predicted, strengths, strict=True):
                    record = records[index]
                    stable = identities.get(int(label))
                    handle.write(
                        _json(
                            {
                                "ordinal": index,
                                "root_id": record["root_id"],
                                "chunk_index": record["chunk_index"],
                                "lane": lane["lane"],
                                "previous_stable_cluster_id": stable,
                                "strength": float(strength),
                                "result_kind": "known_cluster_prediction",
                            }
                        )
                        + "\n"
                    )
                    count += 1
                    known += stable is not None
            del model
    output.chmod(0o600)
    return {
        "predicted_occurrences": count,
        "known_predictions": known,
        "changed_occurrences": len(changed),
    }


def _progress(phase: str, **counts: Any) -> None:
    print(_json({"phase": phase, **counts}), flush=True)


def run_workspace_engine(
    input_dir: Path,
    output_dir: Path,
    storage_root: Path,
    previous_dir: Path | None = None,
    previous_manifest_sha256: str | None = None,
) -> dict[str, Any]:
    started = perf_counter()
    input_dir, output_dir = (
        _private_dir(input_dir, storage_root),
        _private_dir(output_dir, storage_root),
    )
    if input_dir == output_dir:
        _fail("artifact_path_invalid")
    manifest, records, matrix, guides, guide_matrix = _load_input(input_dir)
    input_hash = _hash_file(input_dir / "manifest.json")
    if output_dir.exists():
        receipt = _read_json(output_dir / "manifest.json")
        if (
            receipt.get("input_manifest_sha256") != input_hash
            or receipt.get("previous_manifest_sha256") != previous_manifest_sha256
        ):
            _fail("output_replay_mismatch")
        for artifact in receipt["artifacts"]:
            _checked_file(output_dir, artifact)
        return {**receipt, "replayed": True}
    if (previous_dir is None) != (previous_manifest_sha256 is None):
        _fail("previous_manifest_required")
    previous = None
    previous_roots: dict[str, Any] = {}
    if previous_dir is not None:
        previous_dir = _private_dir(previous_dir, storage_root)
        previous = _verified_previous(
            previous_dir, previous_manifest_sha256 or "", manifest["workspace_id"]
        )
        previous_roots = {row["root_id"]: row for row in _jsonl(previous_dir / "roots.jsonl")}
    output_dir.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = output_dir.parent / f".workspace-engine-{uuid.uuid4()}"
    stage.mkdir(mode=0o700)
    config = manifest["config"]
    identities = {
        key: manifest[key]
        for key in [
            "embedding_config_digest",
            "context_digest",
            "catalog_digest",
            "chunk_policy_version",
        ]
    }
    _progress(
        "validated",
        occurrences=len(records),
        roots=manifest["records"]["roots"],
        guides=len(guides),
    )
    population = [
        {key: value for key, value in record.items() if key != "text"} for record in records
    ]
    _write_jsonl(stage / "population.jsonl", population)
    _write_jsonl(stage / "guides.jsonl", guides)
    np.save(stage / "guide-vectors.npy", np.asarray(guide_matrix), allow_pickle=False)
    common = {
        record["root_id"]
        for record in records
        if previous_roots.get(record["root_id"], {}).get("root_fingerprint")
        == record["root_fingerprint"]
    }
    prediction = {
        "predicted_occurrences": 0,
        "known_predictions": 0,
        "changed_occurrences": sum(record["root_id"] not in common for record in records),
    }
    parent_reuse = {"mode": "no_parent", "reason": None, "lineage_available": False}
    if previous is not None:
        parent_reuse = {
            "mode": "prediction_and_refit",
            "reason": None,
            "lineage_available": True,
        }
        if previous.get("versions") != _versions():
            parent_reuse.update(mode="full_refit_only", reason="runtime_changed")
        elif previous.get("input_identity") != identities or previous.get("config") != config:
            parent_reuse.update(mode="full_refit_only", reason="inputs_changed")
    prediction_compatible = parent_reuse["mode"] == "prediction_and_refit"
    with (
        open(os.devnull, "w") as muted,
        contextlib.redirect_stdout(muted),
        contextlib.redirect_stderr(muted),
    ):
        if prediction_compatible:
            prediction = _predict_previous(
                records,
                matrix,
                previous_dir,
                previous,
                previous_roots,
                stage / "known-predictions.jsonl",
                stage / "scratch-predict.npy",
            )
        else:
            _write_jsonl(stage / "known-predictions.jsonl", [])
    _progress("known_prediction_complete", **prediction)
    lanes, all_edges = [], []
    root_results: dict[str, dict[str, Any]] = {}
    for record in records:
        root_results.setdefault(
            record["root_id"],
            {
                "root_id": record["root_id"],
                "root_fingerprint": record["root_fingerprint"],
                "chunk_count": record["expected_chunks"],
                "open": [],
                "guided": [],
            },
        )
    insufficient = len(records) <= max(
        config["hdbscan_min_cluster_size"],
        config["hdbscan_min_samples"],
        config["umap_n_neighbors"],
    )
    for lane in (
        ["open", "guided"]
        if guides and any(g["role"].endswith("positive") for g in guides)
        else ["open"]
    ):
        phase_started = perf_counter()
        guidance = None
        lane_matrix, seed_labels = matrix, None
        if lane == "guided":
            if len(matrix):
                lane_matrix, seed_labels, guidance, center = _guide_matrix(
                    matrix, guides, guide_matrix, stage / "scratch-guided.npy"
                )
            else:
                center = np.zeros(1024, dtype=np.float32)
                guidance = {
                    "guide_keys": [],
                    "guided_occurrences": 0,
                    "negative_vetoes": 0,
                    "mix": 0.25,
                }
            np.save(stage / "guide-center.npy", center, allow_pickle=False)
            guidance["matrix_sha256"] = (
                _hash_file(stage / "scratch-guided.npy") if len(matrix) else None
            )
        model_name = None if insufficient else f"model.{lane}.joblib"
        if insufficient:
            labels, strengths, terms = (
                np.full(len(records), -1, dtype=np.int32),
                np.zeros(len(records)),
                {},
            )
        else:
            with (
                open(os.devnull, "w") as muted,
                contextlib.redirect_stdout(muted),
                contextlib.redirect_stderr(muted),
            ):
                labels, strengths, terms = _fit(
                    [record["text"] for record in records],
                    lane_matrix,
                    config,
                    seed_labels,
                    stage / model_name,
                )
        memberships = _root_sets(records, labels)
        old_memberships: dict[str, set[str]] = defaultdict(set)
        if previous:
            for old_root in previous_roots.values():
                for old_id in old_root.get(lane, []):
                    old_memberships[old_id].add(old_root["root_id"])
        mapping, edges = reconcile_cluster_ids(
            workspace_id=manifest["workspace_id"],
            lane=lane,
            input_digest=input_hash,
            current=memberships,
            previous=old_memberships,
            common_roots=common,
            min_common_roots=config["lineage_min_common_roots"],
            min_fraction=config["lineage_min_fraction"],
        )
        all_edges.extend(edges)
        assignment_name, clusters_name = f"assignments.{lane}.jsonl", f"clusters.{lane}.json"
        _write_jsonl(
            stage / assignment_name,
            (
                {
                    "ordinal": record["ordinal"],
                    "root_id": record["root_id"],
                    "chunk_index": record["chunk_index"],
                    "chunk_sha256": record["chunk_sha256"],
                    "start": record["start"],
                    "end": record["end"],
                    "local_label": int(label),
                    "stable_cluster_id": mapping.get(int(label)),
                    "strength": float(strength),
                }
                for record, label, strength in zip(records, labels, strengths, strict=True)
            ),
        )
        clusters = []
        for label, roots in memberships.items():
            for root_id in roots:
                root_results[root_id][lane].append(mapping[label])
            indexes = np.flatnonzero(labels == label)
            # Representatives are a bounded index of evidence; full occurrence
            # membership remains available in assignments, never truncated.
            clusters.append(
                {
                    "stable_cluster_id": mapping[label],
                    "local_label": label,
                    "lane": lane,
                    "root_count": len(roots),
                    "chunk_count": len(indexes),
                    "terms": terms.get(label, []),
                    "representative_selection_policy": REPRESENTATIVE_SELECTION_POLICY,
                    "representatives": _select_representatives(records, indexes, strengths),
                }
            )
        _write_json(stage / clusters_name, sorted(clusters, key=lambda value: value["local_label"]))
        lanes.append(
            {
                "lane": lane,
                "model_file": model_name,
                "assignments_file": assignment_name,
                "clusters_file": clusters_name,
                "occurrences": len(records),
                "roots": len(root_results),
                "clusters": len(clusters),
                "outlier_occurrences": int((labels < 0).sum()),
                "guidance": guidance,
                "fit_seconds": perf_counter() - phase_started,
            }
        )
        _progress("fit_complete", lane=lane, occurrences=len(records), clusters=len(clusters))
    _write_jsonl(stage / "roots.jsonl", (root_results[key] for key in sorted(root_results)))
    _write_json(stage / "lineage.json", all_edges)
    # Only scratch files created by this invocation are removed. Artifacts and
    # historical models are immutable; no external/user path is ever deleted.
    for name in ["scratch-guided.npy", "scratch-predict.npy"]:
        scratch = stage / name
        if scratch.exists():
            scratch.unlink()
    artifacts = []
    for path in sorted(stage.iterdir()):
        path.chmod(0o600)
        artifacts.append(
            {"file": path.name, "sha256": _hash_file(path), "bytes": path.stat().st_size}
        )
    import psutil

    result = {
        "contract_version": OUTPUT_CONTRACT,
        "workspace_id": manifest["workspace_id"],
        "input_manifest_sha256": input_hash,
        "previous_manifest_sha256": previous_manifest_sha256,
        "parent_reuse": parent_reuse,
        "input_identity": identities,
        "config": config,
        "versions": _versions(),
        "status": "insufficient_population" if insufficient else "completed",
        "counts": {
            "occurrences": len(records),
            "roots": len(root_results),
            "guides": len(guides),
            "common_unchanged_roots": len(common),
            "full_refit_occurrences": 0 if insufficient else len(records),
            **prediction,
        },
        "lanes": lanes,
        "artifacts": artifacts,
        "quality": "uncalibrated",
        "approval_policy": "none",
        "timings": {
            "total_seconds": perf_counter() - started,
            "resident_bytes_at_completion": psutil.Process().memory_info().rss,
        },
        "limitations": [
            "Full refit discovers novelty; prediction alone does not create clusters.",
            "Density membership and lineage overlap are not semantic approval "
            "or calibrated precision.",
            "Input memory guard is not a proof of peak fit memory or two-million-record capacity.",
        ],
    }
    _write_json(stage / "manifest.json", result)
    stage.rename(output_dir)
    _progress(
        "completed", status=result["status"], occurrences=len(records), roots=len(root_results)
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--describe-contract", action="store_true")
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--storage-root", type=Path)
    parser.add_argument("--previous-dir", type=Path)
    parser.add_argument("--previous-manifest-sha256")
    args = parser.parse_args()
    if args.describe_contract:
        print(_json(describe_contract()))
        return 0
    if not args.input_dir or not args.output_dir or not args.storage_root:
        parser.error("--input-dir, --output-dir and --storage-root are required")
    try:
        run_workspace_engine(
            args.input_dir,
            args.output_dir,
            args.storage_root,
            args.previous_dir,
            args.previous_manifest_sha256,
        )
        return 0
    except Exception as error:
        code = (
            error.code
            if isinstance(error, WorkspaceEngineError)
            else "workspace_engine_computation_failed"
        )
        print(_json({"error_code": code}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
