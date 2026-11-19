export type StatementDefaultKindV1 = 'B' | 'C' | 'D' | 'E';
export type StatementDefaultCliKindV1 = StatementDefaultKindV1 | 'current';
export const CURRENT_KIND: 'E';
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
export type StatementDefaultTapSummaryV1<K extends StatementDefaultKindV1 = StatementDefaultKindV1> = {
  runtime_kind: K;
  receipt_count: K extends 'D' | 'E' ? 14 : 12;
  receipt_ids: string[];
};
export function parseStatementDefaultTapV1(tap: string, expectedKind?: 'C'): StatementDefaultTapSummaryV1<'C'>;
export function parseStatementDefaultTapV1(tap: string, expectedKind: 'B'): StatementDefaultTapSummaryV1<'B'>;
export function parseStatementDefaultTapV1(tap: string, expectedKind: 'D'): StatementDefaultTapSummaryV1<'D'>;
export function parseStatementDefaultTapV1(tap: string, expectedKind: 'E'): StatementDefaultTapSummaryV1<'E'>;
export function parseStatementDefaultTapV1(tap: string, expectedKind: StatementDefaultKindV1): StatementDefaultTapSummaryV1;
export function resolveStatementDefaultCliKindV1(kind: 'current'): 'E';
export function resolveStatementDefaultCliKindV1<K extends StatementDefaultKindV1>(kind: K): K;
export function resolveStatementDefaultCliKindV1(kind: unknown): StatementDefaultKindV1;
export function verifyStatementDefaultCliV1(args: readonly string[], readTap: (path: string) => string): StatementDefaultTapSummaryV1;
