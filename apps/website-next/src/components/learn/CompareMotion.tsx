"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LearnMotion, type LearnDiagram } from "./LearnMotion";
import styles from "./compare.module.css";

type Side = { name: string; caption: string; diagram: LearnDiagram };

/**
 * The same conversation read by the other option and by Noisia. Desktop shows both side by
 * side; phones show one at a time behind a segmented control so each square stays large.
 */
export function CompareMotion({ them, us, label }: { them: Side; us: Side; label: string }) {
  const [active, setActive] = useState(1);
  const sides = [them, us];
  return (
    <div className={styles.motionWrap}>
      <div className={styles.motionControl}>
        <SegmentedControl options={sides.map((side, i) => ({ key: String(i), label: side.name }))} active={active} onChange={setActive} label={label} accent={1} />
      </div>
      <div className={styles.motionPair}>
        {sides.map((side, i) => (
          <figure key={i} className={styles.motionSide} data-active={i === active} data-us={i === 1}>
            <figcaption className={styles.motionCaption}>
              <span className={styles.motionName}>{side.name}</span>
              <span className={styles.motionText}>{side.caption}</span>
            </figcaption>
            {/* Remount on toggle so the newly shown square measures itself and starts playing. */}
            <LearnMotion key={`${i}-${active}`} diagram={side.diagram} label={`${side.name}: ${side.caption}`} className={styles.motionSquare} />
          </figure>
        ))}
      </div>
    </div>
  );
}
