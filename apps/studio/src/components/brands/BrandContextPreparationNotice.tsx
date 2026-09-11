"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

export type BrandContextPreparationQuote = {
  contract_version: "brand-context-preparation-quote-v1"; quote_digest: string; available: boolean;
  semantic_cap_micro_usd: string; prototype_cap_micro_usd: string; admission_not_after: string; quote_expires_at: string;
  model: "claude-sonnet-4-6"; embedding_model: string; blocked_reason: string | null;
};
export type BrandContextPreparationIntent = { idempotency_key: string; quote_digest?: string;
  confirmation?: "prepare_brand_context_within_shown_cap" };
type BrandContextPreparationIntentRecord = { signature: string; value: BrandContextPreparationIntent };

export function refreshedBrandContextPreparationIntent(
  current: BrandContextPreparationIntentRecord | undefined,
  renewIntent = false
): BrandContextPreparationIntentRecord | undefined {
  return renewIntent ? undefined : current;
}

export function parseBrandContextPreparationQuote(value: unknown): BrandContextPreparationQuote | null {
  const quote = value as Partial<BrandContextPreparationQuote> | null;
  return quote?.contract_version === "brand-context-preparation-quote-v1" && typeof quote.quote_digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(quote.quote_digest)
    && typeof quote.available === "boolean" && quote.model === "claude-sonnet-4-6"
    && typeof quote.semantic_cap_micro_usd === "string" && /^\d+$/u.test(quote.semantic_cap_micro_usd)
    && typeof quote.prototype_cap_micro_usd === "string" && /^\d+$/u.test(quote.prototype_cap_micro_usd)
    && typeof quote.admission_not_after === "string" && Number.isFinite(Date.parse(quote.admission_not_after))
    && typeof quote.quote_expires_at === "string" && Number.isFinite(Date.parse(quote.quote_expires_at))
    && typeof quote.embedding_model === "string" && (quote.blocked_reason === null || typeof quote.blocked_reason === "string")
    ? quote as BrandContextPreparationQuote : null;
}

export function brandContextPreparationIntent(quote: BrandContextPreparationQuote | null, key: string): BrandContextPreparationIntent {
  return quote?.available ? { idempotency_key: key, quote_digest: quote.quote_digest, confirmation: "prepare_brand_context_within_shown_cap" }
    : { idempotency_key: key };
}

export function useBrandContextPreparation(enabled = true) {
  const [quote, setQuote] = useState<BrandContextPreparationQuote | null>(null);
  const [loading, setLoading] = useState(enabled);
  const intents = useRef(new Map<string, BrandContextPreparationIntentRecord>());
  useEffect(() => {
    if (!enabled) {
      setQuote(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/brand-context/preparation-quote", { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const next = parseBrandContextPreparationQuote(await response.json());
        if (!controller.signal.aborted) setQuote(next);
      } catch { /* Saving remains available without admitting a provider call. */ }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [enabled]);
  return { quote, loading,
    async refresh(action?: string, options?: { renewIntent?: boolean }) {
      setLoading(true);
      try {
        const response = await fetch("/api/brand-context/preparation-quote", { cache: "no-store" });
        const next = response.ok ? parseBrandContextPreparationQuote(await response.json()) : null;
        setQuote(next);
        if (action) {
          const retained = refreshedBrandContextPreparationIntent(intents.current.get(action), options?.renewIntent);
          if (retained) intents.current.set(action, retained); else intents.current.delete(action);
        } else intents.current.clear();
        return next;
      } catch {
        setQuote(null);
        if (action) {
          const retained = refreshedBrandContextPreparationIntent(intents.current.get(action), options?.renewIntent);
          if (retained) intents.current.set(action, retained); else intents.current.delete(action);
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    forRequest(action: string, body: unknown) {
      const signature = JSON.stringify(body);
      const prior = intents.current.get(action);
      if (prior?.signature === signature) return prior.value;
      const value = brandContextPreparationIntent(quote, crypto.randomUUID());
      intents.current.set(action, { signature, value }); return value;
    },
    forUnfundedRequest(action: string, body: unknown) {
      const signature = JSON.stringify(body);
      const prior = intents.current.get(action);
      if (prior?.signature === signature) return prior.value;
      const value = { idempotency_key: crypto.randomUUID() };
      intents.current.set(action, { signature, value }); return value;
    },
    accepted(action: string) { intents.current.delete(action); }
  };
}

export function BrandContextPreparationNotice({ quote, loading }: { quote: BrandContextPreparationQuote | null; loading: boolean }) {
  const t = useTranslations("BrandContextPreparation"), locale = useLocale();
  const money = (value: bigint) => {
    const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "").padEnd(2, "0");
    const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
    return `USD ${new Intl.NumberFormat(locale).format(value / 1_000_000n)}${separator}${fraction}`;
  };
  if (loading || !quote?.available) return <div className="brand-context-preparation-notice" role="status">
    <strong>{t(loading ? "loading" : "pending")}</strong><p>{t("pendingBody")}</p>
  </div>;
  const semantic = BigInt(quote.semantic_cap_micro_usd), prototype = BigInt(quote.prototype_cap_micro_usd);
  return <div className="brand-context-preparation-notice" role="note">
    <strong>{t("cap", { amount: money(semantic + prototype) })}</strong>
    <p>{t("confirmation")}</p><small>{t("breakdown", { claude: money(semantic), embeddings: money(prototype) })}</small>
    <small>{t("expiry", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(quote.admission_not_after)) })}</small>
  </div>;
}
