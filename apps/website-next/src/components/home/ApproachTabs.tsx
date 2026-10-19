"use client";

import { useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { APPROACH, APPROACH_FRAMES, ApproachComposition, type ApproachCopy } from "@/motion/ApproachComposition";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { ApproachTab } from "@/content/pages/home";
import styles from "./ApproachTabs.module.css";

/** The same conversation, read four ways: a segmented control, the text of each, and its animation. */
export function ApproachTabs({ tabs, motion, answersLabel, label }: { tabs: ApproachTab[]; motion: ApproachCopy; answersLabel: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const [active, setActive] = useState(0);
  const tab = tabs[active]!;
  const frames = APPROACH_FRAMES[tab.key];

  return (
    <div ref={ref} className={styles.wrap}>
      <div className={styles.control}>
        <SegmentedControl options={tabs.map((item) => ({ key: item.key, label: item.tab }))} active={active} onChange={setActive} label={label} accent={0} />
      </div>
      <div className={styles.body}>
        {/* Titles and texts each share one cell, so nothing jumps; on phones the diagram sits between them. */}
        <div className={`${styles.stack} ${styles.titles}`}>
          {tabs.map((item, i) => (
            <h3 key={item.key} className={`${styles.layer} ${styles.title}`} data-active={i === active} aria-hidden={i !== active}>
              {item.title}
            </h3>
          ))}
        </div>
        <div className={`${styles.stack} ${styles.texts}`}>
          {tabs.map((item, i) => (
            <div key={item.key} className={`${styles.layer} ${styles.panel}`} data-active={i === active} aria-hidden={i !== active} role="tabpanel">
              <p className={styles.text}>{item.text}</p>
              <p className={styles.answers} data-key={item.key}>
                <span>{answersLabel}</span>
                {item.answers}
              </p>
            </div>
          ))}
        </div>
        <div className={styles.motion}>
          <Stage
            key={tab.key}
            durationInFrames={frames}
            width={APPROACH.width}
            height={APPROACH.height}
            playing={playing}
            frame={reduced ? frames - 40 : 0}
            label={tab.title}
            className={styles.stage}
          >
            <ApproachComposition mode={tab.key} copy={motion} />
          </Stage>
          {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
        </div>
      </div>
    </div>
  );
}
