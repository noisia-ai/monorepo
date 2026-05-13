import { DashboardShell } from "@/components/dashboards/DashboardShell";

export const metadata = {
  title: "Grupo Salinas — Configuración",
};

const SOURCES = [
  { platform: "TikTok", account: "@elektramexico", brand: "Elektra", status: "active", lastSync: "hace 8 min" },
  { platform: "TikTok", account: "@bancoazteca", brand: "Banco Azteca", status: "active", lastSync: "hace 11 min" },
  { platform: "TikTok", account: "@italika", brand: "Italika", status: "active", lastSync: "hace 9 min" },
  { platform: "YouTube", account: "TV Azteca Oficial", brand: "TV Azteca", status: "active", lastSync: "hace 14 min" },
  { platform: "YouTube", account: "Elektra", brand: "Elektra", status: "active", lastSync: "hace 12 min" },
  { platform: "YouTube", account: "Total Play", brand: "Total Play", status: "warn", lastSync: "hace 2h", note: "API rate limit alcanzado" },
  { platform: "YouTube", account: "Banco Azteca", brand: "Banco Azteca", status: "active", lastSync: "hace 13 min" },
  { platform: "Instagram", account: "@elektra_oficial", brand: "Elektra", status: "active", lastSync: "hace 10 min" },
  { platform: "Instagram", account: "@exatlonmexico", brand: "TV Azteca", status: "active", lastSync: "hace 7 min" },
  { platform: "Instagram", account: "@italika", brand: "Italika", status: "active", lastSync: "hace 12 min" },
  { platform: "Instagram", account: "@totalplaymx", brand: "Total Play", status: "active", lastSync: "hace 15 min" },
];

const USERS = [
  { name: "Hugo Salinas Pliego", email: "hsalinas@gruposalinas.mx", role: "Admin", brands: "Todas" },
  { name: "Ana Cárdenas (Marketing)", email: "acardenas@elektra.mx", role: "Analista", brands: "Elektra" },
  { name: "Diego Rivera (TV)", email: "drivera@tvazteca.mx", role: "Analista", brands: "TV Azteca" },
  { name: "Equipo Comunicación", email: "comms@gruposalinas.mx", role: "Viewer", brands: "Todas" },
];

export default function ConfiguracionPage() {
  return (
    <DashboardShell
      title="Grupo Salinas · Configuración"
      badge="11 fuentes · 4 usuarios"
      actions={
        <>
          <button type="button" className="db-btn">Ver log de accesos</button>
          <button type="button" className="db-btn db-btn--primary">+ Conectar fuente</button>
        </>
      }
    >
      {/* ÉPICA 1 + 7 — Fuentes & sistema */}
      <section className="db-card db-section">
        <div className="db-section__head">
          <div>
            <h2 className="db-section__title">Fuentes conectadas</h2>
            <p className="db-section__sub">
              TikTok via Clockworks · YouTube via Streamers · Instagram via Apify Reel Scraper. Frecuencia de sync: 15 min.
            </p>
          </div>
          <span className="db-section__hint">10 activas · 1 con alerta</span>
        </div>
        <div className="db-card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "var(--surface-01)" }}>
                <Th>Plataforma</Th>
                <Th>Cuenta</Th>
                <Th>Marca</Th>
                <Th>Estado</Th>
                <Th>Última actualización</Th>
                <Th align="right">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--neutral-03)" }}>
                  <Td>{s.platform}</Td>
                  <Td><strong>{s.account}</strong></Td>
                  <Td>{s.brand}</Td>
                  <Td>
                    <StatusDot status={s.status as "active" | "warn"} />
                    {s.status === "active" ? "Activa" : "Alerta"}
                    {s.note ? <div style={{ fontSize: "0.7rem", color: "var(--neutral-09)", marginTop: 2 }}>{s.note}</div> : null}
                  </Td>
                  <Td>{s.lastSync}</Td>
                  <Td align="right"><button type="button" className="db-btn db-btn--ghost">Editar</button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ÉPICA 7 — Update frequency + health */}
      <section className="db-card db-section">
        <div className="db-section__head">
          <div>
            <h2 className="db-section__title">Sistema</h2>
            <p className="db-section__sub">Frecuencia de actualización, salud del pipeline y notificaciones.</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <ConfigCell label="Frecuencia sync" value="15 min" sub="Editable según consumo de API" />
          <ConfigCell label="Última sincronización" value="hace 8 min" sub="Todas las fuentes activas" />
          <ConfigCell label="Alertas activas" value="1" sub="Total Play · YouTube · rate limit" />
          <ConfigCell label="API calls hoy" value="2,847 / 10,000" sub="Cuota global del workspace" />
        </div>
      </section>

      {/* ÉPICA 6 — Usuarios y permisos */}
      <section className="db-card db-section">
        <div className="db-section__head">
          <div>
            <h2 className="db-section__title">Usuarios y permisos</h2>
            <p className="db-section__sub">
              SSO via Google Workspace · Microsoft 365 disponible. Roles: Admin / Analista / Viewer.
            </p>
          </div>
          <button type="button" className="db-btn db-btn--primary">+ Invitar usuario</button>
        </div>
        <div className="db-card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "var(--surface-01)" }}>
                <Th>Nombre</Th>
                <Th>Email</Th>
                <Th>Rol</Th>
                <Th>Acceso a marcas</Th>
                <Th align="right">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {USERS.map((u, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--neutral-03)" }}>
                  <Td><strong>{u.name}</strong></Td>
                  <Td>{u.email}</Td>
                  <Td>{u.role}</Td>
                  <Td>{u.brands}</Td>
                  <Td align="right"><button type="button" className="db-btn db-btn--ghost">Editar</button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ÉPICA 8 — Benchmarking placeholder */}
      <section className="db-card db-section">
        <div className="db-section__head">
          <div>
            <h2 className="db-section__title">Benchmarking · Insights automáticos</h2>
            <p className="db-section__sub">
              Comparación de tus métricas vs. promedios de la industria por plataforma y sugerencias derivadas del corpus.
            </p>
          </div>
          <span className="db-section__hint">Fase 2 · disponible Q3 2026</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <ConfigCell label="TikTok ER promedio LATAM" value="3.2%" sub="Tu promedio: 6.8% · arriba" />
          <ConfigCell label="YouTube completion LATAM" value="32%" sub="Tu promedio: 33% · neutro" />
          <ConfigCell label="Patrón sugerido" value="<30s = +1.6× completion" sub="Detectado en últimos 90d" />
        </div>
      </section>
    </DashboardShell>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        fontSize: "0.66rem",
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--neutral-09)",
        padding: "10px 14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ padding: "11px 14px", textAlign: align ?? "left", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}

function StatusDot({ status }: { status: "active" | "warn" }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        marginRight: 6,
        background: status === "active" ? "var(--positive)" : "#f4a83c",
        verticalAlign: "middle",
      }}
    />
  );
}

function ConfigCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="db-drawer__primary-cell">
      <span className="db-drawer__primary-label">{label}</span>
      <div className="db-drawer__primary-val">{value}</div>
      {sub ? <span style={{ fontSize: "0.7rem", color: "var(--neutral-10)", marginTop: 4 }}>{sub}</span> : null}
    </div>
  );
}
