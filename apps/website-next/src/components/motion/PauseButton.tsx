"use client";

import { useTranslations } from "next-intl";
import { Pause, Play } from "iconoir-react";

export function PauseButton({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  const t = useTranslations("feed");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={playing ? t("pause") : t("play")}
      style={{
        position: "absolute",
        right: 8,
        bottom: 8,
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "1px solid var(--line-strong)",
        background: "rgba(255,255,255,0.9)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        zIndex: 2
      }}
    >
      {playing ? <Pause width={16} height={16} aria-hidden /> : <Play width={16} height={16} aria-hidden />}
    </button>
  );
}
