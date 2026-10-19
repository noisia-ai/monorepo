"use client";

import { useRef } from "react";
import { Stage } from "@/motion/runtime";
import {
  OfferPlanComposition,
  OfferReportComposition,
  OfferStudyComposition,
  PRODUCT_CANVAS,
  PRODUCT_FRAMES,
  type OfferPlanCopy,
  type OfferReportCopy,
  type OfferStudyCopy
} from "@/motion/OfferProducts";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import { useWide } from "./useWide";
import styles from "./offer.module.css";

type Props =
  | { kind: "report"; copy: OfferReportCopy; label: string }
  | { kind: "study"; copy: OfferStudyCopy; label: string }
  | { kind: "plan"; copy: OfferPlanCopy; label: string };

const POSTER = { report: 96, study: 300, plan: 320 } as const;

/**
 * One product animation: wide on desktop, tall on phones (the composition re-lays itself out
 * for each canvas). Plays while on screen, can be paused, and shows a poster frame for reduced motion.
 */
export function ProductMotion(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const canvas = wide ? PRODUCT_CANVAS.wide : PRODUCT_CANVAS.tall;
  const frames = PRODUCT_FRAMES[props.kind];

  return (
    <div ref={ref} className={styles.productStage} data-kind={props.kind}>
      <Stage
        key={wide ? "wide" : "tall"}
        durationInFrames={frames}
        width={canvas.width}
        height={canvas.height}
        playing={playing}
        frame={reduced ? POSTER[props.kind] : 0}
        label={props.label}
        className={styles.productCanvas}
      >
        {props.kind === "report" ? <OfferReportComposition copy={props.copy} /> : null}
        {props.kind === "study" ? <OfferStudyComposition copy={props.copy} /> : null}
        {props.kind === "plan" ? <OfferPlanComposition copy={props.copy} /> : null}
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
    </div>
  );
}
