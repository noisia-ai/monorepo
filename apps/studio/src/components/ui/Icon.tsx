import type { SVGProps } from "react";

export type IconName =
  | "check"
  | "arrow-right"
  | "arrow-up"
  | "refresh"
  | "sparkle"
  | "pencil"
  | "alert"
  | "x"
  | "spinner"
  | "copy"
  | "search"
  | "filter"
  | "calendar"
  | "sort"
  | "tag"
  | "layers"
  | "message"
  | "platform"
  | "sentiment"
  | "clock"
  | "external"
  | "chevron-down"
  | "play"
  | "upload"
  | "save"
  | "trash"
  | "maximize"
  | "minimize"
  | "info"
  | "wave"
  | "star";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

/**
 * Inline SVG icon set. Stroke-based, currentColor — inherits text color
 * so it behaves like a glyph. Single file so we don't pay for an icon lib.
 */
export function Icon({ name, size = 16, className, ...props }: IconProps) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: ["icon", className].filter(Boolean).join(" "),
    "aria-hidden": true,
  };

  switch (name) {
    case "check":
      return (
        <svg {...common} {...props}>
          <path d="M5 12l5 5L20 7" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common} {...props}>
          <path d="M5 12h14" />
          <path d="M13 5l7 7-7 7" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...common} {...props}>
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common} {...props}>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common} {...props}>
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
          <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
        </svg>
      );
    case "pencil":
      return (
        <svg {...common} {...props}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common} {...props}>
          <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </svg>
      );
    case "x":
      return (
        <svg {...common} {...props}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...common} {...props} className={["icon icon--spin", className].filter(Boolean).join(" ")}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common} {...props}>
          <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common} {...props}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common} {...props}>
          <path d="M4 5h16" />
          <path d="M7 12h10" />
          <path d="M10 19h4" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common} {...props}>
          <rect x="3" y="4" width="18" height="18" rx="4" />
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <path d="M3 10h18" />
        </svg>
      );
    case "sort":
      return (
        <svg {...common} {...props}>
          <path d="M7 4v16" />
          <path d="m3 8 4-4 4 4" />
          <path d="M17 20V4" />
          <path d="m13 16 4 4 4-4" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common} {...props}>
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
          <path d="M7.5 7.5h.01" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common} {...props}>
          <path d="m12 3 9 5-9 5-9-5 9-5z" />
          <path d="m3 13 9 5 9-5" />
          <path d="m3 18 9 5 9-5" />
        </svg>
      );
    case "message":
      return (
        <svg {...common} {...props}>
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      );
    case "platform":
      return (
        <svg {...common} {...props}>
          <rect x="3" y="4" width="18" height="14" rx="3" />
          <path d="M8 22h8" />
          <path d="M12 18v4" />
        </svg>
      );
    case "sentiment":
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 10h.01" />
          <path d="M16 10h.01" />
          <path d="M8 15c1.2 1 2.5 1.5 4 1.5s2.8-.5 4-1.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "external":
      return (
        <svg {...common} {...props}>
          <path d="M14 3h7v7" />
          <path d="M10 14 21 3" />
          <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common} {...props}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "play":
      return (
        <svg {...common} {...props}>
          <polygon fill="currentColor" points="6 4 20 12 6 20 6 4" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common} {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "save":
      return (
        <svg {...common} {...props}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common} {...props}>
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      );
    case "maximize":
      return (
        <svg {...common} {...props}>
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      );
    case "minimize":
      return (
        <svg {...common} {...props}>
          <path d="M4 14h6v6" />
          <path d="M20 10h-6V4" />
          <path d="M14 10l7-7" />
          <path d="M3 21l7-7" />
        </svg>
      );
    case "info":
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="8" />
        </svg>
      );
    case "wave":
      return (
        <svg {...common} {...props}>
          <path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0 4 3 6 0" />
        </svg>
      );
    case "star":
      return (
        <svg {...common} {...props}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
  }
}
