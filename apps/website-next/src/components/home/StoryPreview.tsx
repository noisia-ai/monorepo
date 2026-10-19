"use client";

import { Play } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import { Stage } from "@/motion/runtime";
import { StoryComposition, posterFrame, storyDuration } from "@/motion/StoryComposition";
import type { FeedStory } from "@/components/feed/types";
import styles from "./home.module.css";

/** A static frame of a story that opens it in the feed. */
export function StoryPreview({ story, locale }: { story: FeedStory; locale: string }) {
  return (
    <Link href={{ pathname: "/insights/[slug]", params: { slug: story.id } }} className={styles.story}>
      <div className={styles.storyStage}>
        <Stage durationInFrames={storyDuration(story.content)} frame={posterFrame(story.content)} className={styles.storyCanvas} label={story.content.title}>
          <StoryComposition story={story.content} locale={locale} tag={story.tag} mode="feed" />
        </Stage>
        <span className={styles.storyPlay} aria-hidden>
          <Play />
        </span>
      </div>
      <p className={styles.storyTitle}>{story.content.title}</p>
    </Link>
  );
}
