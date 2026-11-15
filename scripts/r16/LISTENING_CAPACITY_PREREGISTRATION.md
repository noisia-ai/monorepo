# R16 Listening capacity, preregistration V1

This benchmark is separate from the failed MassV2 run C676 (440.69 roots/s).
The source commit/tree, configuration, policy, root census, model and this contract
must be frozen before starting either arm. No provider network or paid stage is allowed.

The primary arm contains 32,768 synthetic corpus roots and the exact published
Brand OS configuration: voice, promotion, and two versioned defined NOUL topics (Brand OS, human locked) with
consumer_category scope. A second native pass resolves the defined questions only
after the original base answers establish eligibility. A separate optional arm adds
four discovered topic questions through their native owner/prototypes. That arm is
unsupported until native admission resolves it; absence is reported, never fabricated.
Neither arm inserts a measured token profile. The first ordinary pending requests
(maximum 32 per uncovered shape, byte extrema retained) use the official conservative
65,536-token reservation. Only settled, verified and applied receipts derive coverage.

The numerator is DISTINCT roots fully resolved for every eligible question in the
frozen configuration. It is never the number of HTTP calls: the second pass can make
HTTP requests exceed corpus roots. Excluded questions must have native scope evidence.
The denominator begins immediately BEFORE prepareSignalListeningV1 and includes native admission, the initial census, every warmup,
restart, second pass, final census reconciliation and serving reads. Cold time additionally includes fixture setup and is reported.
All complete 1-second windows after the fixed first 5 seconds must exceed 1,000 roots/s,
with at least 20 seconds measured, and wall throughput must also exceed 1,000 roots/s.
Actual observed HTTP latency, including scheduling, must remain 100–500ms.

The primary synthetic population is fully eligible, so two ordinary HTTP calls
per resolved root are expected (base then both defined topics together), exactly
65,536 calls for 32,768 roots absent faults. Report the observed ratio separately.
The simulator alone uses 10,000 RPS and 10,000,000 input TPS in the shared organization
Redis account. These are code-capacity test limits, not a claim about purchased
provider capacity, and no real provider quota is changed. A 2,000 RPS simulator
would impose a 1,000 roots/s ceiling before warmup/drain and cannot test this wall gate.

Local preflight requires explicit Listening/JEV/streaming flags and the exact frozen
configuration/model. Storage uses its real assertReady private-bucket HTTP check.
Only the synthetic JEV fetch exists here; no real provider/models endpoint is contacted.
Native DB authorization, rights, admissions and cap checks remain inside the job.

Use signalListeningJevJobV1, createSignalListeningRuntimeStoreV1 and the calibrated
provider factory with the real shared-organization Redis limiter. Use native PG,
HTTP filesystem Storage fsync/readback and page settlement. Preserve memory, token,
RPS, lease, rights, policy, caps and no-replay gates. The native page-parallel opt-in
is owned by the orchestrator; this harness does not change it.

The ten explicit faults are: 429, 529, raw-page write, PG commit, settlement ACK loss,
restart after page, lease expiry, lease expiry after durable write, Storage put ACK loss and COMMIT ACK loss. The original write/COMMIT cases now require actual pre-write rejection/precommit rollback; ACK losses are additional cases. Their artifact
must bind this exact source/policy/system identifier and Listening identity. Legacy
Mass fault artifacts are regression evidence, not acceptance for this arm.

Serving uses readSignalListeningQuestionMetricsV1 for every question and checks
pending/awaiting_base zero, distribution, trend and nonempty topic cross.
Native census must reconcile eligible/excluded/pending question digests and fully
resolved DISTINCT roots with original root IDs. No synthetic projection substitutes
for native serving or proves native admission. Until an approved R16 native fixture,
fault pack and full quiet-lab run exist, the implementation is a checkpoint, not acceptance.
