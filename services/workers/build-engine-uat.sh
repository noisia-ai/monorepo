#!/bin/sh
set -eu

python -m venv /app/.uat-engine
/app/.uat-engine/bin/python -m pip install --no-cache-dir --no-deps --only-binary=:all: \
  -r services/workers/requirements-workspace-engine.txt
/app/.uat-engine/bin/python -c 'from bertopic import BERTopic; from umap import UMAP; from hdbscan import HDBSCAN; import psutil'
pnpm --filter @noisia/workers build
