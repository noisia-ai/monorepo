"use client";

import { SquareMotion } from "@/components/motion/SquareMotion";
import { HERO, HeroComposition } from "@/motion/HeroComposition";
import { EnterComposition, LaunchComposition, SLIDE } from "@/motion/HeroSlides";
import { PlanComposition, ReportComposition, StudyComposition } from "@/motion/OfferCompositions";
import { APPROACH_FRAMES, ApproachComposition } from "@/motion/ApproachComposition";
import { KEYWORDS, KeywordsComposition } from "@/motion/KeywordsComposition";
import { TrackComposition } from "@/motion/HeroSlides";
import { JourneyComposition, TrendComposition } from "@/motion/SignalCompositions";
import { UnderstandComposition } from "@/motion/UnderstandComposition";
import { JOURNEY, OFFER, TREND, TREND_CURVE, UNDERSTAND } from "@/motion/sizes";
import type { Diagram } from "@/content/pages/situations";

/** The animated diagram of how a situation gets solved, picked by kind. */
export function SituationMotion({ diagram, label, className }: { diagram: Diagram; label: string; className?: string }) {
  switch (diagram.kind) {
    case "report":
      return (
        <SquareMotion frames={OFFER.frames} poster={260} label={label} className={className}>
          <ReportComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "trend":
      return (
        <SquareMotion frames={TREND.frames} poster={300} label={label} className={className}>
          <TrendComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "journey":
      return (
        <SquareMotion frames={JOURNEY.frames} poster={250} label={label} className={className}>
          <JourneyComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "why":
      return (
        <SquareMotion frames={HERO.durationInFrames} poster={330} label={label} className={className}>
          <HeroComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "launch":
      return (
        <SquareMotion frames={SLIDE.frames} poster={236} label={label} className={className}>
          <LaunchComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "enter":
      return (
        <SquareMotion frames={SLIDE.frames} poster={236} label={label} className={className}>
          <EnterComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "understand":
      return (
        <SquareMotion frames={UNDERSTAND.frames} poster={300} label={label} className={className}>
          <UnderstandComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "study":
      return (
        <SquareMotion frames={OFFER.frames} poster={260} label={label} className={className}>
          <StudyComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "keywords":
      return (
        <SquareMotion frames={KEYWORDS.frames} poster={250} label={label} className={className}>
          <KeywordsComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "approach":
      return (
        <SquareMotion frames={APPROACH_FRAMES.noisia} poster={380} label={label} className={className}>
          <ApproachComposition mode="noisia" copy={diagram.copy} />
        </SquareMotion>
      );
    case "track":
      return (
        <SquareMotion frames={SLIDE.frames} poster={236} label={label} className={className}>
          <TrackComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "trendCurve":
      return (
        <SquareMotion frames={TREND_CURVE.frames} poster={150} label={label} className={className}>
          <TrendComposition copy={diagram.copy} phase="curve" />
        </SquareMotion>
      );
    case "plan":
      return (
        <SquareMotion frames={OFFER.frames} poster={270} label={label} className={className}>
          <PlanComposition copy={diagram.copy} />
        </SquareMotion>
      );
  }
}
