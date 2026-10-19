"use client";

import { useSignalUiLanguage } from "@/components/signal/SignalReportShell";

/**
 * Black Noisia button in the Signal report top bar. Opens the press deck
 * (reimagined 16:9 layout) in a new tab, carrying the report's active UI
 * language so the deck chrome matches the rendered insights.
 */
export function SignalDeckButton({
  outputId,
  hrefBase = "/signal",
  labelOverride
}: {
  outputId: string;
  hrefBase?: "/signal" | "/pulse";
  labelOverride?: { en: string; es: string };
}) {
  const { uiLanguage } = useSignalUiLanguage();
  const label = labelOverride?.[uiLanguage] ?? (uiLanguage === "en" ? "Press deck" : "Deck de prensa");
  const href = `${hrefBase}/${outputId}/deck?lang=${uiLanguage}`;

  return (
    <a className="signal-deck-btn" href={href} target="_blank" rel="noopener noreferrer">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      {label}
    </a>
  );
}
