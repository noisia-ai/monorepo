"use client";

import { useLocale } from "next-intl";
import { SendDiagonal, Wifi } from "iconoir-react";
import { Stage } from "@/motion/runtime";
import { StoryComposition, posterFrame, storyDuration } from "@/motion/StoryComposition";
import { CANVAS } from "@/motion/theme";
import type { FeedStory } from "@/components/feed/types";
import styles from "./offer.module.css";

/**
 * A real feed story playing inside a phone. The screen is a status bar, the story at its own
 * 9:16 and a reply bar, so the story fills its space with no empty bands.
 */
export function PhoneStory({ story, playing, reduced, reply }: { story: FeedStory; playing: boolean; reduced: boolean; reply: string }) {
  const locale = useLocale();
  return (
    <div className={styles.phone}>
      <div className={styles.screen}>
        <div className={styles.status} aria-hidden>
          <span>9:41</span>
          <span className={styles.island} />
          <span className={styles.statusIcons}>
            <svg viewBox="0 0 18 12" width="18" height="12">
              {[0, 1, 2, 3].map((k) => (
                <rect key={k} x={k * 4.6} y={9 - k * 3} width={3.2} height={3 + k * 3} rx={1} fill="currentColor" />
              ))}
            </svg>
            <Wifi width={16} height={16} strokeWidth={2.2} />
            <svg viewBox="0 0 27 13" width="25" height="12">
              <rect x={0.5} y={0.5} width={23} height={12} rx={3.5} fill="none" stroke="currentColor" opacity={0.4} />
              <rect x={2.5} y={2.5} width={17} height={8} rx={2} fill="currentColor" />
              <rect x={24.5} y={4.5} width={2} height={4} rx={1} fill="currentColor" opacity={0.4} />
            </svg>
          </span>
        </div>
        <div className={styles.storyArea}>
          <Stage
            durationInFrames={storyDuration(story.content)}
            fps={CANVAS.fps}
            playing={playing}
            frame={reduced ? posterFrame(story.content) : 0}
            label={story.content.title}
            className={styles.phoneStage}
          >
            <StoryComposition story={story.content} locale={locale} tag={story.tag} mode="video" />
          </Stage>
        </div>
        <div className={styles.reply} aria-hidden>
          <span className={styles.replyField}>{reply}</span>
          <span className={styles.replySend}>
            <SendDiagonal />
          </span>
        </div>
      </div>
    </div>
  );
}
