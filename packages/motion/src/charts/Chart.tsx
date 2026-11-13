import type { Chart as ChartSpec } from "../schema";
import { Bars } from "./Bars";
import { BigNumber } from "./BigNumber";
import { Ring } from "./Ring";
import { Split } from "./Split";

/** One door to the chart library, driven by a chart spec in the piece JSON. */
export function Chart({ chart, locale, delay = 4 }: { chart: ChartSpec; locale: string; delay?: number }) {
  switch (chart.kind) {
    case "ring":
      return <Ring value={chart.value} label={chart.label} tone={chart.tone} locale={locale} delay={delay} size={360} />;
    case "bars":
      // Four bars or more get thinner, so the chart and its note leave room for the cards below.
      return <Bars items={chart.items} unit={chart.unit} locale={locale} delay={delay} size={chart.items.length >= 4 ? 0.7 : 0.82} />;
    case "number":
      return <BigNumber value={chart.value} from={chart.from} suffix={chart.suffix} label={chart.label} dots={chart.dots} locale={locale} delay={delay} />;
    case "split":
      return <Split left={chart.left} right={chart.right} locale={locale} delay={delay} size={0.9} />;
  }
}
