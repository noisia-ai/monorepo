#!/bin/sh
set -eu

export NOISIA_WORKSPACE_ENGINE_PYTHON=/app/.uat-engine/bin/python
export NOISIA_WORKSPACE_ENGINE_MODULE_ROOT=/app/tools/signal-semantic-lab/src
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONUNBUFFERED=1
export NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export PYTHONPATH="$NOISIA_WORKSPACE_ENGINE_MODULE_ROOT"
"$NOISIA_WORKSPACE_ENGINE_PYTHON" -c 'from signal_semantic_lab import workspace_engine; from bertopic import BERTopic'
exec pnpm --filter @noisia/workers start
