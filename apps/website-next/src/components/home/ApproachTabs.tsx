"use client";

import { useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { APPROACH, ApproachComposition, type ApproachCopy, type ApproachMode } from "@/motion/ApproachComposition";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import type { ApproachTab } from "@/content/pages/home";
import styles from "./ApproachTabs.module.css";

/** The same conversation, read four ways: tabs on the left, the animation of each on the right. */
export function ApproachTabs({ tabs, motion, answersLabel }: { tabs: ApproachTab[]; motion: ApproachCopy; answersLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const [active, setActive] = useState(0);
  const tab = tabs[active]!;

  return (
    <div ref={ref} className={styles.wrap}>
      <div className={styles.side}>
        <div className={styles.tabs} role="tablist">
          {tabs.map((item, i) => (
            <button key={item.key} type="button" role="tab" aria-selected={i === active} className={styles.tab} data-key={item.key} onClick={() => setActive(i)}>
              {item.tab}
            </button>
          ))}
        </div>
        <div key={tab.key} className={styles.panel} role="tabpanel">
          <h3 className={styles.title}>{tab.title}</h3>
          <p className={styles.text}>{tab.text}</p>
          <p className={styles.answers} data-key={tab.key}>
            <span>{answersLabel}</span>
            {tab.answers}
          </p>
        </div>
      </div>
      <div className={styles.motion}>
        <Stage
          key={tab.key}
          durationInFrames={APPROACH.frames}
          width={APPROACH.width}
          height={APPROACH.height}
          playing={playing}
          frame={reduced ? 250 : 0}
          label={tab.title}
          className={styles.stage}
        >
          <ApproachComposition mode={tab.key as ApproachMode} copy={motion} />
        </Stage>
        {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      </div>
    </div>
  );
}
