export type SignalModuleKey =
  | "overview"
  | "barriers"
  | "triggers"
  | "verbatims"
  | "actions"
  | "compare"
  | "chat"
  | "tension_map"
  | "stream_graph"
  | "friction_heatmap";

export const defaultSignalManifest: Record<SignalModuleKey, boolean> = {
  overview: true,
  barriers: true,
  triggers: true,
  verbatims: true,
  actions: true,
  compare: false,
  chat: true,
  tension_map: true,
  stream_graph: false,
  friction_heatmap: true
};

export const signalModuleMeta: Array<{
  key: SignalModuleKey;
  label: string;
  description: string;
  status: "ready" | "partial" | "hold";
}> = [
  {
    key: "overview",
    label: "Overview editorial",
    description: "Cover story, top barreras y lectura del momento cultural.",
    status: "ready"
  },
  {
    key: "barriers",
    label: "Barriers",
    description: "Kanban y detalle de barreras con evidencia.",
    status: "ready"
  },
  {
    key: "triggers",
    label: "Triggers",
    description: "Señales positivas cuando el corpus las tenga.",
    status: "partial"
  },
  {
    key: "verbatims",
    label: "Verbatims",
    description: "Explorador editorial de citas y menciones.",
    status: "partial"
  },
  {
    key: "actions",
    label: "Actions",
    description: "Playbook priorizado para equipos de marca/agencia.",
    status: "ready"
  },
  {
    key: "compare",
    label: "Compare",
    description: "Benchmark vs competidores. Requiere corpora aprobados.",
    status: "hold"
  },
  {
    key: "chat",
    label: "Chat del estudio",
    description: "Asistente restringido al output publicado.",
    status: "partial"
  },
  {
    key: "tension_map",
    label: "Tension Map",
    description: "Fuerzas que jalan hacia o alejan de la marca.",
    status: "partial"
  },
  {
    key: "stream_graph",
    label: "Stream cultural",
    description: "Evolución narrativa en el tiempo. Requiere series por semana.",
    status: "hold"
  },
  {
    key: "friction_heatmap",
    label: "Friction Heatmap",
    description: "Barreras por etapa del journey.",
    status: "partial"
  }
];
