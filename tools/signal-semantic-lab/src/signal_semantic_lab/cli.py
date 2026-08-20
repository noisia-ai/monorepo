from __future__ import annotations

import argparse
import json
from pathlib import Path

from .canonical import sha256_file, write_private_json
from .contract_fixtures import build_offline_contract_fixtures
from .fixture import generate_fixture, generate_multiscope_fixture
from .input_data import load_export
from .multiscope import dry_run_multiscope_contract
from .plan import load_plan, plan_digest
from .preflight import run_preflight
from .report import build_manifest, build_report_data, enforce_private_tree, execute_notebook
from .runner import (
    authorize_run,
    build_packet,
    freeze_full_finalists,
    import_embedding_cache,
    open_holdout_once,
    prepare_run,
    run_stage,
)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="signal-semantic-lab")
    commands = root.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("--input", type=Path, required=True)
    validate.add_argument("--manifest", type=Path, required=True)
    export_v2 = commands.add_parser("export-v2")
    export_v2.add_argument("--input", type=Path, required=True)
    export_v2.add_argument("--manifest", type=Path, required=True)
    validate_plan = commands.add_parser("validate-plan")
    validate_plan.add_argument("--plan", type=Path, required=True)
    validate_plan.add_argument("--output", type=Path)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--input", type=Path, required=True)
    prepare.add_argument("--manifest", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--plan", type=Path)
    prepare.add_argument("--embedding-cache", type=Path)
    cache_import = commands.add_parser("cache-import")
    cache_import.add_argument("--manifest", type=Path, required=True)
    cache_import.add_argument("--embedding-cache", type=Path, required=True)
    authorize = commands.add_parser("authorize-execution")
    authorize.add_argument("--run-dir", type=Path, required=True)
    authorize.add_argument("--authorization", type=Path, required=True)
    run = commands.add_parser("run")
    run.add_argument("--stage", choices=["smoke", "calibration", "full"], required=True)
    run.add_argument("--run-dir", type=Path, required=True)
    for stage in ("smoke", "calibration", "full"):
        stage_parser = commands.add_parser(stage)
        stage_parser.add_argument("--run-dir", type=Path, required=True)
    freeze_finalists = commands.add_parser("freeze-finalists")
    freeze_finalists.add_argument("--run-dir", type=Path, required=True)
    open_holdout = commands.add_parser("open-holdout")
    open_holdout.add_argument("--run-dir", type=Path, required=True)
    open_holdout.add_argument("--authorization", type=Path, required=True)
    packet = commands.add_parser("packet")
    packet.add_argument("--run-dir", type=Path, required=True)
    report = commands.add_parser("report")
    report.add_argument("--run-dir", type=Path, required=True)
    notebook = commands.add_parser("notebook")
    notebook.add_argument("--run-dir", type=Path, required=True)
    notebook.add_argument("--output", type=Path, required=True)
    fixture = commands.add_parser("fixture")
    fixture.add_argument("--output", type=Path, required=True)
    fixture.add_argument("--records", type=int, default=1_500)
    fixture_v2 = commands.add_parser("fixture-v2")
    fixture_v2.add_argument("--output", type=Path, required=True)
    fixture_smoke = commands.add_parser("fixture-smoke")
    fixture_smoke.add_argument("--input", type=Path, required=True)
    fixture_smoke.add_argument("--manifest", type=Path, required=True)
    fixture_smoke.add_argument("--plan", type=Path, required=True)
    fixture_smoke.add_argument("--output", type=Path)
    preflight = commands.add_parser("preflight")
    preflight.add_argument("--output", type=Path, required=True)
    preflight.add_argument("--plan", type=Path)
    contracts = commands.add_parser("contracts")
    contracts.add_argument("--output", type=Path, required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.command in {"validate", "export-v2"}:
        records, manifest = load_export(args.input, args.manifest)
        if (
            args.command == "export-v2"
            and manifest.contract_version != "signal-semantic-benchmark-export-v2"
        ):
            raise ValueError("benchmark_export_v2_contract_required")
        denominator = getattr(manifest, "acquisition_denominator", None)
        if denominator is None:
            denominator = manifest.denominator
        result = {"ok": True, "records": len(records), "denominator": denominator}
    elif args.command == "validate-plan":
        plan = load_plan(args.plan)
        result = {
            "ok": True,
            "contract_version": plan["contract_version"],
            "plan_digest": plan_digest(plan),
            "execution_authorized": bool(plan.get("execution_authorized", True)),
            "ten_d_authorized": bool(plan.get("ten_d_authorized", False)),
        }
        if args.output:
            write_private_json(args.output, result)
            result = {
                **result,
                "output": str(args.output),
                "output_sha256": sha256_file(args.output),
            }
    elif args.command == "prepare":
        result = prepare_run(
            args.input,
            args.manifest,
            args.output,
            plan_path=args.plan,
            embedding_cache_dir=args.embedding_cache,
        )
    elif args.command == "cache-import":
        result = import_embedding_cache(args.manifest, args.embedding_cache)
    elif args.command == "authorize-execution":
        result = authorize_run(args.run_dir, args.authorization)
    elif args.command == "run":
        summary = run_stage(args.run_dir, args.stage)
        summary_path = args.run_dir / args.stage / "summary.private.json"
        result = {
            "contract_version": summary["contract_version"],
            "stage": summary["stage"],
            "record_count": summary["record_count"],
            "candidate_runs": [
                {"candidate_key": row["candidate_key"], "seed": row["seed"]}
                for row in summary["results"]
            ],
            "summary": str(summary_path),
            "summary_sha256": sha256_file(summary_path),
        }
    elif args.command in {"smoke", "calibration", "full"}:
        summary = run_stage(args.run_dir, args.command)
        result = {
            "contract_version": summary["contract_version"],
            "stage": summary["stage"],
            "record_count": summary["record_count"],
            "summary": str(args.run_dir / args.command / "summary.private.json"),
        }
    elif args.command == "freeze-finalists":
        result = freeze_full_finalists(args.run_dir)
    elif args.command == "open-holdout":
        result = open_holdout_once(args.run_dir, args.authorization)
    elif args.command == "packet":
        result = build_packet(args.run_dir)
    elif args.command == "report":
        report_payload = build_report_data(args.run_dir)
        enforce_private_tree(args.run_dir)
        manifest_payload = build_manifest(args.run_dir)
        result = {
            "contract_version": report_payload["contract_version"],
            "technical_result": report_payload["technical_result"],
            "ready_for_operator_review": report_payload["ready_for_operator_review"],
            "modeling_decision_ready_for_10d": report_payload["modeling_decision_ready_for_10d"],
            "report": report_payload["report_path"],
            "report_sha256": report_payload["report_sha256"],
            "manifest": manifest_payload["manifest_path"],
            "manifest_sha256": manifest_payload["manifest_sha256"],
        }
    elif args.command == "notebook":
        result = execute_notebook(args.run_dir, args.output)
    elif args.command == "fixture":
        result = generate_fixture(args.output, args.records)
    elif args.command == "fixture-v2":
        result = generate_multiscope_fixture(args.output)
    elif args.command == "fixture-smoke":
        records, manifest = load_export(args.input, args.manifest)
        if manifest.contract_version != "signal-semantic-benchmark-export-v2":
            raise ValueError("benchmark_fixture_smoke_requires_v2")
        typed_records = [
            record for record in records if record.contract_version.endswith("record-v2")
        ]
        if len(typed_records) != len(records):
            raise ValueError("benchmark_fixture_smoke_requires_v2")
        plan = load_plan(args.plan)
        result = dry_run_multiscope_contract(
            typed_records,
            list(manifest.partitions),
            plan["hard_gates"],
        )
        if args.output:
            write_private_json(args.output, result)
            result = {
                "contract_version": result["contract_version"],
                "record_count": result["record_count"],
                "output": str(args.output),
                "output_sha256": sha256_file(args.output),
                "provider_calls": result["provider_calls"],
                "remote_writes": result["remote_writes"],
                "serving_writes": result["serving_writes"],
                "holdout_state": result["holdout_state"],
            }
    elif args.command == "preflight":
        result = run_preflight(args.output, plan_path=args.plan)
    elif args.command == "contracts":
        payload = build_offline_contract_fixtures(args.output)
        result = {
            "contract_version": payload["contract_version"],
            "output": str(args.output),
            "sha256": sha256_file(args.output),
            "fixture_digest": payload["fixture_digest"],
            "provider_calls": payload["provider_calls"],
            "remote_writes": payload["remote_writes"],
        }
    else:  # pragma: no cover
        raise AssertionError(args.command)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
