# ADR 028 — Confirmed provider termination with an unsettled charge

Status: accepted; implementation and UAT validation in progress.

## Context

A workspace interpretation request lost its connection before receiving HTTP
headers or a body. The provider Console later reported a terminal client
disconnect and token usage. This confirms a transport outcome but neither
recovers a model answer nor establishes a final invoice charge. Reclassifying it
as definitely not sent, fabricating an API response, or releasing its entire
reservation would erase material evidence.

## Decision

Extend the existing interpretation ledger with `terminal_confirmed`. Preserve
the request, its configuration and digests, the full reservation, and the actual
absence of response bytes. The settled amount remains null. Store an immutable
external provider observation, its private evidence reference and digest, and
the administrative verifier. A Console observation is explicitly distinct from
a response received through Messages API.

An authenticated administrative operation records the terminal observation.
Ordinary product clients cannot supply or override provider evidence. Recording
the observation does not enqueue work or authorize another send.

The existing resume action may admit one transport successor for the same
logical request, with its own reservation and attempt identity. Request body,
configuration, editorial repair identity, actor and computation bundle remain
unchanged. The original reserved charge and the successor's exposure both count
toward existing caps. Inputs, rights and execution lease are revalidated. A
second uncertain attempt is not an automatic retry chain, and a transport
successor does not constitute another editorial repair.

The server returns recovery eligibility. The UI explains that the previous
charge remains under reconciliation and reuses the existing resume action.
There is no new rubric, normal onboarding requirement or public endpoint that
accepts a fabricated provider termination.

An optional Worker admission deadline enforces a dated operational spending
grant. It is checked before and after the send CAS; an ambiguous CAS remains
unknown. It rejects new sends at expiry without interrupting requests already
sent or discarding their receipts. It does not change the sealed provider body.

## Consequences

This recovers a narrowly evidenced transport failure while retaining financial
uncertainty. Full computation is reused, and only a validated response from a
properly authorized successor can contribute interpretations or Topics.

An operational reconciliation still requires provider evidence. Recoverable
provider jobs and durable streaming receipts remain necessary improvements for
self-service operation. A terminal observation is not a semantic result,
invoice settlement, or proof that Signal is complete. Invoice reconciliation
and publication of usable batches with explicit editorial exceptions remain
separate work.

The UAT execution receipt is maintained in
`docs/product/PROMPT_LOOPING/RECOVERY_PROVIDER_TERMINAL_RECEIPT_2026-09-09.md`.
