from __future__ import annotations

import os
import platform
import shutil
import sys
from pathlib import Path
from typing import Any

import psutil

from .canonical import sha256_file, write_private_json
from .plan import load_plan, plan_digest


def run_preflight(output: Path, *, plan_path: Path | None = None) -> dict[str, Any]:
    import torch

    plan = load_plan(plan_path)
    physical_ram = psutil.virtual_memory().total
    disk = shutil.disk_usage(output.parent if output.parent.exists() else Path.cwd())
    model_bytes = sum(int(item["artifact_bytes"]) for item in plan["embeddings"])
    cache_estimate = int(model_bytes * 1.75)
    max_ram = int(plan["hardware_budget"]["max_peak_ram_bytes"])
    result = {
        "contract_version": "signal-local-modeling-preflight-v1",
        "plan_digest": plan_digest(plan),
        "hardware": {
            "architecture": platform.machine(),
            "platform": platform.platform(),
            "python": sys.version.split()[0],
            "cpu_count": os.cpu_count(),
            "physical_ram_bytes": physical_ram,
            "ram_limit_bytes": max_ram,
            "ram_limit_fraction": max_ram / physical_ram,
            "disk_free_bytes": disk.free,
            "mps_built": bool(torch.backends.mps.is_built()),
            "mps_available": bool(torch.backends.mps.is_available()),
        },
        "estimates": {
            "model_artifact_bytes": model_bytes,
            "model_cache_upper_bound_bytes": cache_estimate,
            "environment_download_upper_bound_bytes": 750_000_000,
            "smoke_timeout_seconds": plan["hardware_budget"]["smoke_timeout_seconds"],
            "calibration_timeout_seconds": plan["hardware_budget"]["calibration_timeout_seconds"],
            "full_candidate_timeout_seconds": plan["hardware_budget"][
                "full_candidate_timeout_seconds"
            ],
        },
        "candidates": [
            {
                "key": item["key"],
                "repository": item["repository"],
                "revision": item["revision"],
                "license": item["license"],
                "license_url": item["license_url"],
                "artifact_bytes": item["artifact_bytes"],
                "artifact_files": item["artifact_files"],
            }
            for item in plan["embeddings"]
        ],
        "dependencies": plan["material_dependencies"],
        "candidate_grid": plan.get("candidates"),
        "excluded_candidates": plan.get("excluded_candidates", []),
        "checks": {
            "python_3_12": sys.version_info[:2] == (3, 12),
            "arm64": platform.machine() == plan["hardware_budget"]["architecture"],
            "ram_within_75_percent": max_ram <= physical_ram * 0.75,
            "downloads_within_20gb": model_bytes
            <= int(plan["hardware_budget"]["max_download_bytes"]),
            "disk_headroom": disk.free >= cache_estimate * 2,
            "lock_present": (Path(__file__).resolve().parents[2] / "uv.lock").is_file(),
        },
        "safety": {"provider_calls": 0, "remote_reads": 0, "remote_writes": 0},
    }
    if not all(result["checks"].values()):
        raise ValueError("benchmark_preflight_failed")
    write_private_json(output, result)
    return {**result, "path": str(output), "sha256": sha256_file(output)}
