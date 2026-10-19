import type { ComponentType, SVGProps } from "react";
import {
  Activity,
  ArrowUnion,
  ChatBubbleCheck,
  CheckSquare,
  Sparks,
  StatsReport,
  Airplane,
  AntennaSignal,
  Bank,
  Book,
  Car,
  ChatBubbleQuestion,
  Check,
  CoffeeCup,
  Compass,
  Cookie,
  Database,
  DiceFive,
  EditPencil,
  Flower,
  GraduationCap,
  Group,
  HomeSimpleDoor,
  Industry,
  LightBulb,
  Mail,
  CinemaOld,
  Page,
  Rocket,
  Scissor,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SmartphoneDevice,
  Tools,
  User,
  Xmark
} from "iconoir-react";
import type { IndustryIcon, MomentKey } from "@/content/pages/industries";
import type { CompareKind } from "@/content/pages/compare";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export const INDUSTRY_ICONS: Record<IndustryIcon, Icon> = {
  food: CoffeeCup,
  betting: DiceFive,
  mobility: Car,
  telecom: AntennaSignal,
  banking: Bank,
  retail: ShoppingBag,
  tech: SmartphoneDevice,
  fashion: Scissor,
  beauty: Flower,
  home: HomeSimpleDoor,
  entertainment: CinemaOld,
  education: GraduationCap,
  travel: Airplane,
  b2b: Industry
};

export const MOMENT_ICONS: Record<MomentKey, Icon> = {
  monitorear: Activity,
  defender: Shield,
  optimizar: Tools,
  lanzar: Rocket,
  entrar: Compass,
  innovar: LightBulb
};

/** Generic icons the Learn pages use for sections, lists and legal topics. */
export const LEARN_ICONS = {
  check: Check,
  no: Xmark,
  question: ChatBubbleQuestion,
  data: Database,
  user: User,
  page: Page,
  people: Group,
  shield: ShieldCheck,
  rights: EditPencil,
  cookie: Cookie,
  mail: Mail,
  book: Book
} satisfies Record<string, Icon>;

export type LearnIcon = keyof typeof LEARN_ICONS;

export const COMPARE_ICONS: Record<CompareKind | "us" | "both", Icon> = {
  listening: StatsReport,
  ai: Sparks,
  survey: CheckSquare,
  agency: Group,
  us: ChatBubbleCheck,
  both: ArrowUnion
};
