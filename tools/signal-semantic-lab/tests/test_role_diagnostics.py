from __future__ import annotations

import csv
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from signal_semantic_lab.canonical import sha256_file, sha256_text, write_private_json
from signal_semantic_lab.review_packet import build_blinded_packet
from signal_semantic_lab.role_diagnostics import (
    _centroids_batched,
    _complexity_projection,
    _diagnose_seed,
    _load_embedding,
    _load_full_result,
    _nearest_centroid_scores,
    _preregistered_seeds,
    _reject_holdout_paths,
    _slice_distributions,
    _validate_replay,
    _validate_vectors,
    diagnose_role_separation,
)
from signal_semantic_lab.schema import (
    ApprovedTopicContractV1,
    BenchmarkRecordV2,
    DiscoveryProposalV1,
    OperatorDiagnosticReviewItemV1,
    PartitionMembershipV2,
    PropagationAssignmentV1,
    TopicContractCandidateV1,
)


def _digest(value: str) -> str:
    return sha256_text(value)


def _record(
    index: int,
    *,
    partitions: tuple[str, ...] = ("primary",),
    expired: bool = False,
) -> BenchmarkRecordV2:
    memberships = []
    for partition in partitions:
        scope = "competitor" if partition.startswith("competitor") else "primary_brand"
        if partition == "category":
            scope = "category"
        memberships.append(
            PartitionMembershipV2(
                partition_key=partition,
                scope=scope,
                entity_ref=_digest(f"entity:{partition}"),
                declared_market="MX" if partition in {"primary", "category"} else "US",
                plan_version=1,
                plan_digest=_digest("plan"),
                slot_key=f"slot-{partition}",
                slot_digest=_digest(f"slot:{partition}"),
                provenance_digest=_digest(f"provenance:{partition}"),
                authority_digest=_digest(f"authority:{partition}"),
                authority_valid_until=(
                    datetime.now(UTC) - timedelta(days=1)
                    if expired
                    else datetime.now(UTC) + timedelta(days=30)
                ),
            )
        )
    return BenchmarkRecordV2(
        contract_version="signal-semantic-benchmark-record-v2",
        record_key=_digest(f"record:{index}"),
        canonical_family_key=_digest(f"family:{index}"),
        canonical_alias_count=1 if index == 0 else 0,
        content_hash=_digest(f"text {index}"),
        text=f"text {index}",
        published_at=datetime(2026, 1 + index % 2, 1, tzinfo=UTC),
        month=f"2026-0{1 + index % 2}",
        language="es" if index % 2 == 0 else "en",
        country="MX" if index % 2 == 0 else "US",
        platform="x" if index % 2 == 0 else "news",
        partition_memberships=memberships,
        quality_disposition="included",
        authority_usage="strategic-analysis",
        authority_digest=_digest(f"record-authority:{index}"),
    )


def _role_payloads() -> tuple[dict[str, object], dict[str, object]]:
    now = datetime.now(UTC)
    proposal = {
        "contract_version": "signal-topic-discovery-proposal-v1",
        "role": "discovery_proposal",
        "proposal_key": _digest("proposal"),
        "discovery_run_digest": _digest("discovery"),
        "cluster_key": _digest("cluster"),
        "evidence_digest": _digest("evidence"),
        "disposition": "pending",
        "authority_state": "proposal_only",
        "operator_review_complete": False,
        "generated_at": now,
    }
    assignment = {
        "contract_version": "signal-topic-propagation-assignment-v1",
        "role": "propagation_assignment",
        "assignment_key": _digest("assignment"),
        "canonical_root_key": _digest("root"),
        "propagation_generation_digest": _digest("propagation"),
        "discovery_run_digest": _digest("discovery"),
        "topic_contract_digest": _digest("contract"),
        "method": "model",
        "disposition": "pending",
        "score": 1.0,
        "approval_authority": None,
        "evidence_digest": _digest("assignment-evidence"),
        "evaluated_at": now,
    }
    return proposal, assignment


def test_discovery_proposal_is_pending_and_not_an_assignment() -> None:
    proposal, _assignment = _role_payloads()
    parsed = DiscoveryProposalV1.model_validate(proposal)
    assert parsed.disposition == "pending"
    assert parsed.authority_state == "proposal_only"
    with pytest.raises(ValidationError):
        PropagationAssignmentV1.model_validate(proposal)


def test_topic_candidate_is_human_action_and_still_pending() -> None:
    candidate = TopicContractCandidateV1(
        contract_version="signal-topic-contract-candidate-v1",
        role="topic_contract_candidate",
        candidate_key=_digest("candidate"),
        source_proposal_keys=[_digest("proposal")],
        evidence_digest=_digest("evidence"),
        disposition="pending",
        operator_action="merge",
        actor_ref=_digest("actor"),
        created_at=datetime.now(UTC),
    )
    assert candidate.operator_action == "merge"


def test_approved_contract_requires_explicit_authority() -> None:
    with pytest.raises(ValidationError):
        ApprovedTopicContractV1(
            contract_version="signal-approved-topic-contract-v1",
            role="approved_topic_contract",
            contract_key=_digest("contract"),
            contract_definition_digest=_digest("definition"),
            source_candidate_key=_digest("candidate"),
            version=1,
            disposition="approved",
            approval_authority="human",
            actor_ref=None,
            approved_at=datetime.now(UTC),
        )


def test_score_one_does_not_approve_propagation_assignment() -> None:
    _proposal, assignment = _role_payloads()
    parsed = PropagationAssignmentV1.model_validate(assignment)
    assert parsed.score == 1.0
    assert parsed.disposition == "pending"
    assignment["disposition"] = "approved"
    with pytest.raises(ValidationError):
        PropagationAssignmentV1.model_validate(assignment)


def test_propagation_generation_must_differ_from_discovery() -> None:
    _proposal, assignment = _role_payloads()
    assignment["propagation_generation_digest"] = assignment["discovery_run_digest"]
    with pytest.raises(ValidationError):
        PropagationAssignmentV1.model_validate(assignment)


@pytest.mark.parametrize("name", ["holdout", "sealed-holdout.json", "benchmark.parquet"])
def test_holdout_or_split_artifact_access_is_blocked(name: str) -> None:
    with pytest.raises(ValueError, match="holdout_access_prohibited"):
        _reject_holdout_paths(Path(name))


def test_external_source_manifest_digest_is_required(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="expected_manifest_digest_required"):
        diagnose_role_separation(tmp_path / "source", tmp_path / "output")


def test_non_finite_embedding_is_blocked() -> None:
    with pytest.raises(ValueError, match="embedding_non_finite"):
        _validate_vectors(np.asarray([[1.0, np.nan]], dtype=np.float32), 1)


def test_embedding_digest_drift_is_blocked(tmp_path: Path) -> None:
    path = tmp_path / "embedding.npy"
    np.save(path, np.asarray([[1.0, 0.0]], dtype=np.float32))
    os.chmod(path, 0o600)
    with pytest.raises(ValueError, match="embedding_drift"):
        _load_embedding(path, _digest("wrong"), 1)


def test_assignment_artifact_drift_is_blocked(tmp_path: Path) -> None:
    full = tmp_path / "full"
    full.mkdir()
    assignments = full / "candidate.seed-17.assignments.npz"
    np.savez_compressed(assignments, labels=np.asarray([0], dtype=np.int32))
    os.chmod(assignments, 0o600)
    result_path = full / "candidate.seed-17.result.json"
    write_private_json(
        result_path,
        {
            "candidate_key": "candidate",
            "seed": 17,
            "assignments_path": str(assignments),
            "assignments_sha256": sha256_file(assignments),
        },
    )
    write_private_json(
        full / "summary.private.json",
        {
            "results": [
                {
                    "candidate_key": "candidate",
                    "seed": 17,
                    "result_sha256": sha256_file(result_path),
                }
            ]
        },
    )
    assignments.write_bytes(b"tampered")
    os.chmod(assignments, 0o600)
    with pytest.raises(ValueError, match="assignment_drift"):
        _load_full_result(tmp_path, 17)


def test_empty_cluster_is_blocked() -> None:
    with pytest.raises(ValueError, match="empty_cluster"):
        _centroids_batched(
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            np.asarray([0], dtype=np.int32),
            [0, 1],
        )


def test_nearest_centroid_without_second_candidate_is_not_available() -> None:
    result = _nearest_centroid_scores(
        np.asarray([[1.0, 0.0]], dtype=np.float32),
        np.asarray([[1.0, 0.0]], dtype=np.float32),
    )
    assert np.isnan(result["second"][0])
    assert np.isnan(result["margin"][0])
    assert set(result) == {"first", "second", "margin", "assigned"}


def test_shared_root_is_one_physical_record_with_two_memberships() -> None:
    records = [_record(0, partitions=("primary", "category"))]
    slices = _slice_distributions(records, np.asarray([0]))
    assert len(records) == 1
    assert sum(slices["partition"].values()) == 2


@pytest.mark.parametrize(
    ("labels", "expected_outliers"),
    [([-1, -1, -1, -1], 4), ([0, 0, 1, 1], 0)],
)
def test_all_or_zero_outliers_are_reconciled(labels: list[int], expected_outliers: int) -> None:
    records = [_record(index) for index in range(4)]
    result = _diagnose_seed(
        records,
        np.eye(4, dtype=np.float32),
        np.asarray(labels, dtype=np.int32),
        np.full(4, np.nan, dtype=np.float32),
        "not_available",
        {
            "seed": 17,
            "assignments_sha256": _digest("assignments"),
            "terms": {"0": ["alpha"], "1": ["beta"]},
        },
        np.asarray(labels, dtype=np.int32),
        17,
    )
    assert result["outliers"]["count"] == expected_outliers
    assert result["assigned_count"] + result["outliers"]["count"] == 4


def test_missing_strength_remains_not_available() -> None:
    records = [_record(index) for index in range(2)]
    result = _diagnose_seed(
        records,
        np.eye(2, dtype=np.float32),
        np.asarray([0, 0], dtype=np.int32),
        np.full(2, np.nan, dtype=np.float32),
        "not_available",
        {"seed": 17, "assignments_sha256": _digest("a"), "terms": {"0": []}},
        np.asarray([0, 0], dtype=np.int32),
        17,
    )
    assert result["membership_strength_summary"]["availability"] == "not_available"


def test_cluster_can_be_single_partition_or_multiscope() -> None:
    records = [
        _record(0, partitions=("primary",)),
        _record(1, partitions=("primary", "competitor_one")),
    ]
    slices = _slice_distributions(records, np.asarray([0, 1]))
    assert slices["partition"]["primary"] == 2
    assert slices["partition"]["competitor_one"] == 1


def _packet_fixture(
    tmp_path: Path, *, expired: bool = False
) -> tuple[list[BenchmarkRecordV2], dict]:
    records = [_record(index, expired=expired) for index in range(4)]
    embedding = tmp_path / "embedding.npy"
    np.save(embedding, np.eye(4, dtype=np.float32))
    os.chmod(embedding, 0o600)
    assignments = tmp_path / "assignments.npz"
    np.savez_compressed(
        assignments,
        labels=np.asarray([0, 0, 1, -1], dtype=np.int32),
        strengths=np.asarray([0.9, 0.8, 0.7, np.nan], dtype=np.float32),
    )
    os.chmod(assignments, 0o600)
    candidate = {
        "candidate_key": "fixture-candidate",
        "assignments_path": str(assignments),
        "assignments_sha256": sha256_file(assignments),
        "terms": {"0": ["alpha"], "1": ["beta"]},
        "artifact_manifest": {
            "embedding_manifest": {"output_path": str(embedding)}
        },
        "metrics": {},
    }
    return records, candidate


def test_diagnostic_packet_is_private_and_supports_human_actions(tmp_path: Path) -> None:
    records, candidate = _packet_fixture(tmp_path)
    output = tmp_path / "packet"
    build_blinded_packet(
        records,
        [candidate],
        output,
        seed=17,
        modeling_decision_allowed=False,
        diagnostic_role_separation=True,
        rights_evaluated_at=datetime.now(UTC),
    )
    packet = json.loads((output / "blind-review-packet.private.json").read_text())
    assert packet["adoption_allowed"] is False
    assert packet["holdout_opened"] is False
    assert packet["count_scope"] == "full_population_diagnostic"
    with (output / "blind-review-score-sheet.private.csv").open() as handle:
        headers = next(csv.reader(handle))
    assert "none_acceptable" in headers
    assert "merge_needed" in headers
    assert "split_needed" in headers
    assert (output / "blind-review-packet.private.json").stat().st_mode & 0o777 == 0o600


def test_packet_fails_when_no_representative_has_current_rights(tmp_path: Path) -> None:
    records, candidate = _packet_fixture(tmp_path, expired=True)
    with pytest.raises(ValueError, match="no_rights_safe_representatives"):
        build_blinded_packet(
            records,
            [candidate],
            tmp_path / "packet",
            seed=17,
            diagnostic_role_separation=True,
            rights_evaluated_at=datetime.now(UTC),
        )


def test_operator_review_supports_none_acceptable_merge_and_split() -> None:
    item = OperatorDiagnosticReviewItemV1(
        contract_version="signal-topic-diagnostic-operator-review-item-v1",
        candidate_artifact_digest=_digest("artifact"),
        discovery_proposal_key=_digest("proposal"),
        cluster_key=_digest("cluster"),
        evidence_refs=[_digest("evidence")],
        data_split="calibration",
        reviewer_ref=_digest("reviewer"),
        reviewed_at=datetime.now(UTC),
        internal_coherence=3,
        neighbor_distinction=2,
        human_nameability=3,
        strategic_utility=4,
        merge_needed=True,
        split_needed=True,
        convert_to_topic_contract_candidate=False,
        none_acceptable=True,
        notes="fixture",
        decision_digest=_digest("decision"),
    )
    assert item.none_acceptable and item.merge_needed and item.split_needed


def test_none_acceptable_cannot_also_create_candidate() -> None:
    with pytest.raises(ValidationError):
        OperatorDiagnosticReviewItemV1(
            contract_version="signal-topic-diagnostic-operator-review-item-v1",
            candidate_artifact_digest=_digest("artifact"),
            discovery_proposal_key=_digest("proposal"),
            cluster_key=_digest("cluster"),
            evidence_refs=[_digest("evidence")],
            data_split="train",
            reviewer_ref=_digest("reviewer"),
            reviewed_at=datetime.now(UTC),
            internal_coherence=3,
            neighbor_distinction=3,
            human_nameability=3,
            strategic_utility=3,
            merge_needed=False,
            split_needed=False,
            convert_to_topic_contract_candidate=True,
            none_acceptable=True,
            notes="",
            decision_digest=_digest("decision"),
        )


def test_scale_projection_is_explicitly_not_an_slo_and_has_no_n_squared() -> None:
    payload = _complexity_projection(
        20_000,
        1_024,
        [{"cluster_count": 100}],
    )
    assert payload["dense_n_by_n_matrix"] == "prohibited"
    assert payload["projections"]["2000000"]["is_slo"] is False
    assert payload["time"] == "O(N*K*D + K^2*D)"


def test_replay_detects_packet_tampering(tmp_path: Path) -> None:
    output = tmp_path / "output"
    output.mkdir(mode=0o700)
    review = output / "operator-review"
    review.mkdir(mode=0o700)
    private = output / "diagnostic.private.json"
    packet = review / "blind-review-packet.private.json"
    write_private_json(private, {"analytic_digest": _digest("analytic")})
    write_private_json(packet, {"packet_digest": _digest("packet")})
    manifest = {
        "analytic_digest": _digest("analytic"),
        "files": [
            {
                "path": private.name,
                "bytes": private.stat().st_size,
                "sha256": sha256_file(private),
            },
            {
                "path": packet.relative_to(output).as_posix(),
                "bytes": packet.stat().st_size,
                "sha256": sha256_file(packet),
            }
        ],
    }
    write_private_json(output / "manifest.sanitized.json", manifest)
    packet.write_text("tampered", encoding="utf-8")
    os.chmod(packet, 0o600)
    with pytest.raises(ValueError, match="replay_artifact_drift"):
        _validate_replay(output)


def test_sanitized_manifest_fixture_contains_no_private_text(tmp_path: Path) -> None:
    payload = {
        "contract_version": "fixture",
        "files": [{"path": "packet.private.json", "sha256": _digest("packet")}],
    }
    path = tmp_path / "manifest.sanitized.json"
    write_private_json(path, payload)
    assert "text 0" not in path.read_text()
    assert "excerpt" not in path.read_text()


def test_proposed_plan_cannot_execute_or_open_holdout() -> None:
    path = Path(__file__).parents[1] / "config" / "benchmark-plan-10c3b-proposed.json"
    plan = json.loads(path.read_text())
    assert plan["execution_authorized"] is False
    assert plan["holdout_authorized"] is False
    assert plan["ten_d_authorized"] is False
    assert all(
        family["execution_state"] == "not_authorized"
        for family in plan["discovery_proposal_benchmark"]["families"]
    )
    families = {
        family["key"]: family
        for family in plan["discovery_proposal_benchmark"]["families"]
    }
    leiden = families["bge-m3-mutual-knn-leiden"]
    assert leiden["immutable_revisions"] == "operator_decision_required_before_execution"
    assert leiden["platform_evidence"]["macos_arm64"].startswith("not_proven")
    assert leiden["platform_evidence"]["linux_batch"] == "not_tested"
    assert leiden["supply_chain_state"] == "operator_decision_required"
    minibatch = families["bge-m3-normalized-minibatch-kmeans"]
    assert minibatch["platform_evidence"]["linux_batch"].startswith("requires_")
    assert minibatch["batch_capability"] == (
        "minibatch_api_available; no_noisia_challenger_run_executed"
    )


def test_reference_seed_is_first_preregistered_seed_not_best_metric() -> None:
    seeds = _preregistered_seeds({"stages": {"final_seeds": [17, 43, 71]}})
    metrics = {17: 0.1, 43: 0.9, 71: 0.8}
    assert seeds[0] == 17
    assert metrics[seeds[0]] < max(metrics.values())


def test_10c2_signed_plans_remain_byte_for_byte_intact() -> None:
    config = Path(__file__).parents[1] / "config"
    assert sha256_file(config / "benchmark-plan-10c2.json") == (
        "sha256:8f557769af29f87e89996fd6bc8db3e4fd20e73b96ed21464517eb73244bd736"
    )
    assert sha256_file(config / "benchmark-plan-10c2-v3.json") == (
        "sha256:53d1e16852bf85bebe93ddb122037d8db0e23cab6b584daa1b160a55c994c462"
    )
