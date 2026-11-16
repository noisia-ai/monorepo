export type StatementDefaultKindV1 = 'B' | 'C';
export type StatementDefaultRuntimeReceiptV1 = {
  contract: 'r16-statement-shared-wire-default-runtime-v1';
  target: 'public.signal_listening_statement_money_v1()';
  runtime_kind: StatementDefaultKindV1;
  observed_via: 'pg_proc';
  default_arm: StatementDefaultKindV1;
  migration: string;
  source_sha256: string;
  prosrc_sha256: string;
  actual_prosrc_sha256: string;
  metadata: Record<string, unknown>;
  actual_pg_proc_checked: true;
  phase: 'before' | 'after';
  receipt_id?: string;
  fixture_ordinal?: number;
};
export function validateDefaultRuntimeV1(receipt: unknown, expectedKind: StatementDefaultKindV1): asserts receipt is StatementDefaultRuntimeReceiptV1;
export function validateDefaultRuntimePairV1(before: StatementDefaultRuntimeReceiptV1, after: StatementDefaultRuntimeReceiptV1,
  expectedKind?: StatementDefaultKindV1): {runtime_kind: StatementDefaultKindV1; before_after_equal: true};
export function parseStatementDefaultTapV1(tap: string, expectedKind?: StatementDefaultKindV1): {
  runtime_kind: StatementDefaultKindV1;
  receipt_count: 12;
  receipt_ids: string[];
};
