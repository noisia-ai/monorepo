import { Icon, type IconName } from "@/components/ui/Icon";

type Props = {
  value: string | null | undefined;
  label?: string;
  compact?: boolean;
};

export function SourceIcon({ value }: Pick<Props, "value">) {
  const kind = sourceKind(value);

  if (kind === "x") {
    return (
      <span className="source-icon source-icon--x" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M17.7 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.4L1.7 3h6.5l4.4 5.8L17.7 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.1 14.5Z" />
        </svg>
      </span>
    );
  }

  if (kind === "tiktok") {
    return (
      <span className="source-icon source-icon--tiktok" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M14.2 3h2.7c.3 2.2 1.5 3.8 3.6 4.5v2.9c-1.6-.1-3-.6-4.2-1.6v6.7c0 3.2-2.2 5.5-5.5 5.5-3 0-5.2-2-5.2-4.8 0-3 2.3-5 5.7-5 .4 0 .7 0 1 .1v3c-.4-.1-.8-.2-1.2-.2-1.5 0-2.5.8-2.5 2s1 2 2.2 2c1.5 0 2.4-.9 2.4-2.7V3Z" />
        </svg>
      </span>
    );
  }

  if (kind === "instagram") {
    return (
      <span className="source-icon source-icon--instagram" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <rect x="4" y="4" width="16" height="16" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17" cy="7" r="1.2" />
        </svg>
      </span>
    );
  }

  if (kind === "reddit") {
    return (
      <span className="source-icon source-icon--reddit" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M16.6 4.5 13.7 4l-1 4.3" />
          <circle cx="17.6" cy="4.7" r="1.5" />
          <path d="M6.7 10.2c1.4-1 3.2-1.5 5.3-1.5s3.9.5 5.3 1.5" />
          <circle cx="5.1" cy="11.2" r="2" />
          <circle cx="18.9" cy="11.2" r="2" />
          <path d="M5.4 12.3c.2 3.4 3 5.7 6.6 5.7s6.4-2.3 6.6-5.7" />
          <path d="M9.2 13h.01M14.8 13h.01" />
          <path d="M9.5 15.4c1.5.9 3.5.9 5 0" />
        </svg>
      </span>
    );
  }

  if (kind === "youtube") {
    return (
      <span className="source-icon source-icon--youtube" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <rect x="3" y="6.5" width="18" height="11" rx="3" />
          <path d="m10.5 9.5 5 2.5-5 2.5v-5Z" />
        </svg>
      </span>
    );
  }

  if (kind === "facebook") {
    return (
      <span className="source-icon source-icon--facebook" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M14 8.2h2.2V4.8c-.4-.1-1.6-.2-3-.2-3 0-5 1.8-5 5.1v2.9H5v3.8h3.2V22h3.9v-5.6h3.2l.5-3.8h-3.7V10c0-1.1.3-1.8 1.9-1.8Z" />
        </svg>
      </span>
    );
  }

  if (kind === "table") {
    return (
      <span className="source-icon source-icon--table" aria-hidden="true">
        <strong>CSV</strong>
      </span>
    );
  }

  return (
    <span className={`source-icon source-icon--${kind}`} aria-hidden="true">
      <Icon name={sourceIconName(kind)} size={13} />
    </span>
  );
}

export function SourceToken({ value, label, compact = false }: Props) {
  return (
    <span className={compact ? "source-token source-token--compact" : "source-token"}>
      <SourceIcon value={value} />
      <span>{label ?? sourceLabel(value)}</span>
    </span>
  );
}

export function sourceLabel(value: string | null | undefined) {
  const normalized = normalizeSource(value);
  if (normalized === "tweet") return "Tweet";
  if (normalized === "quote_tweet") return "Quote tweet";
  if (normalized === "comment" || normalized === "comments") return "Comentario";
  if (normalized === "post") return "Post";
  if (normalized === "video") return "Video";
  if (normalized === "reels" || normalized === "reel") return "Reel";
  if (normalized === "unknown") return "Fuente desconocida";
  return titleize(normalized);
}

function sourceKind(value: string | null | undefined) {
  const normalized = normalizeSource(value);
  if (normalized === "tweet" || normalized === "quote_tweet" || normalized === "x" || normalized === "twitter") {
    return "x";
  }
  if (normalized === "tiktok") return "tiktok";
  if (normalized === "youtube") return "youtube";
  if (normalized === "instagram") return "instagram";
  if (normalized === "facebook") return "facebook";
  if (normalized === "reddit") return "reddit";
  if (normalized === "csv" || normalized === "spreadsheet" || normalized === "table") return "table";
  if (normalized === "file" || normalized === "archive") return "file";
  if (normalized === "comment" || normalized === "comments") return "comment";
  if (normalized === "video") return "video";
  if (normalized === "reels" || normalized === "reel") return "reels";
  if (normalized === "post") return "post";
  return "web";
}

function sourceIconName(kind: string): IconName {
  if (kind === "comment") return "message";
  if (kind === "video" || kind === "reels") return "play";
  if (kind === "youtube" || kind === "tiktok") return "play";
  if (kind === "post") return "copy";
  if (kind === "table" || kind === "file") return "copy";
  return "platform";
}

function normalizeSource(value: string | null | undefined) {
  return (value ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
}

function titleize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
