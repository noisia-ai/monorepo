// Platform logo cloud — visual hierarchy by size (xl → xs).
// Uses simple-icons for brand SVGs; lucide for platforms not in the package.

import { Cloud, Headphones, Mail, ShoppingBag } from "lucide-react";
import {
  siAppstore,
  siDiscourse,
  siFacebook,
  siGoogle,
  siGoogleplay,
  siInstagram,
  siMercadopago,
  siReddit,
  siShopify,
  siTiktok,
  siTrustpilot,
  siWhatsapp,
  siX,
  siYoutube,
} from "simple-icons";

type Platform = {
  name: string;
  /** simple-icons icon data (has .path) */
  si?: { path: string; title?: string };
  /** Fallback: lucide icon node */
  lucide?: React.ReactNode;
  size: "xl" | "lg" | "md" | "sm" | "xs";
  note?: string;
};

const PLATFORMS: Platform[] = [
  { name: "TikTok",          si: siTiktok,      size: "xl", note: "señales culturales" },
  { name: "Instagram",       si: siInstagram,   size: "xl", note: "social proof" },
  { name: "X / Twitter",     si: siX,           size: "lg", note: "reputación" },
  { name: "YouTube",         si: siYoutube,     size: "lg", note: "comentarios largos" },
  { name: "Facebook",        si: siFacebook,    size: "lg", note: "comunidades" },
  { name: "Reddit",          si: siReddit,      size: "md", note: "dudas profundas" },
  { name: "Amazon",          lucide: <ShoppingBag size={16} strokeWidth={2} />, size: "lg", note: "reviews + Q&A" },
  { name: "Klaviyo",         lucide: <Mail size={16} strokeWidth={2} />, size: "lg", note: "email signals" },
  { name: "Salesforce",      lucide: <Cloud size={16} strokeWidth={2} />, size: "lg", note: "CRM context" },
  { name: "Zendesk",         lucide: <Headphones size={16} strokeWidth={2} />, size: "lg", note: "tickets" },
  { name: "Mercado Libre",   si: siMercadopago, size: "lg", note: "marketplace" },
  { name: "Google Reviews",  si: siGoogle,      size: "md", note: "local CX" },
  { name: "Shopify",         si: siShopify,     size: "md", note: "commerce data" },
  { name: "WhatsApp",        si: siWhatsapp,    size: "md", note: "care flows" },
  { name: "App Store",       si: siAppstore,    size: "sm", note: "app feedback" },
  { name: "Google Play",     si: siGoogleplay,  size: "sm", note: "ratings" },
  { name: "Trustpilot",      si: siTrustpilot,  size: "sm", note: "proof" },
  { name: "Foros y Q&A",     si: siDiscourse,   size: "xs", note: "context" },
];

const SOURCE_STATS = [
  { value: "150+", label: "tipos de fuente VoC" },
  { value: "12", label: "familias de datos conectables" }
];

export function SourcesConstellation() {
  return (
    <div className="sources-constellation-shell">
      <div className="sources-constellation-meta">
        <span className="eyebrow">Escucha en México</span>
        <div className="sources-constellation-meta__stats">
          {SOURCE_STATS.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sources-constellation" aria-label="Plataformas cubiertas">
        {PLATFORMS.map((platform) => (
          <div
            key={platform.name}
            className={`constellation-bubble constellation-bubble--${platform.size}`}
            title={platform.name}
          >
            {platform.si && (
              <svg
                className="constellation-bubble__icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="currentColor"
              >
                <path d={platform.si.path} />
              </svg>
            )}
            {platform.lucide && (
              <span className="constellation-bubble__icon-wrap" aria-hidden="true">
                {platform.lucide}
              </span>
            )}
            <span className="constellation-bubble__name">{platform.name}</span>
            {platform.note && (
              <span className="constellation-bubble__note">{platform.note}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
