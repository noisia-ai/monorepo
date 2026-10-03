from __future__ import annotations

import csv
import random
import re
from collections import Counter
from datetime import datetime
from math import ceil
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.preprocessing import normalize

from .canonical import canonical_json, sha256_text, write_private_json
from .naming_contracts import RepresentativeEvidenceV1, SealedRepresentativePacketV1
from .schema import BenchmarkRecord, BenchmarkRecordV2

PACKET_POLICY_VERSION = "signal-adaptive-representative-packet-v1"
PACKET_POLICY = {
    "maximum_representatives": 8,
    "maximum_medoids": 2,
    "maximum_diversity_representatives": 3,
    "maximum_boundary_representatives": 1,
    "maximum_counterexamples": 1,
    "maximum_excerpt_characters": 600,
    "maximum_cluster_characters": 4_800,
    "maximum_cluster_tokens": 1_200,
    "maximum_run_tokens": 120_000,
    "diversity_dimensions": ["language", "scope", "platform", "country", "month"],
    "representation_vector_policy": {
        "candidate_embedding": "l2-normalized-pinned-candidate-embedding",
        "lexical_fallback": "hashing-vectorizer-v1",
        "lexical_features": 256,
        "lexical_ngram_range": [1, 2],
        "lexical_alternate_sign": False,
    },
    "redaction_policy": "signal-operator-packet-redaction-v1",
}

_EMAIL = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_HANDLE = re.compile(r"(?<!\w)@[\w.\-]{2,}", re.UNICODE)
_LONG_NUMBER = re.compile(r"\b\d{7,}\b")


def build_blinded_packet(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    candidates: list[dict[str, Any]],
    output_dir: Path,
    *,
    seed: int,
    review_status: str = "operator_review_required",
    sample_scope: str = "full_population",
    population_denominator: int | None = None,
    modeling_decision_allowed: bool = True,
    technical_limitations: list[str] | None = None,
    diagnostic_role_separation: bool = False,
    rights_evaluated_at: datetime | None = None,
) -> dict[str, Any]:
    packet_started = perf_counter()
    randomizer = random.Random(seed)
    ordered = list(candidates)
    randomizer.shuffle(ordered)
    key: dict[str, str] = {}
    packet_candidates: list[dict[str, Any]] = []
    policy_digest = sha256_text(canonical_json(PACKET_POLICY))
    run_token_limit = int(PACKET_POLICY["maximum_run_tokens"])
    candidate_token_limit = run_token_limit // max(1, len(ordered))
    for candidate_index, candidate in enumerate(ordered):
        label = f"Candidate {chr(65 + candidate_index)}"
        key[label] = candidate["candidate_key"]
        assignment_artifact = np.load(candidate["assignments_path"], allow_pickle=False)
        labels = assignment_artifact["labels"]
        strengths = (
            assignment_artifact["strengths"]
            if "strengths" in assignment_artifact.files
            else np.full(len(labels), np.nan, dtype=np.float32)
        )
        if len(labels) != len(records):
            raise ValueError("benchmark_packet_assignment_shape_mismatch")
        vectors = _representation_vectors(records, candidate)
        terms = {int(topic): values for topic, values in candidate["terms"].items()}
        topic_ids = sorted(topic for topic in set(int(value) for value in labels) if topic >= 0)
        randomizer.shuffle(topic_ids)
        centroids = _centroids(vectors, labels, topic_ids)
        neighbors = _cluster_neighbors(centroids)
        cluster_content_digests = {
            topic_id: sha256_text(
                canonical_json(
                    sorted(
                        records[index].content_hash for index in np.flatnonzero(labels == topic_id)
                    )
                )
            )
            for topic_id in topic_ids
        }
        all_topics: list[dict[str, Any]] = []
        run_key = sha256_text(
            canonical_json(
                {
                    "assignment_digest": candidate["assignments_sha256"],
                    "packet_policy_digest": policy_digest,
                }
            )
        )
        for topic_index, topic_id in enumerate(topic_ids):
            sealed = _sealed_cluster_packet(
                records=records,
                labels=labels,
                strengths=strengths,
                vectors=vectors,
                topic_id=topic_id,
                terms=terms.get(topic_id, []),
                centroids=centroids,
                neighbors=neighbors,
                cluster_content_digests=cluster_content_digests,
                stability=candidate.get("stability_summary"),
                run_key=run_key,
                packet_policy_digest=policy_digest,
                sample_scope=sample_scope,
                population_denominator=population_denominator or len(records),
                rights_evaluated_at=rights_evaluated_at,
            )
            scores = (
                {
                    "internal_coherence": None,
                    "neighbor_distinction": None,
                    "human_nameability": None,
                    "strategic_utility": None,
                    "merge_needed": None,
                    "split_needed": None,
                    "convert_to_topic_contract_candidate": None,
                    "none_acceptable": None,
                    "notes": "",
                }
                if diagnostic_role_separation
                else {
                    "faithfulness": None,
                    "specificity": None,
                    "non_overlap": None,
                    "internal_coherence": None,
                    "neighbor_distinction": None,
                    "commercial_utility": None,
                    "locale_quality": None,
                    "merge_needed": None,
                    "split_needed": None,
                    "outlier_correctness": None,
                    "notes": "",
                }
            )
            all_topics.append(
                {
                    "topic_label": f"Topic {topic_index + 1}",
                    "sealed_packet": sealed.model_dump(mode="json"),
                    "scores": scores,
                }
            )
        topics = _bounded_topic_selection(all_topics, candidate_token_limit)
        candidate_packet_tokens = sum(
            int(topic["sealed_packet"]["estimated_tokens"]) for topic in topics
        )
        if candidate_packet_tokens > candidate_token_limit:
            raise ValueError("benchmark_packet_run_token_budget_exceeded")
        reviewed_cluster_population_count = sum(
            int(topic["sealed_packet"]["cluster_member_count"]) for topic in topics
        )
        outlier_indexes = np.flatnonzero(labels < 0)
        blinded_outlier_indexes = sorted(
            (int(index) for index in outlier_indexes),
            key=lambda index: sha256_text(
                f"{seed}:{candidate['candidate_key']}:{records[index].record_key}"
            ),
        )
        packet_candidates.append(
            {
                "candidate_label": label,
                "topic_count": len(all_topics),
                "reviewed_topic_count": len(topics),
                "unreviewed_topic_count": len(all_topics) - len(topics),
                "cluster_selection_state": (
                    "complete" if len(topics) == len(all_topics) else "bounded_subset"
                ),
                "cluster_selection_contract": (
                    "seeded-blind-order-greedy-within-equal-candidate-token-share-v1"
                ),
                "reviewed_cluster_population_count": reviewed_cluster_population_count,
                "reviewed_cluster_population_share": (
                    reviewed_cluster_population_count / max(1, len(records))
                ),
                "outlier_count": len(outlier_indexes),
                "outlier_examples": [
                    (
                        {
                            "evidence_ref": records[index].record_key,
                            "excerpt": _redact_excerpt(records[index].text, maximum=600),
                            "language": records[index].language,
                            "scope": _primary_scope(records[index]),
                            "platform": records[index].platform,
                            "time_slice": records[index].month,
                            "rights_digest": records[index].authority_digest,
                            "selection_reason": "seeded_bounded_outlier_diagnostic_sample",
                        }
                        if diagnostic_role_separation
                        else _redact_excerpt(records[index].text, maximum=600)
                    )
                    for index in blinded_outlier_indexes[:5]
                    if _record_rights_safe(records[index], rights_evaluated_at)
                ],
                "packet_token_count": candidate_packet_tokens,
                "packet_token_limit": candidate_token_limit,
                "multiscope_summary": candidate.get("metrics", {}).get("multiscope"),
                "topics": topics,
            }
        )
    packet_token_count = sum(int(row["packet_token_count"]) for row in packet_candidates)
    if packet_token_count > run_token_limit:
        raise ValueError("benchmark_packet_run_token_budget_exceeded")
    review_scope = (
        "complete_cluster_census"
        if all(row["cluster_selection_state"] == "complete" for row in packet_candidates)
        else "bounded_cluster_subset"
    )
    packet = {
        "contract_version": "signal-topic-discovery-blind-review-v3",
        "review_status": review_status,
        "modeling_scope": sample_scope,
        "modeling_record_count": len(records),
        "review_scope": review_scope,
        "population_denominator": population_denominator or len(records),
        "modeling_decision_allowed": modeling_decision_allowed,
        "adoption_allowed": False if diagnostic_role_separation else modeling_decision_allowed,
        "holdout_opened": False if diagnostic_role_separation else None,
        "count_scope": (
            "full_population_diagnostic" if diagnostic_role_separation else sample_scope
        ),
        "decision_sheet_contract": "signal-topic-discovery-blind-decision-sheet-v2",
        "packet_policy_version": PACKET_POLICY_VERSION,
        "packet_policy_digest": policy_digest,
        "packet_token_count": packet_token_count,
        "packet_token_limit": run_token_limit,
        "technical_limitations": technical_limitations or [],
        "seed": seed,
        "quality_floor": {
            "use": "rubric_only",
            "examples": [
                "Promociones y descuentos",
                "Experiencia de compra digital",
                "Salud integral de la mascota",
                "Entrega y logística",
                "Costo y sensibilidad al precio",
            ],
            "not_a_fixture": True,
        },
        "instructions": [
            "Review candidates without opening the private key.",
            "Evaluate clustering evidence separately from lexical representation and naming.",
            "Score every rubric dimension independently; use 'none acceptable' when appropriate.",
            (
                "Cluster counts are exact full-population counts for this export."
                if sample_scope == "full_population"
                else "Cluster counts are calibration-subset counts, never population counts."
            ),
            (
                "modeling_record_count is the input population used for discovery; it is not "
                "the number of records or clusters reviewed in this packet."
            ),
            "Machine terms are draft representations and are not approved Topic Contract names.",
            (
                "When cluster_selection_state is bounded_subset, included cluster counts are "
                "exact but the review packet is not a census of every discovered cluster."
            ),
            (
                "Complete the separate blind decision sheet with review_outcome set to "
                "candidate_preferred, none_acceptable or rerun_requested; this review "
                "never authorizes adoption."
            ),
            "Save reviewer identity and completed scores as a separate append-only artifact.",
        ],
        "none_acceptable": None,
        "candidates": packet_candidates,
    }
    selection_seconds = perf_counter() - packet_started
    serialization_started = perf_counter()
    write_private_json(output_dir / "blind-review-packet.private.json", packet)
    write_private_json(output_dir / "blind-review-key.private.json", key)
    _write_score_sheet(output_dir / "blind-review-score-sheet.private.csv", packet_candidates)
    _write_decision_sheet(output_dir / "blind-review-decision-sheet.private.csv")
    serialization_seconds = perf_counter() - serialization_started
    write_private_json(
        output_dir / "blind-review-telemetry.private.json",
        {
            "contract_version": "signal-topic-discovery-blind-review-telemetry-v1",
            "packet_selection_seconds": selection_seconds,
            "packet_serialization_seconds": serialization_seconds,
        },
    )
    return {
        "packet": str(output_dir / "blind-review-packet.private.json"),
        "key": str(output_dir / "blind-review-key.private.json"),
        "decision_sheet": str(output_dir / "blind-review-decision-sheet.private.csv"),
        "telemetry": str(output_dir / "blind-review-telemetry.private.json"),
        "packet_selection_seconds": selection_seconds,
        "packet_serialization_seconds": serialization_seconds,
    }


def _bounded_topic_selection(
    topics: list[dict[str, Any]], token_limit: int
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    used = 0
    for topic in topics:
        tokens = int(topic["sealed_packet"]["estimated_tokens"])
        if tokens > token_limit or used + tokens > token_limit:
            continue
        selected.append(topic)
        used += tokens
    if topics and not selected:
        raise ValueError("benchmark_packet_single_cluster_token_budget_exceeded")
    return selected


def _sealed_cluster_packet(
    *,
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    labels: np.ndarray,
    strengths: np.ndarray,
    vectors: np.ndarray,
    topic_id: int,
    terms: list[str],
    centroids: dict[int, np.ndarray],
    neighbors: dict[int, list[tuple[int, float]]],
    cluster_content_digests: dict[int, str],
    stability: dict[str, float | int | str | None] | None,
    run_key: str,
    packet_policy_digest: str,
    sample_scope: str,
    population_denominator: int,
    rights_evaluated_at: datetime | None,
) -> SealedRepresentativePacketV1:
    member_indexes = [int(value) for value in np.flatnonzero(labels == topic_id)]
    if not member_indexes:
        raise ValueError("benchmark_packet_empty_cluster")
    rights_safe_indexes = [
        index
        for index in member_indexes
        if _record_rights_safe(records[index], rights_evaluated_at)
    ]
    if not rights_safe_indexes:
        raise ValueError("benchmark_packet_no_rights_safe_representatives")
    rights_safe_set = set(rights_safe_indexes)
    centroid = centroids[topic_id]
    similarities = vectors[member_indexes] @ centroid
    ranked_central = [
        member_indexes[index]
        for index in np.argsort(-similarities, kind="stable")
        if member_indexes[index] in rights_safe_set
    ]
    selected: list[tuple[int, str, str]] = []
    for index in ranked_central[: PACKET_POLICY["maximum_medoids"]]:
        selected.append((index, "medoid", "closest_to_cluster_centroid"))

    seen_slices = {_slice_key(records[index]) for index, _role, _reason in selected}
    remaining = [
        index for index in rights_safe_indexes if index not in {row[0] for row in selected}
    ]
    while (
        remaining
        and sum(role == "diversity" for _index, role, _reason in selected)
        < PACKET_POLICY["maximum_diversity_representatives"]
    ):
        scored = []
        selected_vectors = vectors[[row[0] for row in selected]]
        for index in remaining:
            distance = (
                1 - float(np.max(selected_vectors @ vectors[index]))
                if len(selected_vectors)
                else 1.0
            )
            slice_bonus = 1.0 if _slice_key(records[index]) not in seen_slices else 0.0
            scored.append((slice_bonus, distance, records[index].record_key, index))
        _bonus, _distance, _key, winner = max(scored)
        selected.append((winner, "diversity", "maximin_with_new_locale_scope_source_time_slice"))
        seen_slices.add(_slice_key(records[winner]))
        remaining.remove(winner)

    finite_strengths = [index for index in remaining if np.isfinite(strengths[index])]
    if finite_strengths:
        boundary = min(
            finite_strengths, key=lambda index: (float(strengths[index]), records[index].record_key)
        )
    else:
        other_centroids = [value for key, value in centroids.items() if key != topic_id]
        boundary = min(
            remaining or member_indexes,
            key=lambda index: (
                float(vectors[index] @ centroid)
                - max((float(vectors[index] @ value) for value in other_centroids), default=-1.0),
                records[index].record_key,
            ),
        )
    if boundary not in {row[0] for row in selected}:
        selected.append((boundary, "boundary", "smallest_available_membership_margin"))

    neighbor_ids = [value for value, _score in neighbors.get(topic_id, [])]
    counterexample_pool = [
        index
        for index, label in enumerate(labels)
        if int(label) in neighbor_ids
        and index not in {row[0] for row in selected}
        and _record_rights_safe(records[index], rights_evaluated_at)
    ]
    if counterexample_pool:
        counterexample = max(
            counterexample_pool,
            key=lambda index: (float(vectors[index] @ centroid), records[index].record_key),
        )
        selected.append((counterexample, "counterexample", "nearest_member_from_neighbor_cluster"))

    selected = selected[: PACKET_POLICY["maximum_representatives"]]
    evidence: list[RepresentativeEvidenceV1] = []
    character_count = 0
    for index, role, reason in selected:
        excerpt = _redact_excerpt(
            records[index].text,
            maximum=min(
                PACKET_POLICY["maximum_excerpt_characters"],
                PACKET_POLICY["maximum_cluster_characters"] - character_count,
            ),
        )
        if not excerpt:
            continue
        character_count += len(excerpt)
        evidence.append(
            RepresentativeEvidenceV1(
                evidence_ref=records[index].record_key,
                role=role,
                selection_reason=reason,
                excerpt=excerpt,
                language=records[index].language,
                scope=_primary_scope(records[index]),
                source_slice=records[index].platform,
                time_slice=records[index].month,
                rights_digest=records[index].authority_digest,
            )
        )
    if not evidence:
        raise ValueError("benchmark_packet_no_rights_safe_representatives")

    distributions = {
        "language": dict(
            sorted(Counter(records[index].language for index in member_indexes).items())
        ),
        "scope": dict(
            sorted(
                Counter(
                    scope for index in member_indexes for scope in _record_scopes(records[index])
                ).items()
            )
        ),
        "source": dict(
            sorted(Counter(records[index].platform for index in member_indexes).items())
        ),
        "subregion": dict(
            sorted(Counter(records[index].country for index in member_indexes).items())
        ),
        "time": dict(sorted(Counter(records[index].month for index in member_indexes).items())),
    }
    cluster_content_digest = cluster_content_digests[topic_id]
    cluster_key = sha256_text(f"{run_key}:{cluster_content_digest}")
    estimated_tokens = ceil(character_count / 4)
    if estimated_tokens > PACKET_POLICY["maximum_cluster_tokens"]:
        raise ValueError("benchmark_packet_token_budget_exceeded")
    observed_slice_count = len({_slice_key(records[index]) for index in member_indexes})
    selected_slice_count = len({_slice_key(records[index]) for index, _role, _reason in selected})
    breadth_limited = len(member_indexes) > 10_000 and observed_slice_count > selected_slice_count
    body = {
        "contract_version": "signal-sealed-representative-packet-v1",
        "run_key": run_key,
        "cluster_key": cluster_key,
        "cluster_content_digest": cluster_content_digest,
        "packet_policy_version": PACKET_POLICY_VERSION,
        "packet_policy_digest": packet_policy_digest,
        "cluster_member_count": len(member_indexes),
        "count_scope": sample_scope,
        "population_denominator": population_denominator,
        "stability": stability,
        "outlier_information": {
            "global_outlier_count": int(np.sum(labels < 0)),
            "global_outlier_rate": float(np.mean(labels < 0)),
            "membership_strength_availability": (
                "available"
                if bool(np.any(np.isfinite(strengths[member_indexes])))
                else "not_available"
            ),
        },
        "local_terms": [_redact_excerpt(value, maximum=120) for value in terms if "_" not in value][
            :15
        ],
        "local_phrases": [
            _redact_excerpt(value.replace("_", " "), maximum=240) for value in terms if "_" in value
        ][:15],
        "distributions": distributions,
        "distribution_contracts": {
            "language": "exclusive_root_count",
            "scope": "nonexclusive_provenance_membership_count",
            "source": "exclusive_root_count",
            "subregion": "exclusive_root_count",
            "time": "exclusive_root_count",
        },
        "neighboring_clusters": [
            {
                "cluster_ref": sha256_text(f"{run_key}:{cluster_content_digests[neighbor]}"),
                "similarity": similarity,
            }
            for neighbor, similarity in neighbors.get(topic_id, [])[:3]
        ],
        "representatives": [item.model_dump(mode="json") for item in evidence],
        "excerpt_character_count": character_count,
        "estimated_tokens": estimated_tokens,
        "coverage": {
            "representative_count": len(evidence),
            "distinct_slice_count": len(
                {_slice_key(records[index]) for index, _role, _reason in selected}
            ),
            "observed_slice_count": observed_slice_count,
            "breadth_state": ("too_broad_split_candidate" if breadth_limited else "bounded"),
            "maximum_representatives": PACKET_POLICY["maximum_representatives"],
            "reviewed_scope_denominator": len(records),
            "cluster_share_of_reviewed_scope": len(member_indexes) / len(records),
            "reviewed_scope": sample_scope,
        },
        "limitations": [
            "Representative excerpts are evidence samples, never population counts.",
            *(
                [
                    "Cluster is too broad for its bounded slice coverage; operator must "
                    "consider split."
                ]
                if breadth_limited
                else []
            ),
        ],
    }
    return SealedRepresentativePacketV1.model_validate(
        {
            **body,
            "packet_digest": sha256_text(canonical_json(body)),
        }
    )


def _representation_vectors(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    candidate: dict[str, Any],
) -> np.ndarray:
    manifest = candidate.get("artifact_manifest", {}).get("embedding_manifest")
    if manifest and manifest.get("output_path"):
        vectors = np.asarray(np.load(manifest["output_path"], mmap_mode="r", allow_pickle=False))
        if len(vectors) != len(records):
            raise ValueError("benchmark_packet_embedding_shape_mismatch")
        return np.asarray(normalize(vectors), dtype=np.float32)
    vectorizer = HashingVectorizer(
        n_features=PACKET_POLICY["representation_vector_policy"]["lexical_features"],
        alternate_sign=PACKET_POLICY["representation_vector_policy"]["lexical_alternate_sign"],
        norm="l2",
        ngram_range=tuple(PACKET_POLICY["representation_vector_policy"]["lexical_ngram_range"]),
    )
    return np.asarray(
        vectorizer.transform(record.text for record in records).toarray(), dtype=np.float32
    )


def _centroids(
    vectors: np.ndarray, labels: np.ndarray, topic_ids: list[int]
) -> dict[int, np.ndarray]:
    output = {}
    for topic_id in topic_ids:
        centroid = np.asarray(vectors[labels == topic_id].mean(axis=0), dtype=np.float32)
        norm = float(np.linalg.norm(centroid))
        output[topic_id] = centroid / max(norm, np.finfo(np.float32).eps)
    return output


def _cluster_neighbors(centroids: dict[int, np.ndarray]) -> dict[int, list[tuple[int, float]]]:
    return {
        topic_id: sorted(
            [
                (other_id, float(centroid @ other_centroid))
                for other_id, other_centroid in centroids.items()
                if other_id != topic_id
            ],
            key=lambda value: (-value[1], value[0]),
        )
        for topic_id, centroid in centroids.items()
    }


def _slice_key(
    record: BenchmarkRecord | BenchmarkRecordV2,
) -> tuple[str, str, str, str, str]:
    return (
        record.language,
        _primary_scope(record),
        record.platform,
        record.country,
        record.month,
    )


def _primary_scope(record: BenchmarkRecord | BenchmarkRecordV2) -> str:
    return _record_scopes(record)[0]


def _record_scopes(record: BenchmarkRecord | BenchmarkRecordV2) -> list[str]:
    if isinstance(record, BenchmarkRecordV2):
        return sorted({membership.scope for membership in record.partition_memberships})
    return sorted({intent.scope for intent in record.provenance_intents})


def _redact_excerpt(value: str, *, maximum: int) -> str:
    if maximum <= 0:
        return ""
    redacted = _URL.sub("[url]", value)
    redacted = _EMAIL.sub("[email]", redacted)
    redacted = _HANDLE.sub("[handle]", redacted)
    redacted = _LONG_NUMBER.sub("[number]", redacted)
    redacted = " ".join(redacted.split())
    return redacted[:maximum].rstrip()


def _record_rights_safe(
    record: BenchmarkRecord | BenchmarkRecordV2, evaluated_at: datetime | None
) -> bool:
    if isinstance(record, BenchmarkRecordV2):
        if record.authority_usage != "strategic-analysis":
            return False
        return all(
            membership.authority_valid_until is None
            or evaluated_at is None
            or membership.authority_valid_until > evaluated_at
            for membership in record.partition_memberships
        )
    return record.authority_valid_until is None or evaluated_at is None or (
        record.authority_valid_until > evaluated_at
    )


def _write_score_sheet(path: Path, candidates: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dimensions = (
        list(candidates[0]["topics"][0]["scores"])
        if candidates and candidates[0]["topics"]
        else ["notes"]
    )
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["candidate", "topic", *dimensions])
        for candidate in candidates:
            for topic in candidate["topics"]:
                writer.writerow(
                    [candidate["candidate_label"], topic["topic_label"], *([""] * len(dimensions))]
                )
    path.chmod(0o600)


def _write_decision_sheet(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "contract_version",
                "allowed_review_outcomes",
                "reviewer_ref",
                "reviewed_at",
                "operator_review_complete",
                "review_outcome",
                "preferred_candidate",
                "notes",
            ]
        )
        writer.writerow(
            [
                "signal-topic-discovery-blind-decision-sheet-v2",
                "candidate_preferred|none_acceptable|rerun_requested",
                "",
                "",
                "",
                "",
                "",
                "",
            ]
        )
    path.chmod(0o600)
