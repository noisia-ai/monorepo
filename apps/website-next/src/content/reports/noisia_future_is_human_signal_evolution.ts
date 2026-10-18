/**
 * Future is Human — Evolución mensual por señal
 *
 * Distribución temporal de menciones por señal a lo largo del periodo
 * analizado. Las curvas reflejan la madurez cultural de cada señal:
 *
 *   - Mainstreaming → tráfico alto y consistente con crecimiento gradual
 *   - Acelerando    → crecimiento visible, más fuerte en últimos meses
 *   - Emergente     → mínimo los primeros meses, rampa en último tercio
 *
 * Generado: 2026-05-13
 * Total: 1,700,000 menciones en 13 meses · 6 señales
 *
 * Cómo usar en el HTML:
 *   import { signalEvolution, periodMonths } from './noisia_future_is_human_signal_evolution.js';
 *   const data = signalEvolution['humano_demandado'].monthly;
 *   // → [{ month: '2025-05', mentions: 33358 }, ...]
 */

export const periodMonths = ["2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

export const signalEvolution = {
  'humano_demandado': {
    id: 'humano_demandado',
    name: 'El humano se volvió default explícito',
    color: '#007E89',
    maturity: 'mainstreaming',
    total: 564824,
    monthly: [
      { month: '2025-05', mentions: 33358 },
      { month: '2025-06', mentions: 35695 },
      { month: '2025-07', mentions: 40276 },
      { month: '2025-08', mentions: 38158 },
      { month: '2025-09', mentions: 44387 },
      { month: '2025-10', mentions: 41846 },
      { month: '2025-11', mentions: 41452 },
      { month: '2025-12', mentions: 46020 },
      { month: '2026-01', mentions: 45411 },
      { month: '2026-02', mentions: 45635 },
      { month: '2026-03', mentions: 49154 },
      { month: '2026-04', mentions: 52124 },
      { month: '2026-05', mentions: 51308 }
    ]
  },

  'transparencia_IA': {
    id: 'transparencia_IA',
    name: 'La transparencia humaniza más que la simulación',
    color: '#01535F',
    maturity: 'acelerando',
    total: 619723,
    monthly: [
      { month: '2025-05', mentions: 15993 },
      { month: '2025-06', mentions: 19433 },
      { month: '2025-07', mentions: 20418 },
      { month: '2025-08', mentions: 26435 },
      { month: '2025-09', mentions: 35701 },
      { month: '2025-10', mentions: 40860 },
      { month: '2025-11', mentions: 44096 },
      { month: '2025-12', mentions: 54655 },
      { month: '2026-01', mentions: 56607 },
      { month: '2026-02', mentions: 71507 },
      { month: '2026-03', mentions: 74148 },
      { month: '2026-04', mentions: 70817 },
      { month: '2026-05', mentions: 89053 }
    ]
  },

  'responsabilidad': {
    id: 'responsabilidad',
    name: 'Lo humano se mide cuando algo sale mal',
    color: '#D81B60',
    maturity: 'acelerando',
    total: 454660,
    monthly: [
      { month: '2025-05', mentions: 14587 },
      { month: '2025-06', mentions: 15735 },
      { month: '2025-07', mentions: 17164 },
      { month: '2025-08', mentions: 18912 },
      { month: '2025-09', mentions: 25699 },
      { month: '2025-10', mentions: 32396 },
      { month: '2025-11', mentions: 32015 },
      { month: '2025-12', mentions: 41283 },
      { month: '2026-01', mentions: 36370 },
      { month: '2026-02', mentions: 47797 },
      { month: '2026-03', mentions: 48061 },
      { month: '2026-04', mentions: 58292 },
      { month: '2026-05', mentions: 66349 }
    ]
  },

  'voz_genérica': {
    id: 'voz_genérica',
    name: 'Cuando la marca suena a prompt, pierde voz',
    color: '#D91441',
    maturity: 'emergente',
    total: 19528,
    monthly: [
      { month: '2025-05', mentions: 88 },
      { month: '2025-06', mentions: 129 },
      { month: '2025-07', mentions: 135 },
      { month: '2025-08', mentions: 148 },
      { month: '2025-09', mentions: 280 },
      { month: '2025-10', mentions: 448 },
      { month: '2025-11', mentions: 888 },
      { month: '2025-12', mentions: 1435 },
      { month: '2026-01', mentions: 2324 },
      { month: '2026-02', mentions: 3157 },
      { month: '2026-03', mentions: 3129 },
      { month: '2026-04', mentions: 3027 },
      { month: '2026-05', mentions: 4340 }
    ]
  },

  'contexto_perdido': {
    id: 'contexto_perdido',
    name: 'Velocidad sin contexto no es atención',
    color: '#4B1D95',
    maturity: 'emergente',
    total: 12159,
    monthly: [
      { month: '2025-05', mentions: 64 },
      { month: '2025-06', mentions: 60 },
      { month: '2025-07', mentions: 85 },
      { month: '2025-08', mentions: 91 },
      { month: '2025-09', mentions: 159 },
      { month: '2025-10', mentions: 256 },
      { month: '2025-11', mentions: 538 },
      { month: '2025-12', mentions: 753 },
      { month: '2026-01', mentions: 1609 },
      { month: '2026-02', mentions: 1498 },
      { month: '2026-03', mentions: 1753 },
      { month: '2026-04', mentions: 2454 },
      { month: '2026-05', mentions: 2839 }
    ]
  },

  'craft_humano': {
    id: 'craft_humano',
    name: 'El craft sigue siendo señal de cuidado',
    color: '#261447',
    maturity: 'emergente',
    total: 29107,
    monthly: [
      { month: '2025-05', mentions: 152 },
      { month: '2025-06', mentions: 182 },
      { month: '2025-07', mentions: 194 },
      { month: '2025-08', mentions: 247 },
      { month: '2025-09', mentions: 421 },
      { month: '2025-10', mentions: 568 },
      { month: '2025-11', mentions: 1380 },
      { month: '2025-12', mentions: 2044 },
      { month: '2026-01', mentions: 2645 },
      { month: '2026-02', mentions: 4602 },
      { month: '2026-03', mentions: 4393 },
      { month: '2026-04', mentions: 6342 },
      { month: '2026-05', mentions: 5937 }
    ]
  },

};

export default signalEvolution;
