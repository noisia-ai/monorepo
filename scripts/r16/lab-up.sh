#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
run_id="${R16BENCH_RUN_ID:-$(date -u +%Y%m%dt%H%M%Sz)-$$}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9_-]{2,47}$ ]]; then
  echo "R16BENCH_RUN_ID must be 3–48 lowercase alphanumeric, underscore or hyphen characters." >&2
  exit 2
fi
project="r16bench-$run_id"
lab_dir="$repo_root/.data/piloto-masivo/r16/labs/$run_id"
mkdir -m 700 -p "$lab_dir"
secrets_file="$lab_dir/private.env"
connection_file="$lab_dir/connection.env"
if [[ -e "$secrets_file" || -e "$connection_file" ]]; then
  echo "This private lab run already exists; choose a new R16BENCH_RUN_ID." >&2
  exit 2
fi

umask 077
password="$(openssl rand -hex 24)"
database="r16bench_${run_id//[^a-zA-Z0-9]/_}"
container_name="r16bench-${run_id}-postgres"
if [[ "$run_id" == "benchmark-pg17" ]]; then
  container_name="r16-benchmark-pg17"
  database="noisia_mfp_ci"
fi
database="${R16BENCH_DB_NAME:-$database}"
if [[ ! "$database" =~ ^[a-z][a-z0-9_]{2,62}$ || ! "$container_name" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]]; then
  echo "Invalid local R16 database/container name." >&2
  exit 2
fi
cat > "$secrets_file" <<EOF
R16BENCH_DB_NAME=$database
R16BENCH_POSTGRES_PASSWORD=$password
R16BENCH_POSTGRES_CONTAINER_NAME=$container_name
EOF

compose=(docker compose --project-name "$project" --env-file "$secrets_file" -f "$repo_root/scripts/r16/docker-compose.yml")
IFS=, read -r -a services <<< "${R16BENCH_SERVICES:-postgres,redis}"
if [[ "${#services[@]}" -eq 0 ]]; then
  echo "R16BENCH_SERVICES must include postgres, redis, or both." >&2
  exit 2
fi
for service in "${services[@]}"; do
  if [[ "$service" != "postgres" && "$service" != "redis" ]]; then
    echo "Unsupported R16BENCH_SERVICES entry: $service" >&2
    exit 2
  fi
done
"${compose[@]}" up --detach --wait "${services[@]}"
: > "$connection_file"
if [[ " ${services[*]} " == *" postgres "* ]]; then
  published_port="$("${compose[@]}" port postgres 5432 | sed 's/.*://')"
  printf 'DATABASE_URL=postgresql://postgres:%s@127.0.0.1:%s/%s\n' "$password" "$published_port" "$database" >> "$connection_file"
fi
if [[ " ${services[*]} " == *" redis "* ]]; then
  redis_port="$("${compose[@]}" port redis 6379 | sed 's/.*://')"
  printf 'R16BENCH_REDIS_URL=redis://127.0.0.1:%s\n' "$redis_port" >> "$connection_file"
fi
printf 'R16BENCH_RUN_ID=%s\n' "$run_id" >> "$connection_file"
chmod 600 "$secrets_file" "$connection_file"
echo "Isolated loopback R16 lab is ready: ${services[*]}"
echo "Private connection variables: $connection_file"
echo "Stop only this lab with: R16BENCH_RUN_ID=$run_id scripts/r16/lab-down.sh"
