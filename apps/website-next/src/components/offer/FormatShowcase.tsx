"use client";

import { useRef, useState } from "react";
import { MediaVideo, Page, Presentation, StatsUpSquare } from "iconoir-react";
import { Stage } from "@/motion/runtime";
import { FORMAT_CANVAS, FORMAT_FRAMES, FormatMock } from "@/motion/OfferFormats";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import type { FeedStory } from "@/components/feed/types";
import type { FormatKey, FormatMock as FormatMockCopy } from "@/content/pages/offer";
import { PhoneStory } from "./PhoneStory";
import { useWide } from "./useWide";
import styles from "./offer.module.css";

const ICONS = { live: Presentation, document: Page, dashboard: StatsUpSquare, stories: MediaVideo } as const;

type Item = { key: FormatKey; name: string; text: string };

/**
 * The same finding in each format. On desktop, a list of formats beside a large stage (the
 * active one opens to show its description); on phones, a segmented control above the stage
 * and the description below. Each format has its own animated mockup.
 */
export function FormatShowcase({ items, mock, story, label, reply }: { items: Item[]; mock: FormatMockCopy; story?: FeedStory; label: string; reply: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const [active, setActive] = useState(0);
  const current = items[active]!.key;
  const canvas = wide ? FORMAT_CANVAS.wide : FORMAT_CANVAS.tall;

  return (
    <div className={styles.showcase}>
      <div className={styles.showcaseControl}>
        <SegmentedControl options={items.map((item) => ({ key: item.key, label: item.name }))} active={active} onChange={setActive} label={label} />
      </div>

      <div className={styles.rail} role="tablist" aria-label={label}>
        {items.map((item, i) => {
          const Icon = ICONS[item.key];
          return (
            <button key={item.key} type="button" role="tab" aria-selected={i === active} className={styles.railItem} data-active={i === active} onClick={() => setActive(i)}>
              <span className={styles.railIcon} aria-hidden>
                <Icon />
              </span>
              <span className={styles.railBody}>
                <span className={styles.railName}>{item.name}</span>
                <span className={styles.railText}>
                  <span>{item.text}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div ref={ref} className={styles.showcaseStage} data-format={current}>
        <div key={`${current}-${wide}`} className={styles.layer}>
          {current === "stories" ? (
            story ? (
              <PhoneStory story={story} playing={playing} reduced={reduced} reply={reply} />
            ) : null
          ) : (
            <Stage durationInFrames={FORMAT_FRAMES} width={canvas.width} height={canvas.height} playing={playing} frame={reduced ? 220 : 0} label={items[active]!.name} className={styles.showcaseCanvas}>
              <FormatMock kind={current} copy={mock} />
            </Stage>
          )}
        </div>
        {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      </div>

      <div className={styles.showcasePanels}>
        {items.map((item, i) => (
          <p key={item.key} className={styles.showcasePanel} data-active={i === active} aria-hidden={i !== active}>
            {item.text}
          </p>
        ))}
      </div>
    </div>
  );
}
