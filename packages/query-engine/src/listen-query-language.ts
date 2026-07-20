export const PORTABLE_LISTEN_QUERY_DIALECT_VERSION = "portable-listen-v2";
export const PORTABLE_LISTEN_QUERY_MAX_LENGTH = 12_000;

export type PortableListenQueryIssueCode =
  | "empty_query"
  | "query_too_long"
  | "unterminated_phrase"
  | "unexpected_token"
  | "missing_operand"
  | "missing_operator"
  | "unbalanced_parenthesis"
  | "empty_group"
  | "advanced_operator_not_allowed"
  | "phrase_wildcard_not_allowed"
  | "invalid_phrase_proximity"
  | "invalid_star_wildcard"
  | "invalid_question_wildcard"
  | "negative_only_query"
  | "duplicate_term"
  | "query_too_broad";

export type PortableListenQueryIssue = {
  code: PortableListenQueryIssueCode;
  severity: "error" | "warning";
  message: string;
  token?: string;
  position?: number;
};

export type PortableListenQueryValidation = {
  valid: boolean;
  dialect_version: typeof PORTABLE_LISTEN_QUERY_DIALECT_VERSION;
  normalized_query: string;
  errors: PortableListenQueryIssue[];
  warnings: PortableListenQueryIssue[];
  stats: {
    length: number;
    terms: number;
    positive_terms: number;
    negative_terms: number;
    phrases: number;
    proximity_operators: number;
    wildcards: number;
    max_group_depth: number;
  };
};

type TokenKind = "LPAREN" | "RPAREN" | "AND" | "OR" | "NOT" | "TERM" | "PHRASE";
type Token = {
  kind: TokenKind;
  value: string;
  position: number;
  proximity?: number;
};

type ParseStats = {
  positiveTerms: number;
  negativeTerms: number;
  maxDepth: number;
};

/**
 * Validates the provider-portable subset of Listen Query Language used by Noisia.
 * This compiler owns grammar only. Query Construction validates semantic anchors,
 * ambiguity, exclusions and methodology-specific capture mode before delivery.
 */
export function validatePortableListenQuery(
  input: string,
  options: { maxLength?: number } = {}
): PortableListenQueryValidation {
  const maxLength = options.maxLength ?? PORTABLE_LISTEN_QUERY_MAX_LENGTH;
  const errors: PortableListenQueryIssue[] = [];
  const warnings: PortableListenQueryIssue[] = [];
  const raw = input.trim();

  if (!raw) {
    errors.push(issue("empty_query", "error", "La query no puede estar vacía."));
  }
  if (raw.length > maxLength) {
    errors.push(issue(
      "query_too_long",
      "error",
      `La query excede el máximo portable de ${maxLength} caracteres (${raw.length}).`
    ));
  }

  const tokens = tokenize(raw, errors);
  validateTokenContracts(tokens, errors, warnings);
  const parseStats = parse(tokens, errors);
  const normalized = normalizeTokens(tokens, raw);

  if (tokens.length > 0 && parseStats.positiveTerms === 0) {
    errors.push(issue(
      "negative_only_query",
      "error",
      "La query necesita al menos un término de inclusión; no puede contener solo exclusiones."
    ));
  }

  const termTokens = tokens.filter((token) => token.kind === "TERM" || token.kind === "PHRASE");
  if (termTokens.length > 180) {
    warnings.push(issue(
      "query_too_broad",
      "warning",
      `La query contiene ${termTokens.length} términos; conviene dividirla o priorizar semillas.`
    ));
  }

  return {
    valid: errors.length === 0,
    dialect_version: PORTABLE_LISTEN_QUERY_DIALECT_VERSION,
    normalized_query: normalized,
    errors,
    warnings,
    stats: {
      length: normalized.length,
      terms: termTokens.length,
      positive_terms: parseStats.positiveTerms,
      negative_terms: parseStats.negativeTerms,
      phrases: tokens.filter((token) => token.kind === "PHRASE").length,
      proximity_operators: tokens.filter((token) => token.proximity !== undefined).length,
      wildcards: termTokens.filter((token) => /[?*]/.test(token.value)).length,
      max_group_depth: parseStats.maxDepth
    }
  };
}

export function summarizePortableListenQueryErrors(validation: PortableListenQueryValidation): string {
  return validation.errors.map((item) => item.message).join(" ");
}

function tokenize(raw: string, errors: PortableListenQueryIssue[]): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const char = raw[cursor] ?? "";
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "LPAREN", value: char, position: cursor });
      cursor += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "RPAREN", value: char, position: cursor });
      cursor += 1;
      continue;
    }
    if (char === '"') {
      const start = cursor;
      cursor += 1;
      let value = "";
      let closed = false;
      while (cursor < raw.length) {
        const current = raw[cursor] ?? "";
        if (current === '"' && raw[cursor - 1] !== "\\") {
          closed = true;
          cursor += 1;
          break;
        }
        value += current;
        cursor += 1;
      }
      if (!closed) {
        errors.push(issue("unterminated_phrase", "error", "Hay una frase sin comillas de cierre.", value, start));
      }
      let proximity: number | undefined;
      if (closed && raw[cursor] === "~") {
        const proximityStart = cursor;
        cursor += 1;
        const digitsStart = cursor;
        while (cursor < raw.length && /\d/u.test(raw[cursor] ?? "")) cursor += 1;
        const digits = raw.slice(digitsStart, cursor);
        if (!digits) {
          errors.push(issue(
            "invalid_phrase_proximity",
            "error",
            "El operador de proximidad necesita una distancia numérica, por ejemplo \"frase\"~6.",
            raw.slice(proximityStart, cursor),
            proximityStart
          ));
        } else {
          proximity = Number(digits);
        }
      }
      tokens.push({ kind: "PHRASE", value, position: start, ...(proximity !== undefined ? { proximity } : {}) });
      continue;
    }

    const start = cursor;
    while (cursor < raw.length && !/[\s()]/u.test(raw[cursor] ?? "")) cursor += 1;
    const value = raw.slice(start, cursor);
    const operator = value.toUpperCase();
    const kind: TokenKind = operator === "AND" || operator === "OR" || operator === "NOT"
      ? operator
      : "TERM";
    tokens.push({ kind, value: kind === "TERM" ? value : operator, position: start });
  }

  return tokens;
}

function validateTokenContracts(
  tokens: Token[],
  errors: PortableListenQueryIssue[],
  warnings: PortableListenQueryIssue[]
) {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "TERM" && token.kind !== "PHRASE") continue;
    const normalized = token.value.trim().toLocaleLowerCase("es-MX");
    if (seen.has(normalized)) {
      warnings.push(issue("duplicate_term", "warning", `El término '${token.value}' está duplicado.`, token.value, token.position));
    }
    seen.add(normalized);

    if (token.kind === "PHRASE" && /[?*]/.test(token.value)) {
      errors.push(issue(
        "phrase_wildcard_not_allowed",
        "error",
        "No combines comillas de frase exacta con comodines.",
        token.value,
        token.position
      ));
      continue;
    }

    if (token.kind === "PHRASE" && token.proximity !== undefined
      && (!Number.isInteger(token.proximity) || token.proximity < 1 || token.proximity > 100)) {
      errors.push(issue(
        "invalid_phrase_proximity",
        "error",
        "La proximidad de frase debe ser un entero entre 1 y 100.",
        `\"${token.value}\"~${token.proximity}`,
        token.position
      ));
    }

    if (token.kind === "TERM" && isAdvancedOperator(token.value)) {
      errors.push(issue(
        "advanced_operator_not_allowed",
        "error",
        `El operador avanzado '${token.value}' no pertenece al dialecto portable.`,
        token.value,
        token.position
      ));
    }

    if (token.kind === "TERM" && token.value.includes("*")) {
      const stars = [...token.value].filter((char) => char === "*").length;
      const prefix = token.value.slice(0, -1);
      if (stars !== 1 || !token.value.endsWith("*") || prefix.length < 4) {
        errors.push(issue(
          "invalid_star_wildcard",
          "error",
          "El comodín * solo puede aparecer al final y necesita al menos cuatro caracteres antes.",
          token.value,
          token.position
        ));
      }
    }

    if (token.kind === "TERM" && token.value.includes("?") && token.value.startsWith("?")) {
      errors.push(issue(
        "invalid_question_wildcard",
        "error",
        "El comodín ? solo puede aparecer en medio o al final de un término.",
        token.value,
        token.position
      ));
    }
  }
}

function parse(tokens: Token[], errors: PortableListenQueryIssue[]): ParseStats {
  let cursor = 0;
  let maxDepth = 0;
  let positiveTerms = 0;
  let negativeTerms = 0;

  const current = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  const parseExpression = (depth: number, negated: boolean): boolean => {
    let hasOperand = parseAnd(depth, negated);
    while (current()?.kind === "OR") {
      const operator = consume();
      const right = parseAnd(depth, negated);
      if (!right) errors.push(issue("missing_operand", "error", "OR necesita una expresión a la derecha.", operator?.value, operator?.position));
      hasOperand = hasOperand || right;
    }
    return hasOperand;
  };

  const parseAnd = (depth: number, negated: boolean): boolean => {
    let hasOperand = parseUnary(depth, negated);
    while (current()?.kind === "AND") {
      const operator = consume();
      const right = parseUnary(depth, negated);
      if (!right) errors.push(issue("missing_operand", "error", "AND necesita una expresión a la derecha.", operator?.value, operator?.position));
      hasOperand = hasOperand || right;
    }
    return hasOperand;
  };

  const parseUnary = (depth: number, negated: boolean): boolean => {
    if (current()?.kind === "NOT") {
      consume();
      return parseUnary(depth, !negated);
    }
    return parsePrimary(depth, negated);
  };

  const parsePrimary = (depth: number, negated: boolean): boolean => {
    const token = current();
    if (!token) return false;
    if (token.kind === "TERM" || token.kind === "PHRASE") {
      consume();
      if (negated) negativeTerms += 1;
      else positiveTerms += 1;
      return true;
    }
    if (token.kind === "LPAREN") {
      consume();
      maxDepth = Math.max(maxDepth, depth + 1);
      if (current()?.kind === "RPAREN") {
        errors.push(issue("empty_group", "error", "Los grupos vacíos no son válidos.", "()", token.position));
        consume();
        return false;
      }
      const hasOperand = parseExpression(depth + 1, negated);
      if (current()?.kind !== "RPAREN") {
        errors.push(issue("unbalanced_parenthesis", "error", "Falta un paréntesis de cierre.", token.value, token.position));
      } else {
        consume();
      }
      return hasOperand;
    }
    if (token.kind === "RPAREN") return false;
    errors.push(issue("unexpected_token", "error", `No se esperaba '${token.value}' en esta posición.`, token.value, token.position));
    consume();
    return false;
  };

  if (tokens.length > 0) parseExpression(0, false);
  while (cursor < tokens.length) {
    const token = consume();
    if (!token) break;
    const previous = tokens[cursor - 2];
    const danglingOperator = (token.kind === "AND" || token.kind === "OR" || token.kind === "NOT")
      && cursor >= tokens.length;
    const code = token.kind === "RPAREN"
      ? "unbalanced_parenthesis"
      : danglingOperator
        ? "missing_operand"
        : "missing_operator";
    const message = token.kind === "RPAREN"
      ? "Hay un paréntesis de cierre sin apertura."
      : danglingOperator
        ? `${token.value} necesita una expresión a la derecha.`
        : `Falta AND u OR entre '${previous?.value ?? "la expresión anterior"}' y '${token.value}'.`;
    errors.push(issue(code, "error", message, token.value, token.position));
  }

  return { positiveTerms, negativeTerms, maxDepth };
}

function normalizeTokens(tokens: Token[], raw: string): string {
  if (tokens.length === 0) return raw.replace(/\s+/g, " ").trim();
  let output = "";
  for (const token of tokens) {
    const value = token.kind === "PHRASE"
      ? `"${token.value}"${token.proximity !== undefined ? `~${token.proximity}` : ""}`
      : token.value;
    if (token.kind === "LPAREN") {
      if (output && !output.endsWith(" ") && !output.endsWith("(")) output += " ";
      output += "(";
    } else if (token.kind === "RPAREN") {
      output = output.trimEnd() + ")";
    } else {
      if (output && !output.endsWith("(") && !output.endsWith(" ")) output += " ";
      output += value;
    }
  }
  return output.replace(/\s+/g, " ").trim();
}

function isAdvancedOperator(value: string): boolean {
  return value.includes(":")
    || /^NEAR(?:\/\d+)?$/i.test(value)
    || /^~\d+$/u.test(value)
    || /^[+-]/u.test(value);
}

function issue(
  code: PortableListenQueryIssueCode,
  severity: "error" | "warning",
  message: string,
  token?: string,
  position?: number
): PortableListenQueryIssue {
  return { code, severity, message, ...(token ? { token } : {}), ...(position !== undefined ? { position } : {}) };
}
