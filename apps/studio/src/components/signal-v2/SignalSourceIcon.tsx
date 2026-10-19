import {
  SiBluesky,
  SiFacebook,
  SiGoogle,
  SiInstagram,
  SiPinterest,
  SiReddit,
  SiTelegram,
  SiTiktok,
  SiWhatsapp,
  SiX,
  SiYoutube
} from "@icons-pack/react-simple-icons";
import { GlobeHemisphereWest, Newspaper, Rss, Star } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function SignalSourceIcon({
  label,
  platform,
  size = 15
}: {
  label?: string;
  platform: string | null;
  size?: number;
}) {
  const normalized = (platform ?? "").trim().toLowerCase();
  const accessibleLabel = label ?? platform ?? "Web";
  const common = {
    "aria-label": accessibleLabel,
    color: "currentColor",
    role: "img" as const,
    size
  };

  let icon: ReactNode;
  if (normalized.includes("facebook")) icon = <SiFacebook {...common} />;
  else if (normalized.includes("instagram")) icon = <SiInstagram {...common} />;
  else if (normalized === "x" || normalized.includes("twitter")) icon = <SiX {...common} />;
  else if (normalized.includes("tiktok")) icon = <SiTiktok {...common} />;
  else if (normalized.includes("youtube")) icon = <SiYoutube {...common} />;
  else if (normalized.includes("reddit")) icon = <SiReddit {...common} />;
  else if (normalized.includes("telegram")) icon = <SiTelegram {...common} />;
  else if (normalized.includes("whatsapp")) icon = <SiWhatsapp {...common} />;
  else if (normalized.includes("pinterest")) icon = <SiPinterest {...common} />;
  else if (normalized.includes("bluesky")) icon = <SiBluesky {...common} />;
  else if (normalized.includes("google")) icon = <SiGoogle {...common} />;
  else if (normalized.includes("review")) {
    icon = <Star aria-label={accessibleLabel} role="img" size={size} weight="fill" />;
  }
  else if (normalized.includes("news") || normalized.includes("press")) {
    icon = <Newspaper aria-label={accessibleLabel} role="img" size={size} />;
  }
  else if (normalized.includes("rss") || normalized.includes("blog")) {
    icon = <Rss aria-label={accessibleLabel} role="img" size={size} />;
  } else {
    icon = <GlobeHemisphereWest aria-label={accessibleLabel} role="img" size={size} />;
  }

  return (
    <span
      className="signal-v2-source-icon"
      style={{ height: size, width: size }}
    >
      {icon}
    </span>
  );
}
