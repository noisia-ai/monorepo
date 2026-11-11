import { Composition } from "remotion";
import { deckSchema, socialSchema, storySchema, studySchema, timingSchema, type DeckPiece, type SocialPiece, type StudyPiece, type Timing } from "./schema";
import { VERTICAL } from "./brand/theme";
import { Clip, clipDuration, type ClipProps } from "./clip/Clip";
import { Social, socialDuration, type SocialProps } from "./social/Social";
import { Study, type StudyProps } from "./study/Study";
import { Deck, deckFrames, type DeckProps } from "./deck/Deck";
import stories from "../../../apps/website-next/src/content/stories/public/the-mexican-home.json";
import socialExample from "../examples/social.json";
import studyExample from "../examples/study.json";
import studyTiming from "../examples/study.timing.json";
import deckExample from "../examples/deck-hub.json";

/**
 * The four formats of packages/pitch-kit/VIDEO.md §1. Every composition validates its piece with
 * zod in calculateMetadata, so a bad JSON fails before a single frame renders.
 */
const parsedStory = storySchema.parse(stories[0]);

export function Root() {
  return (
    <>
      <Composition
        id="Clip"
        component={Clip}
        {...VERTICAL}
        durationInFrames={1}
        defaultProps={{ title: parsedStory.es.title, scenes: parsedStory.es.scenes, locale: "es", tag: undefined, showTitle: true } as ClipProps}
        calculateMetadata={({ props }) => ({ durationInFrames: clipDuration(props.scenes) })}
      />
      <Composition
        id="Social"
        component={Social}
        {...VERTICAL}
        durationInFrames={1}
        defaultProps={{ piece: socialExample as unknown as SocialPiece, timing: null } as SocialProps}
        calculateMetadata={({ props }) => {
          const piece = socialSchema.parse(props.piece);
          const timing = props.timing ? timingSchema.parse(props.timing) : null;
          return { durationInFrames: socialDuration(piece, timing), props: { piece, timing } };
        }}
      />
      <Composition
        id="Study"
        component={Study}
        {...VERTICAL}
        durationInFrames={1}
        defaultProps={{ piece: studyExample as unknown as StudyPiece, timing: studyTiming as unknown as Timing } as StudyProps}
        calculateMetadata={({ props }) => {
          const piece = studySchema.parse(props.piece);
          const timing = timingSchema.parse(props.timing);
          if (timing.scenes.length !== piece.scenes.length) throw new Error("timing.json does not match the piece: run builders/audio.py again");
          return { durationInFrames: timing.total, props: { piece, timing } };
        }}
      />
      <Composition
        id="Deck"
        component={Deck}
        width={800}
        height={600}
        fps={30}
        durationInFrames={1}
        defaultProps={{ piece: deckExample as unknown as DeckPiece, rotate: 0 } as DeckProps}
        calculateMetadata={({ props }) => {
          const piece = deckSchema.parse(props.piece);
          return { durationInFrames: deckFrames(piece), width: piece.box.w, height: piece.box.h, props: { ...props, piece } };
        }}
      />
    </>
  );
}
