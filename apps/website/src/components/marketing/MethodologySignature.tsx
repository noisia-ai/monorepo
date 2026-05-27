// SVG identity signatures for Noisia's 6 proprietary methodologies.
// Each signature is a schematic that visually encodes the methodology's structure.

type SProps = { className?: string };

// Stroke-only objects (no fill) to avoid duplicate-prop errors when combined with fill="currentColor"
const s = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.6,
};

const sb = { ...s, strokeWidth: 2.2 };

// Full stroke + fill:none for open shapes
const t = { fill: "none", ...s };
const bold = { fill: "none", ...sb };

const label = {
  fill: "currentColor",
  fillOpacity: 0.5,
  fontFamily: "system-ui, -apple-system, sans-serif",
  letterSpacing: "0.06em" as const,
};

function TriggersBarriersSignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* Column guides */}
      <line {...t} x1="35" y1="14" x2="35" y2="76" opacity="0.18" />
      <line {...t} x1="245" y1="14" x2="245" y2="76" opacity="0.18" />
      {/* Left trigger nodes */}
      <circle {...t} cx="35" cy="20" r="5.5" />
      <circle {...t} cx="35" cy="45" r="5.5" />
      <circle {...t} cx="35" cy="70" r="5.5" />
      {/* Right barrier nodes */}
      <circle {...t} cx="245" cy="20" r="5.5" />
      <circle {...t} cx="245" cy="45" r="5.5" />
      <circle {...t} cx="245" cy="70" r="5.5" />
      {/* Center decision node */}
      <circle cx="140" cy="45" r="11" fill="currentColor" fillOpacity="0.14" {...sb} />
      {/* Converging lines from left */}
      <line {...t} x1="40" y1="20" x2="129" y2="42" opacity="0.5" />
      <line {...t} x1="40" y1="45" x2="129" y2="45" opacity="0.5" />
      <line {...t} x1="40" y1="70" x2="129" y2="48" opacity="0.5" />
      {/* Converging lines from right */}
      <line {...t} x1="240" y1="20" x2="151" y2="42" opacity="0.5" />
      <line {...t} x1="240" y1="45" x2="151" y2="45" opacity="0.5" />
      <line {...t} x1="240" y1="70" x2="151" y2="48" opacity="0.5" />
      {/* Arrow chevrons pointing toward center */}
      <polyline {...t} points="123,40 129,45 123,50" />
      <polyline {...t} points="157,40 151,45 157,50" />
      {/* Labels */}
      <text {...label} x="35" y="8" textAnchor="middle" fontSize="7">TRIGGERS</text>
      <text {...label} x="245" y="8" textAnchor="middle" fontSize="7">BARRIERS</text>
      <text {...label} x="140" y="86" textAnchor="middle" fontSize="7" fillOpacity="0.6">DECISIÓN</text>
    </svg>
  );
}

function ValuePerceptionSignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* Bottom bar - Expected (widest) */}
      <rect {...t} x="18" y="62" width="244" height="18" rx="3" />
      {/* Middle bar - Desired */}
      <rect {...t} x="60" y="38" width="160" height="18" rx="3" />
      {/* Top bar - Delightful (narrowest) */}
      <rect {...t} x="106" y="14" width="68" height="18" rx="3" />
      {/* Pyramid outline lines */}
      <line {...t} x1="18" y1="62" x2="106" y2="14" opacity="0.2" />
      <line {...t} x1="262" y1="62" x2="174" y2="14" opacity="0.2" />
      {/* Labels inside bars */}
      <text {...label} x="140" y="75.5" textAnchor="middle" fontSize="7.5">EXPECTED</text>
      <text {...label} x="140" y="51.5" textAnchor="middle" fontSize="7.5">DESIRED</text>
      <text {...label} x="140" y="27.5" textAnchor="middle" fontSize="7.5" fillOpacity="0.65">DELIGHTFUL</text>
    </svg>
  );
}

function CulturalCodesSignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* 4 concentric rings - center (140, 48) */}
      <circle {...t} cx="140" cy="48" r="40" />
      <circle {...t} cx="140" cy="48" r="29" />
      <circle {...t} cx="140" cy="48" r="18" />
      {/* Subcultural core - filled */}
      <circle cx="140" cy="48" r="7" fill="currentColor" fillOpacity="0.16" {...s} />
      {/* Tick marks at top of each ring */}
      <line {...t} x1="140" y1="8" x2="140" y2="15" opacity="0.38" />
      <line {...t} x1="140" y1="19" x2="140" y2="25" opacity="0.38" />
      <line {...t} x1="140" y1="30" x2="140" y2="34" opacity="0.38" />
      {/* Labels right of rings */}
      <text {...label} x="184" y="49" fontSize="7" dominantBaseline="middle">UNIVERSAL</text>
      <text {...label} x="173" y="37" fontSize="7" dominantBaseline="middle">REGIONAL</text>
      <text {...label} x="162" y="27" fontSize="7" dominantBaseline="middle">GENERAC.</text>
    </svg>
  );
}

function DecisionVelocitySignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* Timeline baseline */}
      <line {...bold} x1="18" y1="50" x2="255" y2="50" />
      <polyline {...t} points="248,44 255,50 248,56" />
      {/* Accelerators (upward) */}
      <line {...t} x1="65" y1="50" x2="65" y2="20" />
      <polyline {...t} points="59,26 65,20 71,26" />
      <line {...t} x1="115" y1="50" x2="115" y2="28" />
      <polyline {...t} points="109,34 115,28 121,34" />
      <line {...t} x1="170" y1="50" x2="170" y2="12" />
      <polyline {...t} points="164,18 170,12 176,18" />
      {/* Decelerators (downward, muted) */}
      <line {...t} x1="90" y1="50" x2="90" y2="70" opacity="0.42" />
      <polyline {...t} points="84,64 90,70 96,64" opacity="0.42" />
      <line {...t} x1="142" y1="50" x2="142" y2="76" opacity="0.42" />
      <polyline {...t} points="136,70 142,76 148,70" opacity="0.42" />
      <line {...t} x1="208" y1="50" x2="208" y2="64" opacity="0.42" />
      <polyline {...t} points="202,58 208,64 214,58" opacity="0.42" />
      {/* Labels */}
      <text {...label} x="65" y="88" textAnchor="middle" fontSize="7">ACELERADORES ↑</text>
      <text {...label} x="142" y="88" textAnchor="middle" fontSize="7">FRENOS ↓</text>
    </svg>
  );
}

function JourneyFrictionSignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* 5-stage journey with friction X-marks at transitions */}
      <path {...bold} d="M18,54 L60,34" />
      {/* Friction 1 */}
      <line {...t} x1="60" y1="30" x2="68" y2="38" />
      <line {...t} x1="68" y1="30" x2="60" y2="38" />
      <path {...bold} d="M68,34 L108,20" />
      {/* Friction 2 */}
      <line {...t} x1="108" y1="16" x2="116" y2="24" />
      <line {...t} x1="116" y1="16" x2="108" y2="24" />
      <path {...bold} d="M116,20 L158,40" />
      {/* Friction 3 */}
      <line {...t} x1="158" y1="36" x2="166" y2="44" />
      <line {...t} x1="166" y1="36" x2="158" y2="44" />
      <path {...bold} d="M166,40 L208,24" />
      {/* Friction 4 */}
      <line {...t} x1="208" y1="20" x2="216" y2="28" />
      <line {...t} x1="216" y1="20" x2="208" y2="28" />
      <path {...bold} d="M216,24 L262,54" />
      {/* Start / end dots */}
      <circle fill="currentColor" cx="18" cy="54" r="4.5" />
      <circle fill="currentColor" cx="262" cy="54" r="4.5" />
      {/* Labels */}
      <text {...label} x="18" y="68" textAnchor="middle" fontSize="7">INICIO</text>
      <text {...label} x="262" y="68" textAnchor="middle" fontSize="7">FIN</text>
      <text {...label} x="140" y="84" textAnchor="middle" fontSize="7" fillOpacity="0.55">× 4 PUNTOS DE FRICCIÓN</text>
    </svg>
  );
}

function InfluenceArchitectureSignature({ className }: SProps) {
  return (
    <svg
      viewBox="0 0 280 90"
      className={`method-signature ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      {/* Hub→secondary connections */}
      <line {...t} x1="131" y1="37" x2="80" y2="22" />
      <line {...t} x1="131" y1="53" x2="80" y2="68" />
      <line {...t} x1="140" y1="34" x2="140" y2="18" />
      <line {...t} x1="149" y1="37" x2="200" y2="22" />
      <line {...t} x1="149" y1="53" x2="200" y2="68" />
      {/* Secondary→tertiary connections */}
      <line {...t} x1="73" y1="30" x2="33" y2="45" opacity="0.48" />
      <line {...t} x1="73" y1="60" x2="33" y2="45" opacity="0.48" />
      <line {...t} x1="207" y1="30" x2="247" y2="45" opacity="0.48" />
      <line {...t} x1="207" y1="60" x2="247" y2="45" opacity="0.48" />
      <line {...t} x1="87" y1="72" x2="140" y2="83" opacity="0.48" />
      <line {...t} x1="193" y1="72" x2="140" y2="83" opacity="0.48" />
      {/* Cross-secondary (dashed) */}
      <line {...t} x1="87" y1="19" x2="133" y2="13" opacity="0.25" strokeDasharray="3,3" />
      <line {...t} x1="193" y1="19" x2="147" y2="13" opacity="0.25" strokeDasharray="3,3" />
      {/* Tertiary nodes */}
      <circle {...t} cx="28" cy="45" r="4.5" />
      <circle {...t} cx="252" cy="45" r="4.5" />
      <circle {...t} cx="140" cy="85" r="4.5" />
      {/* Secondary nodes */}
      <circle {...t} cx="75" cy="22" r="7" />
      <circle {...t} cx="75" cy="68" r="7" />
      <circle {...t} cx="140" cy="13" r="6.5" />
      <circle {...t} cx="205" cy="22" r="7" />
      <circle {...t} cx="205" cy="68" r="7" />
      {/* Hub node (drawn last, on top) */}
      <circle cx="140" cy="45" r="11" fill="currentColor" fillOpacity="0.14" {...sb} />
    </svg>
  );
}

export function MethodologySignature({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  switch (slug) {
    case "triggers-y-barriers":
      return <TriggersBarriersSignature className={className} />;
    case "value-perception-matrix":
      return <ValuePerceptionSignature className={className} />;
    case "cultural-codes-decoding":
      return <CulturalCodesSignature className={className} />;
    case "decision-velocity":
      return <DecisionVelocitySignature className={className} />;
    case "journey-friction-mapping":
      return <JourneyFrictionSignature className={className} />;
    case "influence-architecture":
      return <InfluenceArchitectureSignature className={className} />;
    default:
      return null;
  }
}
