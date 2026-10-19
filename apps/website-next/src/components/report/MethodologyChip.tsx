import clsx from "clsx";

type MethodologyMeta = {
  slug: string;
  name: string;
  number?: string;
  aliases: string[];
};

const METHODOLOGY_META: MethodologyMeta[] = [
  {
    slug: "triggers-y-barriers",
    name: "Triggers & Barriers",
    number: "01",
    aliases: ["triggers & barriers", "triggers and barriers"]
  },
  {
    slug: "value-perception-matrix",
    name: "Value Perception Matrix",
    number: "02",
    aliases: ["value perception matrix"]
  },
  {
    slug: "cultural-codes-decoding",
    name: "Cultural Codes Decoding",
    number: "03",
    aliases: ["cultural codes decoding", "cultural codes"]
  },
  {
    slug: "decision-velocity",
    name: "Decision Velocity",
    number: "04",
    aliases: ["decision velocity"]
  },
  {
    slug: "journey-friction-mapping",
    name: "Journey Friction Mapping",
    number: "05",
    aliases: ["journey friction mapping"]
  },
  {
    slug: "influence-architecture",
    name: "Influence Architecture",
    number: "06",
    aliases: ["influence architecture"]
  }
];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function resolveMethodologyMeta(identifier: string) {
  const normalized = normalize(identifier);
  return (
    METHODOLOGY_META.find(
      (item) => item.slug === normalized || normalize(item.name) === normalized || item.aliases.includes(normalized)
    ) ?? {
      slug: "generic",
      name: identifier,
      aliases: []
    }
  );
}

type MethodologyIconProps = {
  identifier: string;
  className?: string;
};

export function MethodologyIcon({ identifier, className }: MethodologyIconProps) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.85
  };
  const { slug } = resolveMethodologyMeta(identifier);

  switch (slug) {
    case "triggers-y-barriers":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path {...commonProps} d="M6 7h7l2 2h3" />
          <path {...commonProps} d="M6 17h7l2-2h3" />
          <circle {...commonProps} cx="6" cy="7" r="2.25" />
          <circle {...commonProps} cx="6" cy="17" r="2.25" />
          <circle {...commonProps} cx="18" cy="12" r="2.25" />
        </svg>
      );
    case "value-perception-matrix":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect {...commonProps} x="4.5" y="4.5" width="15" height="15" rx="3.2" />
          <path {...commonProps} d="M12 4.5v15" />
          <path {...commonProps} d="M4.5 12h15" />
          <circle {...commonProps} cx="8.25" cy="8.25" r="1.7" />
          <circle {...commonProps} cx="15.75" cy="15.75" r="1.7" />
        </svg>
      );
    case "cultural-codes-decoding":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path {...commonProps} d="M6 18c2.1-4.3 4.7-6.5 8-6.5 1.7 0 3.1.5 4 1.2" />
          <path {...commonProps} d="M6 12.5c1.7-3.3 4.3-5 7.6-5 1.8 0 3.3.5 4.4 1.4" />
          <path {...commonProps} d="M6 7.5c1.2-1.6 3-2.5 5.1-2.5 2.3 0 4.3 1 5.7 2.8" />
          <circle {...commonProps} cx="6" cy="18" r="1.8" />
          <circle {...commonProps} cx="18" cy="13" r="1.8" />
        </svg>
      );
    case "decision-velocity":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path {...commonProps} d="M5 16a7 7 0 1 1 14 0" />
          <path {...commonProps} d="M12 12l4.5-3" />
          <circle {...commonProps} cx="12" cy="12" r="1.9" />
          <path {...commonProps} d="M7.5 16h9" />
        </svg>
      );
    case "journey-friction-mapping":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path {...commonProps} d="M5 7.5h4.5l2.4 9 2.2-6h4.9" />
          <circle {...commonProps} cx="5" cy="7.5" r="1.8" />
          <circle {...commonProps} cx="19" cy="10.5" r="1.8" />
          <path {...commonProps} d="M8 18h8" />
        </svg>
      );
    case "influence-architecture":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle {...commonProps} cx="12" cy="6" r="2.2" />
          <circle {...commonProps} cx="6.5" cy="16.5" r="2.2" />
          <circle {...commonProps} cx="17.5" cy="16.5" r="2.2" />
          <path {...commonProps} d="M10.8 7.9 8 14.3" />
          <path {...commonProps} d="M13.2 7.9 16 14.3" />
          <path {...commonProps} d="M8.8 16.5h6.4" />
        </svg>
      );
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle {...commonProps} cx="12" cy="12" r="7" />
          <path {...commonProps} d="M12 8v4l2.8 2.8" />
        </svg>
      );
  }
}

type MethodologyChipProps = {
  identifier: string;
  className?: string;
  label?: string;
  compact?: boolean;
};

export function MethodologyChip({ identifier, className, label, compact = false }: MethodologyChipProps) {
  const meta = resolveMethodologyMeta(identifier);

  return (
    <span className={clsx("methodology-chip", compact && "methodology-chip--compact", className)}>
      <span className="methodology-chip__icon" aria-hidden="true">
        <MethodologyIcon identifier={identifier} />
      </span>
      <span>{label ?? meta.name}</span>
    </span>
  );
}
