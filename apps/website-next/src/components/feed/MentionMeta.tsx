import { Calendar } from "iconoir-react";
import { SourceIcon, sourceLabel } from "@/components/brand/SourceMark";
import { formatMonth } from "@/lib/dates";
import styles from "./Feed.module.css";

/** Platform logo and name, then calendar and month: how every mention is signed. */
export function MentionMeta({ platform, date, locale }: { platform: string; date?: string | null; locale: string }) {
  return (
    <p className={styles.mentionMeta}>
      <span>
        <SourceIcon name={platform} size={16} />
        {sourceLabel(platform, locale)}
      </span>
      {date ? (
        <span>
          <Calendar width={15} height={15} strokeWidth={1.8} aria-hidden />
          {formatMonth(date, locale)}
        </span>
      ) : null}
    </p>
  );
}
