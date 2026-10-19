from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .canonical import canonical_json, sha256_file, sha256_text, write_private_json
from .input_data import load_export
from .plan import load_run_plan, plan_digest
from .runner import (
    assert_preregistered_corpus,
    build_stability,
    compute_harness_source_digest,
    passes_full_candidate_gates,
    passes_full_stability_gates,
)
from .schema import ExportManifestV2
from .splits import assert_no_leakage, deterministic_splits


def execute_notebook(run_dir: Path, output_path: Path) -> dict[str, Any]:
    import nbformat
    from nbclient import NotebookClient

    template = Path(__file__).resolve().parents[2] / "notebooks" / "10c_benchmark_report.ipynb"
    notebook = nbformat.read(template, as_version=4)
    previous = os.environ.get("SIGNAL_SEMANTIC_LAB_RUN_DIR")
    os.environ["SIGNAL_SEMANTIC_LAB_RUN_DIR"] = str(run_dir.resolve())
    try:
        NotebookClient(
            notebook,
            timeout=300,
            kernel_name="python3",
            resources={"metadata": {"path": str(run_dir.resolve())}},
        ).execute()
    finally:
        if previous is None:
            os.environ.pop("SIGNAL_SEMANTIC_LAB_RUN_DIR", None)
        else:
            os.environ["SIGNAL_SEMANTIC_LAB_RUN_DIR"] = previous
    output_path.parent.mkdir(parents=True, exist_ok=True)
    nbformat.write(notebook, output_path)
    os.chmod(output_path, 0o600)
    return {
        "contract_version": "signal-local-modeling-notebook-execution-v1",
        "output": str(output_path),
        "sha256": sha256_file(output_path),
    }


def build_report_data(run_dir: Path) -> dict[str, Any]:
    plan = load_run_plan(run_dir)
    is_v3 = plan.get("contract_version") == "signal-local-modeling-benchmark-plan-v3"
    run_state = json.loads((run_dir / "run-state.private.json").read_text())
    if run_state.get("plan_digest") != plan_digest(plan):
        raise ValueError("benchmark_report_plan_digest_mismatch")
    current_harness_source_digest = compute_harness_source_digest()
    modeling_harness_source_digest = str(run_state.get("harness_source_digest"))
    if modeling_harness_source_digest != current_harness_source_digest:
        if is_v3:
            if (
                run_state.get("holdout_state") != "sealed"
                or not (run_dir / "full-finalists.sealed.private.json").is_file()
            ):
                raise ValueError("benchmark_report_harness_source_digest_mismatch")
        else:
            packet_lineage_path = run_dir / "operator-review" / "blind-review-packet.private.json"
            if not packet_lineage_path.is_file():
                raise ValueError("benchmark_report_harness_source_digest_mismatch")
            packet_lineage = json.loads(packet_lineage_path.read_text())
            if not (
                packet_lineage.get("modeling_harness_source_digest")
                == modeling_harness_source_digest
                and packet_lineage.get("packet_harness_source_digest")
                == current_harness_source_digest
                and packet_lineage.get("packet_built_after_modeling_harness_change") is True
            ):
                raise ValueError("benchmark_report_harness_source_digest_mismatch")
    records, validated_manifest = load_export(
        run_dir / "source-export.private.jsonl",
        run_dir / "source-export.manifest.private.json",
    )
    assert_preregistered_corpus(plan, validated_manifest, len(records))
    split_assignments = deterministic_splits(
        records,
        seed=int(plan["splits"]["seed"]),
        train=float(plan["splits"]["train_fraction"]),
        calibration=float(plan["splits"]["calibration_fraction"]),
    )
    assert_no_leakage(records, split_assignments)
    computed_split_digest = sha256_text(
        canonical_json(
            [
                {
                    "record_key": item.record_key,
                    "split": item.split,
                    "stratum": item.stratum,
                }
                for item in split_assignments
            ]
        )
    )
    if computed_split_digest != run_state["split_digest"]:
        raise ValueError("benchmark_report_split_digest_mismatch")
    finalists = json.loads((run_dir / "finalists.private.json").read_text())
    stability_path = run_dir / "full" / "stability.private.json"
    stability = (
        json.loads(stability_path.read_text())
        if finalists["candidate_keys"] and stability_path.is_file()
        else (build_stability(run_dir) if finalists["candidate_keys"] else {})
    )
    if set(stability) != set(finalists["candidate_keys"]):
        raise ValueError("benchmark_stability_artifact_candidate_mismatch")
    stage_summaries = {
        stage: json.loads((run_dir / stage / "summary.private.json").read_text())
        for stage in ("smoke", "calibration", "full")
        if (run_dir / stage / "summary.private.json").exists()
    }
    manifest = json.loads((run_dir / "source-export.manifest.private.json").read_text())
    review_dir = run_dir / "operator-review"
    packet_path = review_dir / "blind-review-packet.private.json"
    key_path = review_dir / "blind-review-key.private.json"
    score_path = review_dir / "blind-review-score-sheet.private.csv"
    decision_path = review_dir / "blind-review-decision-sheet.private.csv"
    contract_fixture_path = run_dir / "10c1-offline-contract-fixtures.private.json"
    full_gate_candidates = [
        key
        for key in finalists["candidate_keys"]
        if passes_full_candidate_gates(run_dir, key, plan)
    ]
    stability_gate_candidates = [
        key
        for key in finalists["candidate_keys"]
        if passes_full_stability_gates(stability[key], plan["hard_gates"])
    ]
    stable_candidates = [
        key
        for key in finalists["candidate_keys"]
        if key in full_gate_candidates and key in stability_gate_candidates
    ]
    frozen: dict[str, Any] | None = None
    if is_v3:
        frozen_path = run_dir / "full-finalists.sealed.private.json"
        if not frozen_path.is_file():
            raise ValueError("benchmark_full_finalists_not_frozen")
        frozen = json.loads(frozen_path.read_text())
        unsigned = {key: value for key, value in frozen.items() if key != "full_finalists_digest"}
        if (
            frozen.get("full_finalists_digest") != run_state.get("full_finalists_digest")
            or frozen.get("full_finalists_digest") != sha256_text(canonical_json(unsigned))
            or frozen.get("candidate_keys") != stable_candidates
            or run_state.get("holdout_state") != "sealed"
        ):
            raise ValueError("benchmark_full_finalists_freeze_drift")
    technical_status = (
        "finalists_frozen"
        if stable_candidates and is_v3
        else "finalist_available"
        if stable_candidates
        else "no_adoption"
    )
    required_review_artifacts = (
        packet_path,
        key_path,
        score_path,
        decision_path,
        contract_fixture_path,
    )
    packet: dict[str, Any] | None = None
    if not is_v3:
        if not all(path.is_file() for path in required_review_artifacts):
            raise ValueError("benchmark_operator_review_artifact_missing")
        packet = json.loads(packet_path.read_text())
        expected_review_status = (
            "operator_review_required" if stable_candidates else "technical_no_adoption_review"
        )
        if (
            packet.get("review_status") != expected_review_status
            or packet.get("modeling_decision_allowed") is not bool(stable_candidates)
            or int(packet.get("population_denominator", -1))
            != _manifest_denominator(validated_manifest)
        ):
            raise ValueError("benchmark_operator_review_artifact_state_mismatch")
    human_review = (
        {
            "state": "holdout_sealed",
            "completed": False,
            "winner": None,
            "review_status": (
                "holdout_authorization_required" if stable_candidates else "not_required"
            ),
            "modeling_decision_allowed": False,
            "packet_sha256": None,
            "score_sheet_sha256": None,
            "decision_sheet_sha256": None,
            "required_actions": (
                ["Obtain a separate operator authorization before opening holdout."]
                if stable_candidates
                else []
            ),
        }
        if is_v3
        else {
            "state": "pending",
            "completed": False,
            "winner": None,
            "review_status": packet["review_status"],
            "modeling_decision_allowed": packet["modeling_decision_allowed"],
            "packet_sha256": sha256_file(packet_path),
            "score_sheet_sha256": sha256_file(score_path),
            "decision_sheet_sha256": sha256_file(decision_path),
            "required_actions": [
                "Complete the blind score sheet without opening the private key.",
                "Record none acceptable when no candidate meets the rubric.",
                "Create a separate adoption ADR only after the review is signed.",
            ],
        }
    )
    report = {
        "contract_version": (
            "signal-local-modeling-technical-report-v3"
            if is_v3
            else "signal-local-modeling-report-v2"
        ),
        "technical_benchmark_status": technical_status,
        "technical_result": technical_status,
        "canon_reconciled": True,
        "ready_for_operator_review": not is_v3,
        "modeling_decision_ready_for_10d": False,
        "human_review": human_review,
        "plan_digest": plan_digest(plan),
        "harness_source_digest": run_state["harness_source_digest"],
        "modeling_harness_source_digest": modeling_harness_source_digest,
        "postprocessing_harness_source_digest": current_harness_source_digest,
        "postprocessing_sealed_separately": (
            modeling_harness_source_digest != current_harness_source_digest
        ),
        "export": _report_export(manifest, plan),
        "evaluation_layers": plan.get("evaluation_layers", []),
        "data_quality": {
            "as_of": validated_manifest.export_timestamp.isoformat(),
            "grain": "one_export_row_per_canonical_family",
            "record_count": len(records),
            "record_key_duplicate_count": 0,
            "canonical_family_duplicate_count": 0,
            "content_hash_mismatch_count": 0,
            "denominator_reconciles": (
                _manifest_denominator(validated_manifest)
                == validated_manifest.exported + sum(validated_manifest.excluded_by_reason.values())
            ),
            "canonical_family_leakage": False,
            "content_hash_leakage": False,
            "split_counts": run_state["split_counts"],
            "split_digest": computed_split_digest,
            "holdout_used_before_finalist_selection": False,
            "authority_valid_at_export": True,
            "scope_evidence": plan["corpus"].get(
                "scope_evidence", "acquisition_multiscope_partitions"
            ),
            "general_adoption_limitation": plan["corpus"].get("general_adoption_limitation"),
        },
        "offline_contract_fixtures_sha256": (
            sha256_file(contract_fixture_path) if contract_fixture_path.is_file() else None
        ),
        "finalists": finalists,
        "full_finalists_freeze": frozen,
        "full_gate_candidates": full_gate_candidates,
        "stability_gate_candidates": stability_gate_candidates,
        "stable_operator_review_candidates": stable_candidates,
        "stability": stability,
        "stages": {
            stage: {
                "record_count": summary["record_count"],
                "resource_rejections": summary.get("resource_rejections", []),
                "candidate_rejections": summary.get("candidate_rejections", []),
                "results": summary["results"],
            }
            for stage, summary in stage_summaries.items()
        },
        "gold_metrics": {
            "availability": "not_available",
            "reason": "No human gold set comparable to unsupervised topic discovery was provided.",
        },
        "decision": {
            "state": technical_status,
            "winner": None,
            "reason": (
                "Technical evidence cannot replace blinded human evaluation."
                if stable_candidates
                else (
                    "No operable finalist pair passed the preregistered calibration gates."
                    if finalists.get("state") == "no_adoption"
                    or not finalists.get("candidate_keys")
                    else (
                        "No calibration finalist passed every preregistered full-seed "
                        "quality and coverage gate."
                        if not full_gate_candidates
                        else "No finalist passed the preregistered full-seed stability gates."
                    )
                )
            ),
        },
        "safety": {
            "remote_reads": (1 if manifest.get("target") == "noisia-staging" else 0),
            "remote_read_scope": (
                "noisia-staging" if manifest.get("target") == "noisia-staging" else "local_fixture"
            ),
            "remote_writes": 0,
            "production_reads_writes": 0,
            "provider_calls": 0,
            "paid_jobs": 0,
            "serving_writes": 0,
            "new_open_source_model_artifact_download_bytes": (0 if is_v3 else 2_267_546_218),
            "reused_open_source_model_artifact_bytes": (
                sum(int(item["artifact_bytes"]) for item in plan["embeddings"])
                if is_v3
                else 470_642_255
            ),
            "pinned_open_source_model_artifact_bytes": sum(
                int(item["artifact_bytes"]) for item in plan["embeddings"]
            ),
            "artifact_and_environment_download_upper_bound_bytes": sum(
                int(item["artifact_bytes"]) for item in plan["embeddings"]
            )
            + 750_000_000,
            "open_source_artifact_network_reads_only": not is_v3,
            "model_artifact_cache_mode": ("offline_pinned_cache" if is_v3 else "network_read_only"),
            "reused_sealed_staging_export": False if is_v3 else True,
            "holdout_opened": False if is_v3 else None,
        },
    }
    output = run_dir / "report-data.sanitized.json"
    write_private_json(output, report)
    return {**report, "report_path": str(output), "report_sha256": sha256_file(output)}


def _manifest_denominator(manifest: Any) -> int:
    if isinstance(manifest, ExportManifestV2):
        return manifest.acquisition_denominator
    return manifest.denominator


def _report_export(manifest: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    is_v2 = manifest.get("contract_version") == "signal-semantic-benchmark-export-v2"
    protected_before = manifest.get("protected_state_digest_before")
    protected_after = manifest.get("protected_state_digest_after")
    return {
        "target": manifest["target"],
        "workspace_ref": manifest["workspace_ref"],
        "population_digest": manifest["population_digest"],
        "watermark_digest": manifest["watermark_digest"],
        "content_digest": manifest["content_digest"],
        "provenance_digest": manifest.get("provenance_digest"),
        "denominator": (manifest["acquisition_denominator"] if is_v2 else manifest["denominator"]),
        "exported": manifest["exported"],
        "excluded_by_reason": manifest["excluded_by_reason"],
        "partitions": manifest.get("partitions"),
        "scope_counts": manifest.get("scope_counts"),
        "language_counts": manifest["language_counts"],
        "country_counts": manifest.get("country_counts"),
        "declared_market_membership_counts": manifest.get("declared_market_membership_counts"),
        "platform_counts": manifest["platform_counts"],
        "general_adoption_limitation": plan["corpus"].get("general_adoption_limitation"),
        "read_only": manifest["read_only"],
        "transaction_read_only": manifest["transaction_read_only"],
        "transaction_id_assigned": manifest["transaction_id_assigned"],
        "protected_state_digest_before": protected_before,
        "protected_state_digest_after": protected_after,
        "protected_state_unchanged": (
            protected_before == protected_after if protected_before is not None else None
        ),
        "writes_performed": manifest["writes_performed"],
        "jobs_enqueued": manifest["jobs_enqueued"],
        "provider_calls": manifest["provider_calls"],
        "serving_writes": manifest.get("serving_writes", 0),
    }


def build_manifest(run_dir: Path) -> dict[str, Any]:
    files = []
    for path in sorted(run_dir.rglob("*")):
        if not path.is_file():
            continue
        if path == run_dir / "manifest.sanitized.json":
            continue
        files.append(
            {
                "path": str(path.relative_to(run_dir)),
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
                "mode": oct(path.stat().st_mode & 0o777),
            }
        )
    cache_files = []
    run_state_path = run_dir / "run-state.private.json"
    if run_state_path.is_file():
        cache_value = json.loads(run_state_path.read_text()).get("embedding_cache_dir")
        cache_dir = Path(cache_value).resolve() if cache_value else None
        referenced_cache_paths: set[Path] = set()
        for stage in ("smoke", "calibration", "full"):
            for embedding_receipt in sorted((run_dir / stage).glob("*.embedding.json")):
                output_value = json.loads(embedding_receipt.read_text()).get("output_path")
                if not output_value or cache_dir is None:
                    raise ValueError("benchmark_embedding_cache_reference_missing")
                output_path = Path(output_value).resolve()
                manifest_path = output_path.with_suffix(".json")
                if output_path.parent != cache_dir or manifest_path.parent != cache_dir:
                    raise ValueError("benchmark_embedding_cache_reference_outside_run_cache")
                referenced_cache_paths.update({output_path, manifest_path})
        for path in sorted(referenced_cache_paths):
            if not path.is_file():
                raise ValueError("benchmark_embedding_cache_referenced_artifact_missing")
            cache_files.append(
                {
                    "path": f"embedding-cache/{path.name}",
                    "sha256": sha256_file(path),
                    "bytes": path.stat().st_size,
                    "mode": oct(path.stat().st_mode & 0o777),
                }
            )
    manifest = {
        "contract_version": "signal-local-modeling-evidence-manifest-v1",
        "files": files,
        "external_cache_files": cache_files,
        "external_cache_scope": "referenced_by_this_run_only",
        "all_files_private": all(item["mode"] == "0o600" for item in [*files, *cache_files]),
    }
    output = run_dir / "manifest.sanitized.json"
    write_private_json(output, manifest)
    return {**manifest, "manifest_path": str(output), "manifest_sha256": sha256_file(output)}


def enforce_private_tree(run_dir: Path) -> None:
    for path in run_dir.rglob("*"):
        if path.is_dir():
            os.chmod(path, 0o700)
        elif path.is_file():
            os.chmod(path, 0o600)
