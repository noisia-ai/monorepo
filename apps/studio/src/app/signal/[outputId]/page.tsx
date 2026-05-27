import Link from "next/link";
import { notFound } from "next/navigation";

import { SessionBadge } from "@/components/layout/SessionBadge";
import { SignalDashboardCharts } from "@/components/signal/SignalDashboardCharts";
import { SignalTriggerExplorer } from "@/components/signal/SignalTriggerExplorer";
import { Icon } from "@/components/ui/Icon";
import { requirePortalUser } from "@/lib/auth/guards";
import { getSignalOutputForUser } from "@/lib/data/signal";
import type { SignalModuleKey } from "@/lib/signal/manifest";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

/* ============================================================
   Noisia Signal — Client report.
   Editorial cover + dashboard charts + verbatim explorer.
   Container is fluid up to 1480px so it fills 16" MacBook canvas.
   ============================================================ */

export default async function SignalOutputPage({
  params,
}: {
  params: Promise<{ outputId: string }>;
}) {
  const { outputId } = await params;
  const session = await requirePortalUser(`/signal/${outputId}`);
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) notFound();

  const payload = asRecord(output.payload);
  const manifest = asRecord(output.manifest);
  const metrics = asRecord(payload.metrics);
  const overview = asRecord(payload.overview);
  const actions = asRecord(payload.actions);
  const quality = asRecord(payload.quality);
  const limitations = asRecord(payload.limitations);
  const aggregates = asRecord(payload.aggregates);
  const barriers = arrayValue(payload.barriers).map(asRecord);
  const triggers = arrayValue(payload.triggers).map(asRecord);
  const structuralNotes = arrayValue(actions.structural_notes).map(asRecord);
  const topBarriers = arrayValue(overview.top_barriers).map(asRecord);
  const enabledModules = moduleOrder.filter((key) => manifest[key] !== false);
  const brandLabel = output.brandName ?? output.brandFallbackName ?? "Marca";
  const bestMove = asRecord(actions.best_move);
  const fmtNum = (v: unknown) => new Intl.NumberFormat("es-MX").format(Number(v ?? 0));

  // Aggregates (already calculated in data layer)
  const corpusAgg = asRecord(aggregates.corpus);
  const corpusWindow = asRecord(corpusAgg.window);
  const corpusTotal = Number(corpusAgg.total_mentions ?? 0);
  const windowMonths = Number(corpusWindow.months ?? 0);
  const polarityDist = arrayValue(aggregates.polarity_distribution).map(asRecord);
  const layerDist = arrayValue(aggregates.layer_distribution).map(asRecord);
  const mobilityDist = arrayValue(aggregates.mobility_distribution).map(asRecord);
  const platformDist = arrayValue(aggregates.platform_distribution).map(asRecord);
  const volumeTimeline = arrayValue(aggregates.volume_timeline).map(asRecord);
  const findingsScatter = arrayValue(aggregates.findings_scatter).map(asRecord);
  const topVoice = arrayValue(aggregates.top_findings_by_voice).map(asRecord);
  const mentionsSample = arrayValue(aggregates.mentions_sample).map(asRecord);

  return (
    <div className="signal-report">
      {/* Sticky aside nav */}
      <aside className="signal-aside">
        <Link href="/signal" className="signal-aside-logo" aria-label="Volver a Signal">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/logo_black.svg" alt="Noisia" width={92} height={32} />
          <span>Signal</span>
        </Link>
        <nav className="signal-aside-nav" aria-label="Secciones del reporte">
          <a className="is-active" href="#overview">
            <Icon name="platform" size={14} />
            Dashboard
          </a>
          {enabledModules.filter((k) => k !== "overview").map((key) => (
            <a href={`#${key}`} key={key}>
              {moduleLabels[key]}
            </a>
          ))}
          <a href="#voces">Voces del corpus</a>
        </nav>
      </aside>

      <main className="signal-main">
        {/* TOP UTILITY BAR — period chip + profile */}
        <div className="signal-topbar">
          <div className="signal-topbar-left">
            <span className="signal-method-mark"><span>T</span><i>&amp;</i><b>B</b></span>
            <div className="signal-report-title">
              <strong>{brandLabel}</strong>
              <small>{output.methodologyName ?? "Triggers & Barriers"}</small>
            </div>
          </div>
          <div className="signal-topbar-right">
            <span className="signal-period-pill">
              <Icon name="calendar" size={14} />
              {windowMonths > 0 ? `Corte publicado · ${windowMonths} meses` : "Snapshot publicado"}
            </span>
            <SessionBadge user={session.appUser} compact />
            <button className="signal-icon-btn" type="button" aria-label="Más opciones">
              <Icon name="sort" size={14} />
            </button>
          </div>
        </div>

        <SignalDashboardCharts
          brandLabel={brandLabel}
          corpusTotal={corpusTotal}
          findingsScatter={findingsScatter}
          layerDist={layerDist}
          methodologyName={output.methodologyName ?? "Triggers & Barriers"}
          metrics={{
            findingsTotal: Number(metrics.findings_total ?? 0),
            barriersTotal: Number(metrics.barriers_total ?? 0),
            triggersTotal: Number(metrics.triggers_total ?? 0),
            movableTotal: Number(metrics.movable_total ?? 0),
          }}
          mobilityDist={mobilityDist}
          platformDist={platformDist}
          polarityDist={polarityDist}
          topBarriers={topBarriers}
          topVoice={topVoice}
          volumeTimeline={volumeTimeline}
          windowLabel={
            windowMonths > 0
              ? `${fmtDateRange(corpusWindow.start, corpusWindow.end)} · ${windowMonths} meses`
              : "Snapshot publicado"
          }
        />

        {/* OVERVIEW — top barriers as editorial kicker cards */}
        {manifest.overview !== false && (
          <section className="signal-section" id="overview-detail">
            <SectionHead eyebrow="Top barreras" title="Lo que está frenando la decisión" />
            <TopBarriersPanel
              barriers={barriers}
              mentionsSample={mentionsSample}
              topBarriers={topBarriers}
              topVoice={topVoice}
            />
          </section>
        )}

        {/* TENSION MAP */}
        {manifest.tension_map !== false && (
          <section className="signal-section" id="tension_map">
            <SectionHead eyebrow="Visualización" title="Mapa de tensión" />
            <TensionMap
              findingsScatter={findingsScatter}
              triggers={triggers}
              barriers={barriers}
              barriersTotal={Number(metrics.barriers_total ?? barriers.length)}
              triggersTotal={Number(metrics.triggers_total ?? triggers.length)}
            />
          </section>
        )}

        {/* ACTIONS */}
        {manifest.actions !== false && (
          <section className="signal-section" id="actions">
            <SectionHead eyebrow="Plan de acción" title="La mejor jugada y alternativas" />
            <BestMoveCard
              mentions={mentionsSample.filter((mention) => stringValue(mention.finding_id) === stringValue(bestMove.finding_id))}
              move={bestMove}
            />
            {arrayValue(actions.alternatives).length > 0 && (
              <>
                <p className="signal-subhead">Alternativas priorizadas</p>
                <ul className="signal-action-list">
                  {arrayValue(actions.alternatives).map((alt, i) => {
                    const a = asRecord(alt);
                    return <ActionRow key={stringValue(a.id) || String(i)} item={a} rank={i + 2} />;
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {/* BARRIERS */}
        {manifest.barriers !== false && (
          <section className="signal-section" id="barriers">
            <SectionHead
              eyebrow="Barreras movibles"
              title="Anexo operativo de fricciones"
              sub="La lectura ejecutiva ya priorizó arriba. Este bloque conserva cada barrera como unidad accionable para seguimiento interno."
            />
            <div className="signal-finding-grid">
              {barriers.map((b, i) => (
                <FindingCard key={stringValue(b.id) || String(i)} item={b} />
              ))}
            </div>
          </section>
        )}

        {/* TRIGGERS */}
        {manifest.triggers !== false && (
          <section className="signal-section" id="triggers">
            <SectionHead eyebrow="Señales positivas" title="Triggers a aprovechar" />
            <SignalTriggerExplorer
              corpusTotal={corpusTotal}
              mentionsSample={mentionsSample}
              triggers={triggers}
              volumeTimeline={volumeTimeline}
            />
          </section>
        )}

        {/* STRUCTURAL */}
        {structuralNotes.length > 0 && (
          <section className="signal-section">
            <SectionHead
              eyebrow="Contexto estructural"
              title="Barreras para alinear, no prometer"
              sub="Códigos culturales o sistémicos que no se mueven con campañas. La marca debe alinearse con la narrativa o construir desde whitespace alternativo."
            />
            <div className="signal-finding-grid signal-finding-grid--two">
              {structuralNotes.map((note, i) => (
                <FindingCard
                  key={stringValue(note.id) || String(i)}
                  item={note}
                  variant="structural"
                />
              ))}
            </div>
          </section>
        )}

        {/* FRICTION HEATMAP */}
        {manifest.friction_heatmap !== false && (
          <section className="signal-section" id="friction_heatmap">
            <SectionHead
              eyebrow="Journey"
              title="Mapa de fricción"
              sub="Dónde en el customer journey duele más cada barrera. Intensidad calculada por matching de lenguaje sobre verbatims trazables."
            />
            <FrictionHeatmap barriers={barriers.slice(0, 8)} />
          </section>
        )}

        {/* MENTIONS BROWSER — voces del corpus */}
        {mentionsSample.length > 0 && (
          <section className="signal-section" id="voces">
            <SectionHead
              eyebrow="Voces del corpus"
              title="Lo que están diciendo, en sus propias palabras"
              sub={`Muestra trazable de ${mentionsSample.length} verbatims (de ${fmtNum(corpusTotal)} menciones del snapshot). Cada cita está vinculada a su finding.`}
            />
            <ul className="mentions-feed">
              {mentionsSample.map((m, i) => (
                <MentionCard key={stringValue(m.mention_id) || String(i)} item={m} />
              ))}
            </ul>
          </section>
        )}

        {/* PLACEHOLDERS */}
        {manifest.stream_graph !== false && (
          <section className="signal-section" id="stream_graph">
            <SectionHead eyebrow="Evolución" title="Stream cultural" />
            <FindingNotice
              icon="wave"
              title="Vista de evolución semanal por hallazgo en construcción."
              body={stringValue(limitations.stream_graph) || "Esta vista contará cuándo nacen, crecen o se apagan las narrativas del corpus."}
            />
          </section>
        )}

        {manifest.compare !== false && (
          <section className="signal-section" id="compare">
            <SectionHead eyebrow="Benchmark" title="Comparativo competitivo" />
            <FindingNotice
              icon="layers"
              title="On hold hasta tener corpora competidores aprobados."
              body={stringValue(limitations.compare) || "Signal no inventa benchmarks. Para comparar contra otras aseguradoras se requiere que cada marca tenga su corpus T&B aprobado."}
            />
          </section>
        )}

        {manifest.chat !== false && (
          <section className="signal-section" id="chat">
            <SectionHead eyebrow="Pregúntale al corte" title="Chat sobre este reporte" />
            <FindingNotice
              icon="message"
              title="Chat client-safe en construcción."
              body="Sólo podrá consultar el snapshot publicado. No abre acceso a tu corpus completo ni a otros estudios."
            />
          </section>
        )}

        {/* META FOOTER */}
        <footer className="signal-meta">
          <div className="signal-meta-block">
            <p className="signal-eyebrow signal-eyebrow--quiet">Control de calidad</p>
            <p>
              {Number(quality.gates_total ?? 0)} checks ejecutados ·{" "}
              {arrayValue(quality.failed).length === 0 ? (
                <span className="signal-meta-good">todos pasaron</span>
              ) : (
                <span className="signal-meta-warn">
                  {arrayValue(quality.failed).length} con observación
                </span>
              )}
            </p>
            {arrayValue(quality.failed).map((f, i) => {
              const r = asRecord(f);
              return (
                <p key={i} className="signal-meta-warn-line">
                  <Icon name="alert" size={12} /> {stringValue(r.notes) || stringValue(r.name)}
                </p>
              );
            })}
          </div>
          <div className="signal-meta-block">
            <p className="signal-eyebrow signal-eyebrow--quiet">Limitaciones declaradas</p>
            {Object.entries(limitations).length === 0 ? (
              <p>Sin limitaciones declaradas en este corte.</p>
            ) : (
              <ul className="signal-meta-list">
                {Object.entries(limitations).map(([key, value]) => (
                  <li key={key}>
                    <strong>{prettifyKey(key)}:</strong> {String(value)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <header className="signal-sec-head">
      <p className="signal-eyebrow">{eyebrow}</p>
      <h2 className="signal-sec-title">{title}</h2>
      {sub && <p className="signal-sec-sub">{sub}</p>}
    </header>
  );
}

/* === Kicker / cards already had implementations === */

function TopBarriersPanel({
  topBarriers,
  barriers,
  topVoice,
  mentionsSample,
}: {
  topBarriers: JsonRecord[];
  barriers: JsonRecord[];
  topVoice: JsonRecord[];
  mentionsSample: JsonRecord[];
}) {
  return (
    <ol className="signal-kickers signal-kickers--executive">
      {topBarriers.slice(0, 5).map((barrier, i) => {
        const id = stringValue(barrier.id);
        const detail = barriers.find((b) => stringValue(b.finding_id) === id) ?? {};
        const voice = topVoice.find((v) => stringValue(v.finding_id) === id) ?? {};
        const samples = mentionsSample.filter((m) => stringValue(m.finding_id) === id);
        const channels = summarizeChannels(samples);
        return (
          <li className="signal-kicker signal-kicker--rich" key={`${barrier.id ?? i}`}>
            <span className="signal-kicker-num">{String(i + 1).padStart(2, "0")}</span>
            <div className="signal-kicker-body">
              <div className="signal-kicker-main">
                <h3 className="signal-kicker-label">{stringValue(barrier.label) || "Sin etiqueta"}</h3>
                <p className="signal-kicker-action">
                  {truncate(stringValue(barrier.action) || stringValue(detail.text), 220) || "Acción pendiente."}
                </p>
                {stringValue(barrier.quote) && (
                  <blockquote className="signal-kicker-quote">“{truncate(stringValue(barrier.quote), 260)}”</blockquote>
                )}
              </div>
              <aside className="signal-kicker-proof">
                <dl>
                  <div>
                    <dt>Evidencia</dt>
                    <dd>{fmtCompact(Number(voice.citation_count ?? samples.length))}</dd>
                  </div>
                  <div>
                    <dt>Capa</dt>
                    <dd>{prettifyKey(stringValue(detail.layer) || stringValue(voice.layer) || "sin capa")}</dd>
                  </div>
                  <div>
                    <dt>Movilidad</dt>
                    <dd>{prettifyKey(stringValue(detail.movilidad) || "sin clasificar")}</dd>
                  </div>
                </dl>
                <div className="signal-kicker-channels">
                  {channels.length > 0 ? channels.map((channel) => (
                    <span key={channel.label}>{channel.label} · {channel.count}</span>
                  )) : <span>Canales no incluidos en muestra</span>}
                </div>
                {stringValue(barrier.confidence) && (
                  <span className={`signal-confidence-pill signal-confidence-pill--${normalizeConfidence(barrier.confidence)}`}>
                    Confianza {stringValue(barrier.confidence)}
                  </span>
                )}
              </aside>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FindingCard({ item, variant }: { item: JsonRecord; variant?: "structural" }) {
  const layer = stringValue(item.layer);
  const mobility = stringValue(item.movilidad);
  const effort = stringValue(item.effort);
  const owner = stringValue(item.owner);
  const successSignal = stringValue(item.success_signal);
  return (
    <article className={`signal-finding${variant === "structural" ? " signal-finding--structural" : ""}`}>
      <header className="signal-finding-head">
        <span className="signal-finding-code">{stringValue(item.finding_id) || stringValue(item.kind)}</span>
        <span className={`signal-confidence-pill signal-confidence-pill--${normalizeConfidence(item.confidence)}`}>
          {stringValue(item.confidence) || "media"}
        </span>
      </header>
      <h3 className="signal-finding-name">{stringValue(item.finding_name) || "Hallazgo"}</h3>
      <p className="signal-finding-text">{stringValue(item.text) || "Sin texto publicado."}</p>
      {(layer || mobility || effort) && (
        <div className="signal-finding-tags">
          {layer && <Chip>capa · {layer}</Chip>}
          {mobility && <Chip>{prettifyKey(mobility)}</Chip>}
          {effort && <Chip>esfuerzo · {effort}</Chip>}
        </div>
      )}
      {successSignal && (
        <p className="signal-finding-success">
          <Icon name="check" size={12} /> {successSignal}
        </p>
      )}
      {owner && (
        <p className="signal-finding-owner">
          <Icon name="info" size={12} /> {owner}
        </p>
      )}
    </article>
  );
}

function BestMoveCard({ move, mentions }: { move: JsonRecord; mentions: JsonRecord[] }) {
  if (!stringValue(move.finding_name)) {
    return (
      <FindingNotice
        icon="info"
        title="Aún no hay mejor jugada priorizada."
        body="El compositor de Signal seleccionará la acción con mayor score + movilidad cuando el análisis esté completo."
      />
    );
  }
  const owner = stringValue(move.owner);
  const successSignal = stringValue(move.success_signal);
  return (
    <article className="signal-bestmove-shell">
      <div className="signal-bestmove">
        <p className="signal-eyebrow">Mejor jugada · prioridad #1</p>
        <h3 className="signal-bestmove-name">{stringValue(move.finding_name)}</h3>
        <p className="signal-bestmove-text">{stringValue(move.text)}</p>
        <dl className="signal-bestmove-meta">
          {successSignal && (
            <div>
              <dt>Indicador de éxito</dt>
              <dd>{successSignal}</dd>
            </div>
          )}
          {owner && (
            <div>
              <dt>Responsable sugerido</dt>
              <dd>{owner}</dd>
            </div>
          )}
          {stringValue(move.effort) && (
            <div>
              <dt>Esfuerzo</dt>
              <dd>{stringValue(move.effort)}</dd>
            </div>
          )}
        </dl>
      </div>
      <aside className="signal-evidence-rail">
        <span>Conversaciones que justifican</span>
        <div className="signal-evidence-scroll">
          {mentions.length > 0 ? mentions.slice(0, 8).map((mention, index) => (
            <blockquote key={stringValue(mention.mention_id) || index}>
              <small>{stringValue(mention.platform) || "Fuente"}</small>
              {truncate(stringValue(mention.text), 180)}
            </blockquote>
          )) : (
            <p>No hay verbatims de muestra asociados a esta jugada en el payload publicado.</p>
          )}
        </div>
      </aside>
    </article>
  );
}

function ActionRow({ item, rank }: { item: JsonRecord; rank: number }) {
  return (
    <li className="signal-action-row">
      <span className="signal-action-rank">{String(rank).padStart(2, "0")}</span>
      <div className="signal-action-body">
        <h4>{stringValue(item.finding_name) || "Acción"}</h4>
        <p>{truncate(stringValue(item.text), 240)}</p>
      </div>
    </li>
  );
}

function TensionMap({
  triggers,
  barriers,
  findingsScatter,
  triggersTotal,
  barriersTotal,
}: {
  triggers: JsonRecord[];
  barriers: JsonRecord[];
  findingsScatter: JsonRecord[];
  triggersTotal: number;
  barriersTotal: number;
}) {
  const total = Math.max(1, triggersTotal + barriersTotal);
  const trigPct = (triggersTotal / total) * 100;
  const barPct = (barriersTotal / total) * 100;
  const layerRows = summarizeLayerTension([...triggers, ...barriers], findingsScatter);
  return (
    <div className="tension-map">
      <div className="tension-bar" role="img" aria-label={`Triggers ${triggersTotal} vs Barriers ${barriersTotal}`}>
        <div className="tension-bar-triggers" style={{ width: `${trigPct}%` }}>
          <span>{triggersTotal} triggers</span>
        </div>
        <div className="tension-bar-barriers" style={{ width: `${barPct}%` }}>
          <span>{barriersTotal} barriers</span>
        </div>
      </div>
      <div className="tension-layer-grid">
        {layerRows.map((row) => (
          <article key={row.layer}>
            <span>{row.label}</span>
            <strong>{row.count}</strong>
            <div><i style={{ width: `${row.force}%` }} /></div>
            <small>Fuerza {row.force}% · confianza {row.confidence}</small>
          </article>
        ))}
      </div>
      <div className="tension-cols">
        <div className="tension-col tension-col--triggers">
          <p className="signal-eyebrow">Empujan a comprar</p>
          {triggers.length > 0 ? (
            <ul>
              {triggers.slice(0, 5).map((t, i) => (
                <li key={stringValue(t.id) || String(i)}>{stringValue(t.finding_name)}</li>
              ))}
            </ul>
          ) : (
            <p className="tension-empty">
              Sin señales positivas en este corte. La fuerza del corpus está completamente del lado de la fricción.
            </p>
          )}
        </div>
        <div className="tension-col tension-col--barriers">
          <p className="signal-eyebrow">Frenan la decisión</p>
          <ul>
            {barriers.slice(0, 5).map((b, i) => (
              <li key={stringValue(b.id) || String(i)}>{stringValue(b.finding_name)}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FrictionHeatmap({ barriers }: { barriers: JsonRecord[] }) {
  const stages: { label: string; key: "consideracion" | "compra" | "siniestro" | "renovacion" }[] = [
    { label: "Consideración", key: "consideracion" },
    { label: "Compra", key: "compra" },
    { label: "Siniestro", key: "siniestro" },
    { label: "Renovación", key: "renovacion" },
  ];
  return (
    <div className="friction-heatmap">
      <div className="friction-heatmap-head">
        <span />
        {stages.map((s) => (
          <span key={s.key}>{s.label}</span>
        ))}
      </div>
      {barriers.map((b, rowIdx) => {
        const ji = asRecord(b.journey_intensity);
        const rowValues = stages.map((s) => Number(ji[s.key] ?? 0));
        const rowMax = Math.max(...rowValues, 0.001);
        return (
          <div className="friction-heatmap-row" key={stringValue(b.id) || String(rowIdx)}>
            <span className="friction-heatmap-label">{stringValue(b.finding_name) || "Barrera"}</span>
            {stages.map((s, colIdx) => {
              const raw = rowValues[colIdx] ?? 0;
              const norm = raw / rowMax;
              const pct = Math.round(raw * 100);
              return (
                <span
                  className="friction-heatmap-cell"
                  key={s.key}
                  style={{ background: heatColor(norm) }}
                  title={`${pct}% del peso`}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MentionCard({ item }: { item: JsonRecord }) {
  const date = stringValue(item.published_at);
  const dateLabel = date ? new Date(date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "";
  return (
    <li className={`mention-card${Boolean(item.is_protagonist) ? " mention-card--protagonist" : ""}`}>
      <header className="mention-card-head">
        <span className="mention-card-platform">
          <Icon name="platform" size={12} /> {stringValue(item.platform)}
        </span>
        {Boolean(item.is_protagonist) && (
          <span className="mention-card-flag">
            <Icon name="star" size={11} /> protagonista
          </span>
        )}
      </header>
      <blockquote>“{truncate(stringValue(item.text), 320)}”</blockquote>
      <footer className="mention-card-foot">
        {stringValue(item.finding_name) && (
          <span className="mention-card-finding">
            <Icon name="tag" size={11} /> {stringValue(item.finding_name)}
          </span>
        )}
        {dateLabel && <span className="mention-card-date">{dateLabel}</span>}
      </footer>
    </li>
  );
}

function FindingNotice({ icon, title, body }: { icon: "info" | "wave" | "message" | "layers"; title: string; body: string }) {
  return (
    <div className="signal-notice">
      <span className="signal-notice-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="signal-chip">{children}</span>;
}

/* ============================================================ Helpers ============================================================ */

function heatColor(intensity: number): string {
  const alpha = 0.06 + intensity * 0.72;
  return `rgba(0, 126, 137, ${alpha})`;
}

function summarizeChannels(items: JsonRecord[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const platform = stringValue(item.platform) || "Fuente";
    counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function summarizeLayerTension(items: JsonRecord[], scatter: JsonRecord[]) {
  const layers = ["psicologico", "personal", "social", "cultural"];
  const scatterByLayer = new Map<string, JsonRecord[]>();
  for (const point of scatter) {
    const layer = stringValue(point.layer);
    if (!scatterByLayer.has(layer)) scatterByLayer.set(layer, []);
    scatterByLayer.get(layer)?.push(point);
  }
  const maxCount = Math.max(1, ...layers.map((layer) => items.filter((item) => stringValue(item.layer) === layer).length));
  return layers.map((layer) => {
    const count = items.filter((item) => stringValue(item.layer) === layer).length;
    const layerScatter = scatterByLayer.get(layer) ?? [];
    const avgScore = layerScatter.length > 0
      ? layerScatter.reduce((sum, item) => sum + Number(item.score ?? 0), 0) / layerScatter.length
      : count;
    return {
      layer,
      label: prettifyKey(layer),
      count,
      force: Math.max(8, Math.round((count / maxCount) * 100)),
      confidence: avgScore >= 4 ? "alta" : avgScore >= 2 ? "media" : "direccional",
    };
  });
}

function fmtCompact(value: number): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
}

function normalizeConfidence(value: unknown): "alta" | "media" | "baja" {
  const s = String(value ?? "").toLowerCase();
  if (s.startsWith("alt")) return "alta";
  if (s.startsWith("baj")) return "baja";
  return "media";
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateRange(start: unknown, end: unknown): string {
  const s = String(start ?? "");
  const e = String(end ?? "");
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "2-digit" };
  const fmt = (d: string) => (d ? new Date(d).toLocaleDateString("es-MX", opts) : "");
  return [fmt(s), fmt(e)].filter(Boolean).join(" → ");
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

const moduleOrder: SignalModuleKey[] = [
  "overview",
  "tension_map",
  "actions",
  "barriers",
  "triggers",
  "friction_heatmap",
  "verbatims",
  "stream_graph",
  "compare",
  "chat",
];

const moduleLabels: Record<SignalModuleKey, string> = {
  overview: "Overview",
  barriers: "Barriers",
  triggers: "Triggers",
  verbatims: "Verbatims",
  actions: "Acciones",
  compare: "Compare",
  chat: "Chat",
  tension_map: "Tensión",
  stream_graph: "Stream",
  friction_heatmap: "Heatmap",
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
