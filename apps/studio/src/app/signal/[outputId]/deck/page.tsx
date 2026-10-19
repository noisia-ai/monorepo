import { notFound, redirect } from "next/navigation";

import { DeckRuntime } from "@/components/signal/deck/DeckRuntime";
import { DeckSlides } from "@/components/signal/deck/DeckSlides";
import { requirePortalUser } from "@/lib/auth/guards";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { loadPublishedSignalOverview } from "@/lib/data-os/published-signal-overview";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness
} from "@/lib/data-os/signal-serving";
import { adaptTbSignalPayload } from "@/lib/signal/adapters/tb";
import { hasSignalServingContract } from "@/lib/signal/semantics";
import { buildTbDecisionFieldNodes } from "@/lib/signal/tb-decision-field";

import "./deck.css";

export const dynamic = "force-dynamic";

type Lang = "en" | "es";

const LABELS = {
  en: {
    downloadPdf: "Download PDF",
    present: "Present",
    hint: "Toggle fullscreen",
    share: "Share",
    shareTitle: "Share this report",
    shareIntro: "Copy the deck link or invite someone by email. New invitees enter as Client Viewer for this study's organization.",
    shareLink: "Report link",
    copy: "Copy",
    copied: "Copied",
    inviteEmail: "Invite by email",
    invitePlaceholder: "name@company.com",
    inviteSend: "Send invite",
    inviteSending: "Sending...",
    inviteSent: "Invite sent. They will get the report by email.",
    inviteExists: "Invite already existed. We resent the report email.",
    inviteSavedNoEmail: "Access was saved, but email is not configured yet. Copy the report link and send it manually for now.",
    inviteError: "We couldn't send the invite.",
    logo: "Logo",
    logoTitle: "Replace the logo",
    logoIntro: "Upload one version for each background. PNG or SVG, under 1MB.",
    logoLight: "For light slides",
    logoLightHint: "A dark logo (shows on white)",
    logoDark: "For dark slides",
    logoDarkHint: "A light logo (shows on dark covers)",
    upload: "Upload",
    done: "Replaced",
    logoTooBig: "That file is over 1MB. Please upload a logo under 1MB.",
    logoBadType: "Please upload a PNG or SVG file.",
  },
  es: {
    downloadPdf: "Descargar PDF",
    present: "Presentar",
    hint: "Pantalla completa",
    share: "Compartir",
    shareTitle: "Compartir este reporte",
    shareIntro: "Copia el link del deck o invita a alguien por correo. Los nuevos invitados entran como Cliente lector en la organización del estudio.",
    shareLink: "Link del reporte",
    copy: "Copiar",
    copied: "Copiado",
    inviteEmail: "Invitar por correo",
    invitePlaceholder: "nombre@empresa.com",
    inviteSend: "Enviar invitación",
    inviteSending: "Enviando...",
    inviteSent: "Invitación enviada. Recibirá el reporte por correo.",
    inviteExists: "La invitación ya existía. Reenviamos el correo del reporte.",
    inviteSavedNoEmail: "El acceso quedó guardado, pero el correo todavía no está configurado. Copia el link y envíalo manualmente por ahora.",
    inviteError: "No pudimos enviar la invitación.",
    logo: "Logo",
    logoTitle: "Reemplazar el logo",
    logoIntro: "Sube una versión para cada fondo. PNG o SVG, menos de 1MB.",
    logoLight: "Para slides claras",
    logoLightHint: "Un logo oscuro (se ve sobre blanco)",
    logoDark: "Para slides oscuras",
    logoDarkHint: "Un logo claro (se ve sobre portadas oscuras)",
    upload: "Subir",
    done: "Reemplazado",
    logoTooBig: "El archivo supera 1MB. Sube un logo de menos de 1MB.",
    logoBadType: "Sube un archivo PNG o SVG.",
  },
} satisfies Record<Lang, Record<string, string>>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export default async function SignalDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ outputId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { outputId } = await params;
  const { lang: langParam } = await searchParams;
  const lang: Lang = langParam === "en" ? "en" : "es";

  const session = await requirePortalUser(`/signal/${outputId}/deck?lang=${lang}`);
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) notFound();

  const strictRelational = hasSignalServingContract(output.manifest);
  const relationalOverview = strictRelational && output.tbAnalysisId && output.snapshotId
    ? await loadDeckRelationalOverview({
        analysisId: output.tbAnalysisId,
        corpusId: output.studyCorpusId,
        outputId: output.id,
        snapshotId: output.snapshotId
      })
    : null;
  if (strictRelational && !relationalOverview) redirect(`/signal/${outputId}`);

  const rawVm = adaptTbSignalPayload(output.payload);
  const live = asRecord((output.payload as Record<string, unknown>)?.live_intelligence);
  const liveIntelligence = live.status
    ? {
        status: String(live.status),
        signals: Number(live.signals ?? 0),
        observations: Number(live.observations ?? 0),
        evidence: Number(live.evidence ?? 0)
      }
    : null;
  const aggregates = asRecord((output.payload as Record<string, unknown>)?.aggregates);
  const corpusAgg = asRecord(aggregates.corpus);
  const corpusWindow = asRecord(corpusAgg.window);
  const corpusTotal = relationalOverview?.corpus.total_mentions ?? Number(corpusAgg.total_mentions ?? 0);
  const windowMonths = relationalOverview
    ? relationalOverview.volume_timeline.length
    : Number(corpusWindow.months ?? 0);

  const brandLabel = output.brandName ?? output.brandFallbackName ?? output.themeName ?? rawVm.report.brand_name;
  const vm = {
    ...rawVm,
    decisionFieldNodes: relationalOverview
      ? buildTbDecisionFieldNodes(relationalOverview.findings)
      : rawVm.decisionFieldNodes,
    findings: relationalOverview?.findings ?? rawVm.findings,
    actionCards: relationalOverview?.action_studio ?? rawVm.actionCards,
    strategicOpportunities: relationalOverview
      ? relationalOverview.opportunities
      : rawVm.strategicOpportunities,
    report: {
      ...rawVm.report,
      brand_name: brandLabel
    }
  };
  const methodologyName = output.methodologyName ?? vm.report.methodology_name;

  const dateFmt = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-MX", {
    year: "numeric",
    month: "short",
  });
  const dateLabel = output.publishedAt ? dateFmt.format(new Date(output.publishedAt)) : String(new Date().getFullYear());
  const windowLabel =
    windowMonths > 0 ? (lang === "en" ? `${windowMonths} months` : `${windowMonths} meses`) : null;

  return (
    <div className="deck-shell">
      <DeckRuntime labels={LABELS[lang]} outputId={outputId} lang={lang}>
        <DeckSlides
          vm={vm}
          lang={lang}
          meta={{ brandLabel, methodologyName, windowLabel, corpusTotal, dateLabel, liveIntelligence }}
        />
      </DeckRuntime>
    </div>
  );
}

async function loadDeckRelationalOverview(args: {
  analysisId: string;
  corpusId: string;
  outputId: string;
  snapshotId: string;
}) {
  try {
    const readiness = await getSignalServingReadiness({
      analysisId: args.analysisId,
      outputId: args.outputId,
      requireDataRefs: true,
      snapshotId: args.snapshotId
    });
    if (!assessSignalServingReadiness(readiness).ready) return null;
    return await loadPublishedSignalOverview({
      analysisId: args.analysisId,
      corpusId: args.corpusId,
      outputId: args.outputId,
      requireGovernedRef: true,
      snapshotId: args.snapshotId
    });
  } catch (error) {
    console.error("[signal-deck] relational serving failed", { error, outputId: args.outputId });
    return null;
  }
}
