"""Native H5 projection fixtures; preserve original probability and decision IDs."""
import copy
import json
import hashlib
import uuid

import pytest

from signal_semantic_lab.workspace_engine import _cached_source_rows, _orphan_evaluation_is_false, WorkspaceEngineError


@pytest.mark.parametrize("probability,human,expected", [
    (.9, False, True), (None, False, True), (.1, False, True),
    (.1, True, False), (None, True, False), (1, True, False),
    (.1, None, True), (.7, None, False), (.9, None, False), (None, None, False),
    (True, None, False), (False, None, False), (float("nan"), False, False),
    (float("inf"), False, False), (-.1, False, False), (1.1, False, False),
])
def test_effective_orphan_projection_does_not_overwrite_raw(probability, human, expected):
    item = {"question_key": "topic", "question_digest": "sha256:" + "a" * 64,
            "probability": probability, "call_id": str(uuid.uuid4()), "manual_id": None,
            "human_decision_id": str(uuid.uuid4()) if isinstance(human, bool) else None,
            "human_belongs": human, "human_decision_kind": "human_edit" if isinstance(human, bool) else None}
    original = copy.deepcopy(item)
    assert _orphan_evaluation_is_false(item) is expected
    # NaN is not equal to itself; equality of the serialized projection still
    # proves that neither probability nor its native provenance was normalized.
    assert json.dumps(item, sort_keys=True) == json.dumps(original, sort_keys=True)


@pytest.mark.parametrize("item", [
    {"probability": .1, "human_belongs": "false", "human_decision_id": str(uuid.uuid4())},
    {"probability": None, "human_belongs": False, "human_decision_id": None},
    {"probability": .1, "human_belongs": None, "human_decision_id": str(uuid.uuid4())},
])
def test_invalid_or_unresolved_human_projection_is_not_an_orphan(item):
    try:
        assert _orphan_evaluation_is_false(item) is False
    except WorkspaceEngineError:
        pass  # Missing/invalid native decision identity fails closed.


def test_cached_orphan_reader_accepts_human_false_with_original_high_or_null_raw(tmp_path):
    sha = lambda raw: "sha256:" + hashlib.sha256(raw.encode()).hexdigest()
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    workspace, generation, subset = [str(uuid.uuid4()) for _ in range(3)]
    roots = sorted([str(uuid.uuid4()), str(uuid.uuid4())])
    vector = json.dumps([1] + [0] * 1023, separators=(",", ":"))
    rows = []
    for root, probability in zip(roots, [.9, None]):
        proof = {"in_category": True, "source_text_sha256": sha("fragment"), "chunk_sha256": sha("fragment"),
                 "embedding_call_id": str(uuid.uuid4()), "embedding_sha256": sha(vector),
                 "evaluations": [{"question_key": "topic", "question_digest": sha("topic"), "probability": probability,
                                  "call_id": str(uuid.uuid4()), "manual_id": None, "human_belongs": False,
                                  "human_decision_id": str(uuid.uuid4()), "human_decision_kind": "human_edit"}]}
        proof_json = canonical(proof)
        rows.append({"root_id": root, "proof_json": proof_json, "proof_digest": sha(proof_json), "vector_json": vector})
    raw = "".join(json.dumps(row) + "\n" for row in rows)
    (tmp_path / "source-proofs.jsonl").write_text(raw)
    source = {"kind": "sealed-listening-orphan-subset-v1", "generation_id": generation, "generation_digest": sha("generation"),
              "subset_id": subset, "subset_digest": sha(canonical({"generation_id": generation, "roots": [[r["root_id"], r["proof_digest"]] for r in rows], "workspace_id": workspace})),
              "root_count": 2, "cached_count": 2, "proofs": {"file": "source-proofs.jsonl", "rows": 2, "sha256": sha(raw)}}
    manifest = {"workspace_id": workspace, "guides": {"rows": 0}, "records": {"roots": 2}, "cached_vector_source": source}
    decoded = list(_cached_source_rows(tmp_path, manifest))
    assert [proof["evaluations"][0]["probability"] for _, proof, _ in decoded] == [.9, None]
    assert (tmp_path / "source-proofs.jsonl").read_text() == raw
