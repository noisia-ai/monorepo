import type { ReactElement } from "react";
// The website's own compositions and copy, unchanged. At bundle time their "./runtime" import is
// pointed at src/engine.ts (Remotion), which exposes the same names: the "two engines" of VIDEO.md §6.
import { ApproachComposition } from "../../../../apps/website-next/src/motion/ApproachComposition";
import { LearnSurveyComposition } from "../../../../apps/website-next/src/motion/LearnSurveyComposition";
import { KeywordsComposition, KEYWORDS } from "../../../../apps/website-next/src/motion/KeywordsComposition";
import { UnderstandComposition } from "../../../../apps/website-next/src/motion/UnderstandComposition";
import { MethodCountComposition, METHOD_COUNT } from "../../../../apps/website-next/src/motion/MethodCountComposition";
import { MethodNumberComposition, METHOD_NUMBER } from "../../../../apps/website-next/src/motion/MethodNumberComposition";
import { MethodWeightComposition, METHOD_WEIGHT } from "../../../../apps/website-next/src/motion/MethodWeightComposition";
import { HowArchitectComposition, HOW_ARCHITECT } from "../../../../apps/website-next/src/motion/HowArchitectComposition";
import { HowEvidenceComposition, HOW_EVIDENCE } from "../../../../apps/website-next/src/motion/HowEvidenceComposition";
import { OneConversationComposition, ONE, ONE_FRAMES } from "../../../../apps/website-next/src/motion/OneConversationComposition";
import { SourcesHubComposition, HUB_FRAMES } from "../../../../apps/website-next/src/motion/SourcesHubComposition";
import { ReportComposition, StudyComposition, PlanComposition } from "../../../../apps/website-next/src/motion/OfferCompositions";
import { APPROACH_FRAMES } from "../../../../apps/website-next/src/motion/ApproachComposition";
import { LEARN_SURVEY } from "../../../../apps/website-next/src/motion/LearnSurveyComposition";
import { UNDERSTAND, OFFER } from "../../../../apps/website-next/src/motion/sizes";
import { compareMotion, surveyMotion } from "../../../../apps/website-next/src/content/pages/compare";
import { howItWorks } from "../../../../apps/website-next/src/content/pages/howItWorks";
import { methodsPage } from "../../../../apps/website-next/src/content/pages/methods";
import { offer } from "../../../../apps/website-next/src/content/pages/offer";
import { socialIntelligence } from "../../../../apps/website-next/src/content/pages/socialIntelligence";

export type Locale = "es" | "en";
type Entry = {
  /** What it says, for whoever picks it for a deck. */
  about: string;
  frames: number;
  /** The frame the website shows as its still: the finished diagram, before the loop fades out. */
  poster: number;
  render: (l: Locale) => ReactElement;
};

/**
 * Square 1080 pieces of noisia.ai that work as credentials slides (COMMERCIAL.md §2.1). Copy comes
 * from the website's content, in Spanish or English, so a deck and the site always say the same.
 */
export const WEBSITE: Record<string, Entry> = {
  "approach-noisia": { about: "Who reads the conversation changes the answer: Noisia's way, from dots to an approved answer with its quote", frames: APPROACH_FRAMES.noisia, poster: APPROACH_FRAMES.noisia - 40, render: (l) => <ApproachComposition mode="noisia" copy={compareMotion[l]} /> },
  "approach-listening": { about: "The same conversation through a listening dashboard: charts, no answer", frames: APPROACH_FRAMES.listening, poster: APPROACH_FRAMES.listening - 40, render: (l) => <ApproachComposition mode="listening" copy={compareMotion[l]} /> },
  "approach-ai": { about: "The same conversation through generative AI: a fluent text that changes every time", frames: APPROACH_FRAMES.ai, poster: APPROACH_FRAMES.ai - 40, render: (l) => <ApproachComposition mode="ai" copy={compareMotion[l]} /> },
  "approach-agency": { about: "The same conversation through an agency: a slow reading of a sample", frames: APPROACH_FRAMES.agency, poster: APPROACH_FRAMES.agency - 40, render: (l) => <ApproachComposition mode="agency" copy={compareMotion[l]} /> },
  survey: { about: "How a survey reads a question: fixed options, ticks, percentages; the why stays out", frames: LEARN_SURVEY.frames, poster: 260, render: (l) => <LearnSurveyComposition copy={surveyMotion[l]} /> },
  keywords: { about: "Keyword search against reading the whole conversation", frames: KEYWORDS.frames, poster: 250, render: (l) => <KeywordsComposition copy={socialIntelligence[l].listening.motion} /> },
  understand: { about: "One mention read in four layers around the person: what drives and what holds back", frames: UNDERSTAND.frames, poster: 300, render: (l) => <UnderstandComposition copy={methodsPage[l].layers.motion} /> },
  "method-count": { about: "Counting versus understanding: the biggest bar opens into three reasons", frames: METHOD_COUNT.frames, poster: 340, render: (l) => <MethodCountComposition copy={methodsPage[l].hero.motion} /> },
  "method-number": { about: "Moving the number versus moving the reason", frames: METHOD_NUMBER.frames, poster: 360, render: (l) => <MethodNumberComposition copy={methodsPage[l].number.motion} /> },
  "method-weight": { about: "How many versus how much it weighs", frames: METHOD_WEIGHT.frames, poster: 330, render: (l) => <MethodWeightComposition copy={methodsPage[l].weight.motion} /> },
  architect: { about: "An expert in the loop approves, merges and drops topics, and signs", frames: HOW_ARCHITECT.frames, poster: 360, render: (l) => <HowArchitectComposition copy={howItWorks[l].architect.motion} /> },
  evidence: { about: "Open evidence: a finding with its confidence level opens the mentions that hold it", frames: HOW_EVIDENCE.frames, poster: 260, render: (l) => <HowEvidenceComposition copy={howItWorks[l].evidence.motion} /> },
  "one-conversation": { about: "One conversation cut the way each team thinks: store, brand topics, competition, the client's framework", frames: ONE_FRAMES, poster: ONE.seg + 60, render: (l) => <OneConversationComposition copy={howItWorks[l].views.motion} /> },
  "sources-hub": { about: "Every source into one reading", frames: HUB_FRAMES, poster: 300, render: (l) => <SourcesHubComposition copy={howItWorks[l].sources.motion} /> },
  "offer-report": { about: "The monthly report: share of conversation and what changed", frames: OFFER.frames, poster: 260, render: (l) => <ReportComposition copy={offer[l].report.motion} /> },
  "offer-study": { about: "The study: from the decision to the method to the recommendations", frames: OFFER.frames, poster: 260, render: (l) => <StudyComposition copy={offer[l].study.motion} /> },
  "offer-plan": { about: "The annual plan: reports always on, studies when a question comes up", frames: OFFER.frames, poster: 270, render: (l) => <PlanComposition copy={offer[l].plan.motion} /> },
};
