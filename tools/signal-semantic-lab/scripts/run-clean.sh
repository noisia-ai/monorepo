#!/bin/sh
set -eu

LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$LAB_DIR"

: "${UV_BIN:=uv}"
export HF_HUB_DISABLE_TELEMETRY=1
export TOKENIZERS_PARALLELISM=false

"$UV_BIN" sync --frozen --extra dev
exec "$UV_BIN" run signal-semantic-lab "$@"
