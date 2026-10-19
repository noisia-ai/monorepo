"use client";

import { useRef } from "react";
import { Stage } from "@/motion/runtime";
import { HOW_ARCHITECT, HowArchitectComposition, type HowArchitectCopy } from "@/motion/HowArchitectComposition";
import { HOW_EVIDENCE, HowEvidenceComposition, type HowEvidenceCopy } from "@/motion/HowEvidenceComposition";
import { HUB, HUB_FRAMES, SourcesHubComposition, type SourcesHubCopy } from "@/motion/SourcesHubComposition";
import { ONE, ONE_FRAMES, OneConversationComposition, type OneConversationCopy } from "@/motion/OneConversationComposition";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import styles from "./how.module.css";

type Props =
  | { name: "hub"; copy: SourcesHubCopy; label: string }
  | { name: "architect"; copy: HowArchitectCopy; label: string }
  | { name: "evidence"; copy: HowEvidenceCopy; label: string }
  | { name: "one"; copy: OneConversationCopy; label: string };

/** Length and still frame (for reduced motion) of each square piece on the page. */
const SPEC = {
  hub: { frames: HUB_FRAMES, poster: 300, width: HUB.width, height: HUB.height },
  architect: { frames: HOW_ARCHITECT.frames, poster: 360, width: HOW_ARCHITECT.width, height: HOW_ARCHITECT.height },
  evidence: { frames: HOW_EVIDENCE.frames, poster: 260, width: HOW_EVIDENCE.width, height: HOW_EVIDENCE.height },
  one: { frames: ONE_FRAMES, poster: ONE.seg + 60, width: ONE.width, height: ONE.height }
} as const;

/** A square animation in a soft tile: plays while on screen, pausable, still for reduced motion. */
export function HowMotion(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const spec = SPEC[props.name];
  return (
    <div ref={ref} className={styles.tile}>
      <Stage
        durationInFrames={spec.frames}
        width={spec.width}
        height={spec.height}
        playing={playing}
        frame={reduced ? spec.poster : 0}
        label={props.label}
        className={styles.tileStage}
      >
        {props.name === "hub" ? <SourcesHubComposition copy={props.copy} /> : null}
        {props.name === "architect" ? <HowArchitectComposition copy={props.copy} /> : null}
        {props.name === "evidence" ? <HowEvidenceComposition copy={props.copy} /> : null}
        {props.name === "one" ? <OneConversationComposition copy={props.copy} /> : null}
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
    </div>
  );
}
