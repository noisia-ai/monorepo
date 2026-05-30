import type { PublicTbFinding, TbDecisionFieldNode } from "@/lib/signal/contracts";

const LAYER_RING: Record<string, number> = {
  personal: 0.34,
  psicologico: 0.46,
  social: 0.62,
  cultural: 0.78
};

const POLARITY_ANGLE: Record<string, number> = {
  trigger: -38,
  mixed: 0,
  barrier: 38
};

export function buildTbDecisionFieldNodes(findings: PublicTbFinding[]): TbDecisionFieldNode[] {
  const byLayer = new Map<string, PublicTbFinding[]>();
  for (const finding of findings) {
    const rows = byLayer.get(finding.layer) ?? [];
    rows.push(finding);
    byLayer.set(finding.layer, rows);
  }

  const nodes = findings.map((finding) => {
    const layerRows = byLayer.get(finding.layer) ?? [];
    const layerIndex = Math.max(0, layerRows.findIndex((item) => item.finding_id === finding.finding_id));
    const spread = (layerIndex - (layerRows.length - 1) / 2) * 11;
    const angle = ((POLARITY_ANGLE[finding.polarity] ?? 0) + spread - 90) * (Math.PI / 180);
    const actionability = computeActionabilityScore(finding);
    const baseRing = LAYER_RING[finding.layer] ?? 0.56;
    const radiusFromCenter = Math.max(0.16, Math.min(0.86, baseRing - actionability * 0.08));

    return {
      ...finding,
      x: 50 + Math.cos(angle) * radiusFromCenter * 48,
      y: 52 + Math.sin(angle) * radiusFromCenter * 44,
      radius: 7 + Math.min(18, Math.sqrt(Math.max(1, finding.frequency_mentions)) * 1.9 + finding.composite_score),
      actionability_score: Math.round(actionability * 100)
    };
  });

  return separateCollisions(nodes);
}

function computeActionabilityScore(finding: PublicTbFinding) {
  const mobility =
    finding.mobility === "movible_por_marca"
      ? 1
      : finding.mobility === "parcialmente_movible"
        ? 0.58
        : 0.18;
  const confidence = finding.confidence === "alta" ? 1 : finding.confidence === "media" ? 0.68 : 0.36;
  const score = Math.max(0, Math.min(5, finding.composite_score)) / 5;
  const evidence = Math.min(1, Math.log10(Math.max(1, finding.evidence_count)) / 2);
  return Math.max(0, Math.min(1, mobility * 0.36 + confidence * 0.22 + score * 0.32 + evidence * 0.1));
}

function separateCollisions(nodes: TbDecisionFieldNode[]) {
  const adjusted = nodes.map((node) => ({ ...node }));
  const minGap = 6.5;

  for (let pass = 0; pass < 18; pass += 1) {
    for (let i = 0; i < adjusted.length; i += 1) {
      for (let j = i + 1; j < adjusted.length; j += 1) {
        const a = adjusted[i];
        const b = adjusted[j];
        if (!a || !b) continue;
        const ar = Math.max(4.5, a.radius / 2.4);
        const br = Math.max(4.5, b.radius / 2.4);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        const target = ar + br + minGap;
        if (distance >= target) continue;

        const push = (target - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x = clampNode(a.x - nx * push, ar);
        a.y = clampNode(a.y - ny * push, ar);
        b.x = clampNode(b.x + nx * push, br);
        b.y = clampNode(b.y + ny * push, br);
      }
    }
  }

  return adjusted;
}

function clampNode(value: number, radius: number) {
  return Math.max(8 + radius, Math.min(92 - radius, value));
}
