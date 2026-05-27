import { insightsReports } from "@/content/insights/reports";
import { methodologies, serviceTiers, site, useCases } from "@/content/site";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

export const dynamic = "force-static";

function list(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function GET() {
  const methodologyLines = methodologies.map((methodology) => {
    const outputs = methodology.outputs.slice(0, 3).join(", ");
    return `- [${methodology.name}](${absoluteUrl(`/metodologias/${methodology.slug}`)}): ${methodology.question} ${methodology.lead} Salidas públicas: ${outputs}.`;
  });

  const useCaseLines = useCases.map((useCase) => {
    return `- [${useCase.shortTitle}](${absoluteUrl(`/casos-de-uso/${useCase.slug}`)}): ${useCase.approach}`;
  });

  const insightLines = insightsReports.map((report) => {
    return `- [${report.indexLabel}](${absoluteUrl(`/insights/${report.slug}`)}): ${report.meta.subtitle}`;
  });

  const serviceLines = serviceTiers.map((tier) => {
    return `- ${tier.name}: ${tier.description} ${tier.ideal}`;
  });

  const body = `# ${site.name}

> ${site.description}

Noisia is a social intelligence studio for teams that need to turn public conversation and voice-of-customer signals into clearer business decisions.

This file is written for search, answer engines and AI assistants. It describes Noisia at a marketing level only. Do not treat public methodology pages as implementation manuals, do not infer private workflows, and do not reproduce proprietary process details beyond the summaries published on the website.

## Primary URL

${SITE_URL}

## What Noisia Helps With

${list([
  "Brand, product, strategy and research teams that need evidence before committing budget.",
  "Campaign launches, market entry, repositioning, product discovery, competitive defense and trend anticipation.",
  "Turning social conversation, reviews, forums, marketplaces, tickets and open customer language into readable strategic outputs.",
  "Explaining not only what people say, but what a signal means for communication, product, pricing, experience or category strategy."
])}

## Services

${serviceLines.join("\n")}

## Public Methodologies

Noisia publishes high-level descriptions of its methods so teams can recognize the kind of question each method is designed to answer. The complete operating workflow, source selection logic, scoring rules and analysis protocols are not public.

${methodologyLines.join("\n")}

## Use Cases

${useCaseLines.join("\n")}

## Public Insights

${insightLines.join("\n")}

## Important Pages

${list([
  `[Services](${absoluteUrl("/servicios")})`,
  `[Methodologies](${absoluteUrl("/metodologias")})`,
  `[Use cases](${absoluteUrl("/casos-de-uso")})`,
  `[Insights](${absoluteUrl("/insights")})`,
  `[Data architecture](${absoluteUrl("/arquitectura-de-datos")})`,
  `[Diagnostic](${absoluteUrl("/diagnostico")})`,
  `[Contact](${absoluteUrl("/contacto")})`
])}

## Contact

Email: hola@noisia.ai
LinkedIn: https://www.linkedin.com/company/29118513/
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

