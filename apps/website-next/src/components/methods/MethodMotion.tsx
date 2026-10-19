"use client";

import { SquareMotion } from "@/components/motion/SquareMotion";
import { METHOD_COUNT, MethodCountComposition, type MethodCountCopy } from "@/motion/MethodCountComposition";
import { METHOD_NUMBER, MethodNumberComposition, type MethodNumberCopy } from "@/motion/MethodNumberComposition";
import { METHOD_WEIGHT, MethodWeightComposition, type MethodWeightCopy } from "@/motion/MethodWeightComposition";
import { UnderstandComposition, type UnderstandCopy } from "@/motion/UnderstandComposition";
import { UNDERSTAND } from "@/motion/sizes";

type Diagram =
  | { kind: "count"; copy: MethodCountCopy }
  | { kind: "number"; copy: MethodNumberCopy }
  | { kind: "layers"; copy: UnderstandCopy }
  | { kind: "weight"; copy: MethodWeightCopy };

/** The animations of the Methods page; lengths stay on the client so the loop knows its end. */
export function MethodMotion({ diagram, label, className }: { diagram: Diagram; label: string; className?: string }) {
  switch (diagram.kind) {
    case "count":
      return (
        <SquareMotion frames={METHOD_COUNT.frames} poster={340} label={label} className={className}>
          <MethodCountComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "number":
      return (
        <SquareMotion frames={METHOD_NUMBER.frames} poster={360} label={label} className={className}>
          <MethodNumberComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "layers":
      return (
        <SquareMotion frames={UNDERSTAND.frames} poster={300} label={label} className={className}>
          <UnderstandComposition copy={diagram.copy} />
        </SquareMotion>
      );
    case "weight":
      return (
        <SquareMotion frames={METHOD_WEIGHT.frames} poster={330} label={label} className={className}>
          <MethodWeightComposition copy={diagram.copy} />
        </SquareMotion>
      );
  }
}
