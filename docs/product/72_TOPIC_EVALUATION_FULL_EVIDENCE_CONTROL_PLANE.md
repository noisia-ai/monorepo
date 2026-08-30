# Topic Evaluation full-evidence control plane V2

Status: local contract, provider execution disabled. This document does not authorize a run,
deployment, migration application, Topic adoption, publication or serving.

## Product boundary

The historical `signal-topic-evaluation-v1` evaluator remains the summary-only comparison
baseline. V2 is a separate internal evidence investigator over precomputed BERTopic clusters. It
does not recluster, edit the corpus, change Brand OS, create a Topic Contract, adopt a Topic, or
write serving state.

The frozen population is reconstructed only by the registered local importer. It verifies the
private source-export and manifest, the exact `bertopic-bge-detail.seed-17.assignments.npz`, the
matching result and blind-review packet, their mode `0600`, hashes, algorithm and seed. It then
uses the retained private export pseudonym key to recompute `HMAC(root:<canonical mention id>)`
for current workspace-owned canonical roots. Every one of the 21,195 export record keys must map
one-to-one, with matching normalized content hash, alias count, language, country, platform and
month. A missing, duplicate, cross-workspace or mismatched row aborts with aggregate counts only;
there is no synthetic or caller-supplied fallback.

The reference seed contains 115 assigned clusters plus one explicit, non-proposal
`outlier-reservoir` for the 10,009 unassigned roots. All 21,195 modelable roots therefore receive
one immutable server-owned membership reference. Each row seals its export index, integer label,
available strength, source-record key/digest, canonical text hash and a composite canonical binding
digest; the deferred snapshot cohort recomputes the ordered membership-binding digest. Cluster
content digests are recomputed from the actual assigned export records and must equal the packet's
115 cluster identities, so swapping assignment indices cannot preserve authority. Outliers are not
pretended to belong to an assigned cluster.
The membership table stores mention IDs, strata and opaque digests, never copied mention text.
Text is joined from the workspace-owned `mentions` table only while satisfying one bounded
navigation request, then deterministically sanitized.

The population contract is exact: assignment digest
`sha256:59b7e6833192fd6bcae1291b9cc42dc11d98cb22c31587e1acedc67d0587a8c3`,
source-export digest
`sha256:3cf49523ebe80a0044eaac6f03de47c787f62e5908a696519d54288de6c4afd9`,
11,186 assigned roots, 10,009 outliers and 21,195 memberships total. The importer binds both
manifests without conflating them: the private model source-export manifest
`sha256:4244d4227087f28c93ca72946205b9e40cd69c3edd5df118599b1e233d868720` and the registered
10C.2C packet-source evidence manifest
`sha256:9300ea7a0e50870bf2b4dffe58e3e186628b2577692dccf27f5137177bdaed8b`. The latter inventories
the former and the exact final model artifacts; it is the digest registered on the review packet.
The importer must also bind the current database-owned 115-proposal packet, rights and Semantic Context authority digests;
matching file counts without those authorities is insufficient.

## Closed navigation

The management-only contract supports exactly:

- cluster catalog and one-cluster profile;
- up to 24 deterministic representative mentions from one cluster;
- cursor-paginated in-cluster search, at most 20 rows, with closed language, market, scope, month
  and plain-text query filters;
- comparison of two to five validated clusters;
- up to 40 current approved Brand OS/Semantic Context elements.

It is not generic SQL or a corpus API. The server chooses membership, ordering, paging and result
fields. Cursors are bound to snapshot rights, operation and filters. Workspace, cluster and current
authority are checked on every request. The result contains sanitized excerpts, coarse source
attributes and opaque SHA-256 references; it excludes raw IDs, authors, URLs, provider payloads,
prompts, credentials and internal errors.

Representative selection is stable round-robin across the observed central/edge/minority strata,
then diversifies by language, market, scope and month. Every observed central/edge/minority stratum
appears when the requested limit is at least the number of observed strata. It cannot guarantee
every cross-product of the secondary dimensions, infer missing market/scope metadata, or prove
statistical representativeness.

## Flight card and provenance

V2 is disabled by default and exposes no launch edge in this gate. The maximum future flight card
is 12 model turns, 24 navigation calls, 32,768 bytes per tool result, 262,144 tool-result bytes in
total, 450,000 input tokens, 50,000 output tokens and USD 20.00 absolute cost. Action-time
confirmation and fresh idempotency are mandatory. Automatic retry and fallback are forbidden.

The append-only trace records each tool input/result digest and evidence reference, each model
turn, every pending candidate and its explanation/evidence lineage, plus a separate ranked Top 10.
The complete candidate pool remains durable and editable; Top 10 is a view, not truncation.
Candidate tables carry closed false adoption/publication/serving fields.

Any future provider adapter, queue registration, data population or enabled flight requires a
separate audited gate after migration and API review. Discovery Review remains a separate product
surface.
