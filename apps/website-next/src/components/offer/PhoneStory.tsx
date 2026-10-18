"use client";

import { useRef } from "react";
import { useLocale } from "next-intl";
import { Stage } from "@/motion/runtime";
import { StoryComposition, storyDuration } from "@/motion/StoryComposition";
import { CANVAS } from "@/motion/theme";
import { usePlayback } from "@/components/motion/usePlayback";
import type { FeedStory } from "@/components/feed/types";
import styles from "./offer.module.css";

/** A real feed story playing inside a phone, to show the animated-stories format. */
export function PhoneStory({ story }: { story: FeedStory }) {
  const ref = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const { playing, reduced } = usePlayback(ref);
  return (
    <div ref={ref} className={styles.phone}>
      <Stage durationInFrames={storyDuration(story.content)} fps={CANVAS.fps} playing={playing} frame={reduced ? 120 : 0} label={story.content.title} className={styles.phoneStage}>
        <StoryComposition story={story.content} locale={locale} tag={story.tag} mode="video" />
      </Stage>
    </div>
  );
}
