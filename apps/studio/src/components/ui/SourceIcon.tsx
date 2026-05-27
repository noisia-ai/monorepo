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
  if (normalized === "comment" || normalized === "comments") return "comment";
  if (normalized === "video") return "video";
  if (normalized === "reels" || normalized === "reel") return "reels";
  if (normalized === "post") return "post";
  return "web";
}

function sourceIconName(kind: string): IconName {
  if (kind === "comment") return "message";
  if (kind === "video" || kind === "reels") return "play";
  if (kind === "post") return "copy";
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
