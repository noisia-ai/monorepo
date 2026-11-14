#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
run_id="${R16BENCH_RUN_ID:-}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9_-]{2,47}$ ]]; then
  echo "Set R16BENCH_RUN_ID to the exact private run ID printed by lab-up.sh." >&2
  exit 2
fi
lab_dir="$repo_root/.data/piloto-masivo/r16/labs/$run_id"
secrets_file="$lab_dir/private.env"
if [[ ! -f "$secrets_file" ]]; then
  echo "No private R16 benchmark lab found for that run ID." >&2
  exit 2
fi
project="r16bench-$run_id"
docker compose --project-name "$project" --env-file "$secrets_file" \
  -f "$repo_root/scripts/r16/docker-compose.yml" down --volumes
rm -f "$secrets_file" "$lab_dir/connection.env"
echo "Stopped and removed only the isolated R16 lab project $project."
