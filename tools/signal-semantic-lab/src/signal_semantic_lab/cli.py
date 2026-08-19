from __future__ import annotations

import argparse
import json
from pathlib import Path

from .canonical import sha256_file
from .contract_fixtures import build_offline_contract_fixtures
from .fixture import generate_fixture
from .input_data import load_export
from .preflight import run_preflight
from .report import build_manifest, build_report_data, enforce_private_tree, execute_notebook
from .runner import build_packet, import_embedding_cache, prepare_run, run_stage


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="signal-semantic-lab")
    commands = root.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("--input", type=Path, required=True)
    validate.add_argument("--manifest", type=Path, required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--input", type=Path, required=True)
    prepare.add_argument("--manifest", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--plan", type=Path)
    prepare.add_argument("--embedding-cache", type=Path)
    cache_import = commands.add_parser("cache-import")
    cache_import.add_argument("--manifest", type=Path, required=True)
    cache_import.add_argument("--embedding-cache", type=Path, required=True)
    run = commands.add_parser("run")
    run.add_argument("--stage", choices=["smoke", "calibration", "full"], required=True)
    run.add_argument("--run-dir", type=Path, required=True)
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
    preflight = commands.add_parser("preflight")
    preflight.add_argument("--output", type=Path, required=True)
    preflight.add_argument("--plan", type=Path)
    contracts = commands.add_parser("contracts")
    contracts.add_argument("--output", type=Path, required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.command == "validate":
        records, manifest = load_export(args.input, args.manifest)
        result = {"ok": True, "records": len(records), "denominator": manifest.denominator}
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
            "modeling_decision_ready_for_10d": report_payload[
                "modeling_decision_ready_for_10d"
            ],
            "report": report_payload["report_path"],
            "report_sha256": report_payload["report_sha256"],
            "manifest": manifest_payload["manifest_path"],
            "manifest_sha256": manifest_payload["manifest_sha256"],
        }
    elif args.command == "notebook":
        result = execute_notebook(args.run_dir, args.output)
    elif args.command == "fixture":
        result = generate_fixture(args.output, args.records)
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
