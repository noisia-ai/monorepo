const identifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u;

/** Return only allowlisted PostgreSQL metadata; never expose server text or SQL. */
export function safePgDiagnostics(error) {
  const diagnostics = {};
  if (/^[A-Z0-9]{5}$/u.test(error?.code ?? '')) diagnostics.sqlstate = error.code;
  for (const field of ['schema', 'table', 'routine']) {
    if (identifier.test(error?.[field] ?? '')) diagnostics[`pg_${field}`] = error[field];
  }
  for (const [field, value] of [['position', error?.position], ['internal_position', error?.internalPosition]]) {
    if (/^[1-9]\d{0,8}$/u.test(String(value ?? ''))) diagnostics[`pg_${field}`] = Number(value);
  }
  if (!diagnostics.pg_table && diagnostics.sqlstate === '42P01') {
    const message = String(error?.message ?? '');
    const missing = message.match(/relation "([a-zA-Z_][a-zA-Z0-9_]{0,62})" does not exist/u)
      ?? message.match(/missing FROM-clause entry for table "([a-zA-Z_][a-zA-Z0-9_]{0,62})"/u);
    if (missing) diagnostics.pg_table = missing[1];
  }
  const context = String(error?.where ?? '').match(/PL\/pgSQL function ([a-zA-Z_][a-zA-Z0-9_]{0,62})\([^\n]{0,200}\) line ([1-9]\d{0,5}) at (SQL statement|assignment|IF|RETURN)/u);
  if (context) diagnostics.pg_context = { function: context[1], line: Number(context[2]), operation: context[3] };
  if (/^[a-zA-Z0-9_]{1,128}$/u.test(error?.constraint ?? '')) diagnostics.sql_constraint = error.constraint;
  return diagnostics;
}
