# R16 Listening capacity, preregistration V2

This contract applies only to new full measurements after its source is frozen.
V1, its artifacts and all rejected historical verdicts remain unchanged. An
independent read-only review identified that V1 counted read-only verification
after native work had drained as additional production windows without demand.

The workload, configuration, policy, model, 32,768 DISTINCT roots, two native
passes, ten faults, quotas, actual observed 100–500 ms HTTP latency, native census,
durable Storage, PostgreSQL, Redis and serving requirements remain those in
`LISTENING_CAPACITY_PREREGISTRATION.md`. No provider is contacted. The source tree
and this contract must be frozen and written before fixture setup and any send.

Two independent speed gates are mandatory:

1. End-to-end rate is at least 1,000 fully resolved DISTINCT roots/s. Its clock
   starts immediately before native preparation/admission and ends after the
   final exact census reconciliation and every question's native serving read.
   No admission, warmup, second pass, drain, census or metrics time is subtracted.
2. Every complete fixed one-second window from 5,000 ms until native processing
   and drain finish contains at least 1,000 fully resolved DISTINCT roots. That
   active interval after 5,000 ms must last at least 20,000 ms. Any pause while
   native work remains belongs to those same fixed windows. A faster shorter run
   does not prove sustained capacity. There are no selected windows or sleeps.

Active time closes after the complete job promise, including its cleanup, and
an authorized native status read proving the same run is completed with zero
reserved and unknown exposure. Every expected root must already have been
observed by the native all-eligible-questions census after durable page apply.
This boundary is not the last HTTP response. Commit observations outside it
invalidate the witness. The later full census must find no previously unobserved
root; serving must contain exactly every configured question, with matching
configuration, zero pending/awaiting-base and actual distribution/trend/cross.

Record both active elapsed time and the full verification tail. Keep all fixed
wall-clock windows, including their zero counts, as diagnostics. The tail still
affects the end-to-end speed gate and census/serving remain acceptance gates.
Generic `readSignalListeningQuestionsMetricsV1` may share the population for all
questions in one native statement; its singular product reader uses the same
implementation. No benchmark-only projection or cached authorization is allowed.

The preregistration digest, measurement and summary explicitly identify V2. Old
measurements cannot be reclassified with this contract. Acceptance requires a
new quiet-lab full run and same-source fault matrix, followed by the separate
real-provider measurement under the actual shared organization quota.
