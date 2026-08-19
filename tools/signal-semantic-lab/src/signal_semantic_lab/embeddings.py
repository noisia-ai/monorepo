from __future__ import annotations

import gc
import hashlib
import os
from pathlib import Path
from typing import Any

import numpy as np

from .canonical import sha256_file
from .preprocess import normalize_text


def encode_records(
    texts: list[str],
    config: dict[str, Any],
    output_path: Path,
    *,
    benchmark_identity: str,
    batch_size: int = 32,
) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    backend = "onnx" if config["key"] == "bge-m3" else "torch"
    allow_patterns = [
        "*.json",
        "*.txt",
        "*.model",
        "modules.json",
        "1_Pooling/config.json",
    ]
    allow_patterns.append("onnx/model.onnx*") if backend == "onnx" else allow_patterns.append(
        "model.safetensors"
    )
    snapshot_path = Path(
        snapshot_download(
            repo_id=config["repository"],
            revision=config["revision"],
            allow_patterns=allow_patterns,
        )
    )
    verified_artifacts = []
    for artifact in config["artifact_files"]:
        artifact_path = snapshot_path / artifact["path"]
        if not artifact_path.is_file():
            raise ValueError(f"benchmark_model_artifact_missing:{config['key']}:{artifact['path']}")
        digest = _plain_sha256(artifact_path)
        size = artifact_path.stat().st_size
        if digest != artifact["sha256"] or size != int(artifact["bytes"]):
            raise ValueError(
                f"benchmark_model_artifact_mismatch:{config['key']}:{artifact['path']}"
            )
        verified_artifacts.append({"path": artifact["path"], "sha256": digest, "bytes": size})
    prepared = [f"{config.get('query_prefix', '')}{normalize_text(text)}" for text in texts]
    effective_batch_size = int(config.get("runtime_batch_size", batch_size))
    batch_order = str(config.get("runtime_batch_order", "input-order-v1"))
    if backend == "onnx":
        embeddings = _encode_onnx_sentence_embeddings(
            snapshot_path,
            prepared,
            batch_size=effective_batch_size,
            batch_order=batch_order,
            max_sequence_length=int(config["max_sequence_length"]),
            execution_provider=str(config["onnx_execution_provider"]),
        )
        model = None
    else:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(
            str(snapshot_path),
            trust_remote_code=False,
            model_kwargs={"trust_remote_code": False, "local_files_only": False},
            device="cpu",
        )
        model.max_seq_length = int(config["max_sequence_length"])
        embeddings = model.encode(
            prepared,
            batch_size=effective_batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        ).astype(np.float32, copy=False)
    expected_shape = (len(texts), int(config["dimension"]))
    if embeddings.ndim != 2 or embeddings.shape != expected_shape:
        raise ValueError(f"benchmark_embedding_shape_invalid:{config['key']}:{embeddings.shape}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(output_path, embeddings, allow_pickle=False)
    os.chmod(output_path, 0o600)
    digest = sha256_file(output_path)
    del embeddings, model
    gc.collect()
    return {
        "embedding_key": config["key"],
        "repository": config["repository"],
        "revision": config["revision"],
        "backend": backend,
        "execution_provider": (
            config["onnx_execution_provider"] if backend == "onnx" else "PyTorchCPU"
        ),
        "dimension": int(config["dimension"]),
        "record_count": len(texts),
        "benchmark_identity": benchmark_identity,
        "runtime_batch_size": effective_batch_size,
        "runtime_batch_order": batch_order,
        "output_path": str(output_path.resolve()),
        "output_sha256": digest,
        "verified_artifacts": verified_artifacts,
    }


def load_embeddings(path: Path) -> np.ndarray:
    return np.load(path, mmap_mode="r", allow_pickle=False)


def _plain_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _encode_onnx_sentence_embeddings(
    snapshot_path: Path,
    texts: list[str],
    *,
    batch_size: int,
    batch_order: str,
    max_sequence_length: int,
    execution_provider: str,
) -> np.ndarray:
    """Run the pinned BGE-M3 sentence-embedding graph without remote model code.

    BGE-M3's published ONNX graph exposes ``sentence_embedding`` directly. Optimum's
    generic transformer wrapper expects ``last_hidden_state`` and therefore cannot be
    used for this immutable graph. Keeping this adapter explicit also prevents an
    accidental export or floating model conversion during a benchmark run.
    """
    import onnxruntime as ort
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        str(snapshot_path),
        local_files_only=True,
        trust_remote_code=False,
    )
    if execution_provider not in ort.get_available_providers():
        raise ValueError(f"benchmark_onnx_execution_provider_unavailable:{execution_provider}")
    providers = [execution_provider]
    if execution_provider != "CPUExecutionProvider":
        providers.append("CPUExecutionProvider")
    session = ort.InferenceSession(
        str(snapshot_path / "onnx/model.onnx"),
        providers=providers,
    )
    output_names = {output.name for output in session.get_outputs()}
    if "sentence_embedding" not in output_names:
        raise ValueError("benchmark_bge_sentence_embedding_output_missing")
    ordered_indexes = _embedding_batch_indexes(texts, batch_size, batch_order)
    output: np.ndarray | None = None
    for indexes in ordered_indexes:
        encoded = tokenizer(
            [texts[index] for index in indexes],
            padding=True,
            truncation=True,
            max_length=max_sequence_length,
            return_tensors="np",
        )
        inputs = {
            "input_ids": encoded["input_ids"].astype(np.int64, copy=False),
            "attention_mask": encoded["attention_mask"].astype(np.int64, copy=False),
        }
        sentence_embeddings = session.run(["sentence_embedding"], inputs)[0].astype(
            np.float32,
            copy=False,
        )
        norms = np.linalg.norm(sentence_embeddings, axis=1, keepdims=True)
        normalized = sentence_embeddings / np.maximum(norms, np.finfo(np.float32).eps)
        if output is None:
            output = np.empty((len(texts), normalized.shape[1]), dtype=np.float32)
        output[indexes] = normalized
    return output if output is not None else np.empty((0, 1024), dtype=np.float32)


def _embedding_batch_indexes(
    texts: list[str], batch_size: int, batch_order: str
) -> list[list[int]]:
    if batch_size < 1:
        raise ValueError("benchmark_embedding_batch_size_invalid")
    if batch_order == "input-order-v1":
        order = list(range(len(texts)))
    elif batch_order == "normalized-character-length-ascending-stable-v1":
        order = sorted(range(len(texts)), key=lambda index: (len(texts[index]), index))
    else:
        raise ValueError("benchmark_embedding_batch_order_invalid")
    return [order[offset : offset + batch_size] for offset in range(0, len(order), batch_size)]
