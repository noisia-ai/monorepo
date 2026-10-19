"use client";

import { useRef } from "react";
import { Stage } from "@/motion/runtime";
import { HUB, HUB_FRAMES, SourcesHubComposition, type SourcesHubCopy } from "@/motion/SourcesHubComposition";
import { ONE, ONE_FRAMES, OneConversationComposition, type OneConversationCopy } from "@/motion/OneConversationComposition";
import { PauseButton } from "./PauseButton";
import { usePlayback } from "./usePlayback";

type Props =
  | { name: "sources-hub"; copy: SourcesHubCopy; label: string }
  | { name: "one-conversation"; copy: OneConversationCopy; label: string };

/** A square motion piece inside a content page, played while on screen. */
export function MotionBlock(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const isHub = props.name === "sources-hub";
  return (
    <div ref={ref} style={{ position: "relative", width: "100%", maxWidth: 620, aspectRatio: "1 / 1", margin: "0 auto" }}>
      <Stage
        durationInFrames={isHub ? HUB_FRAMES : ONE_FRAMES}
        width={isHub ? HUB.width : ONE.width}
        height={isHub ? HUB.height : ONE.height}
        playing={playing}
        frame={reduced ? (isHub ? 300 : ONE.seg + 60) : 0}
        label={props.label}
        className="motion-block-stage"
      >
        {props.name === "sources-hub" ? <SourcesHubComposition copy={props.copy} /> : <OneConversationComposition copy={props.copy} />}
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      <style>{`.motion-block-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}
