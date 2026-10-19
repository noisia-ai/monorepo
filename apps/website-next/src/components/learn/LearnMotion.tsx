"use client";

import { SquareMotion } from "@/components/motion/SquareMotion";
import { APPROACH_FRAMES, ApproachComposition, type ApproachCopy, type ApproachMode } from "@/motion/ApproachComposition";
import { HERO, HeroComposition, type HeroCopy } from "@/motion/HeroComposition";
import { KEYWORDS, KeywordsComposition, type KeywordsCopy } from "@/motion/KeywordsComposition";
import { HUB_FRAMES, SourcesHubComposition, type SourcesHubCopy } from "@/motion/SourcesHubComposition";
import { UnderstandComposition, type UnderstandCopy } from "@/motion/UnderstandComposition";
import { LEARN_SURVEY, LearnSurveyComposition, type LearnSurveyCopy } from "@/motion/LearnSurveyComposition";
import { UNDERSTAND } from "@/motion/sizes";

/** Every animation the Learn pages use, picked by kind; lengths stay on the client side. */
export type LearnDiagram =
  | { kind: "hero"; copy: HeroCopy }
  | { kind: "keywords"; copy: KeywordsCopy }
  | { kind: "sources"; copy: SourcesHubCopy }
  | { kind: "understand"; copy: UnderstandCopy }
  | { kind: "approach"; mode: ApproachMode; copy: ApproachCopy }
  | { kind: "survey"; copy: LearnSurveyCopy };

export function LearnMotion({ diagram, label, className }: { diagram: LearnDiagram; label: string; className?: string }) {
  switch (diagram.kind) {
    case "hero":
      return (
        <SquareMotion frames={HERO.durationInFrames} poster={330} label={label} className={className}>
          <HeroComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "keywords":
      return (
        <SquareMotion frames={KEYWORDS.frames} poster={250} label={label} className={className}>
          <KeywordsComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "sources":
      return (
        <SquareMotion frames={HUB_FRAMES} poster={300} label={label} className={className}>
          <SourcesHubComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "understand":
      return (
        <SquareMotion frames={UNDERSTAND.frames} poster={300} label={label} className={className}>
          <UnderstandComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "approach": {
      const frames = APPROACH_FRAMES[diagram.mode];
      return (
        <SquareMotion frames={frames} poster={frames - 40} label={label} className={className}>
          <ApproachComposition mode={diagram.mode} copy={diagram.copy} />
        </SquareMotion>
      );
    }
    case "survey":
      return (
        <SquareMotion frames={LEARN_SURVEY.frames} poster={260} label={label} className={className}>
          <LearnSurveyComposition copy={diagram.copy} />
        </SquareMotion>
      );
  }
}
