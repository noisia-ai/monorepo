/**
 * The Mexican Home — Evolución mensual por señal
 *
 * Distribución temporal de menciones por señal en el periodo
 * analizado. Las curvas reflejan madurez:
 *
 *   - Mainstreaming → tráfico alto y consistente con crecimiento gradual
 *   - Acelerando    → crecimiento visible, más fuerte en últimos meses
 *   - Emergente     → mínimo los primeros meses, rampa en último tercio
 *
 * Generado: 2026-05-20
 * Total: 1,184,272 menciones en 5 meses · 8 señales
 *
 * Cómo usar:
 *   import { signalEvolution, periodMonths } from './noisia_mexican_home_signal_evolution.js';
 *   const data = signalEvolution['mi_casita_identidad'].monthly;
 */

export const periodMonths = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

export const signalEvolution = {
  'mi_casita_identidad': {
    id: 'mi_casita_identidad',
    name: 'Mi casita es identidad',
    color: '#007E89',
    maturity: 'mainstreaming',
    total: 907668,
    monthly: [
      { month: '2026-01', mentions: 157973 },
      { month: '2026-02', mentions: 165906 },
      { month: '2026-03', mentions: 170548 },
      { month: '2026-04', mentions: 192857 },
      { month: '2026-05', mentions: 220384 }
    ]
  },

  'casa_propia_futuro': {
    id: 'casa_propia_futuro',
    name: 'Casa propia significa futuro',
    color: '#01535F',
    maturity: 'acelerando',
    total: 120284,
    monthly: [
      { month: '2026-01', mentions: 13079 },
      { month: '2026-02', mentions: 18677 },
      { month: '2026-03', mentions: 23266 },
      { month: '2026-04', mentions: 29877 },
      { month: '2026-05', mentions: 35385 }
    ]
  },

  'renta_no_alcanza': {
    id: 'renta_no_alcanza',
    name: 'La renta no alcanza',
    color: '#D81B60',
    maturity: 'acelerando',
    total: 49080,
    monthly: [
      { month: '2026-01', mentions: 6042 },
      { month: '2026-02', mentions: 7132 },
      { month: '2026-03', mentions: 9570 },
      { month: '2026-04', mentions: 12161 },
      { month: '2026-05', mentions: 14175 }
    ]
  },

  'independencia_aspiracion': {
    id: 'independencia_aspiracion',
    name: 'Independizarse se volvió aspiración doméstica',
    color: '#D91441',
    maturity: 'acelerando',
    total: 35111,
    monthly: [
      { month: '2026-01', mentions: 3252 },
      { month: '2026-02', mentions: 5298 },
      { month: '2026-03', mentions: 5903 },
      { month: '2026-04', mentions: 9225 },
      { month: '2026-05', mentions: 11433 }
    ]
  },

  'casa_se_volvio_refugio': {
    id: 'casa_se_volvio_refugio',
    name: 'La casa se volvió refugio',
    color: '#4B1D95',
    maturity: 'acelerando',
    total: 32334,
    monthly: [
      { month: '2026-01', mentions: 3300 },
      { month: '2026-02', mentions: 4621 },
      { month: '2026-03', mentions: 6821 },
      { month: '2026-04', mentions: 8049 },
      { month: '2026-05', mentions: 9543 }
    ]
  },

  'casa_trabaja_de_mas': {
    id: 'casa_trabaja_de_mas',
    name: 'La casa trabaja de más',
    color: '#261447',
    maturity: 'acelerando',
    total: 30859,
    monthly: [
      { month: '2026-01', mentions: 3251 },
      { month: '2026-02', mentions: 4648 },
      { month: '2026-03', mentions: 6311 },
      { month: '2026-04', mentions: 7509 },
      { month: '2026-05', mentions: 9140 }
    ]
  },

  'seguridad_bienestar': {
    id: 'seguridad_bienestar',
    name: 'Seguridad es parte del bienestar',
    color: '#070113',
    maturity: 'emergente',
    total: 8358,
    monthly: [
      { month: '2026-01', mentions: 278 },
      { month: '2026-02', mentions: 518 },
      { month: '2026-03', mentions: 1361 },
      { month: '2026-04', mentions: 3189 },
      { month: '2026-05', mentions: 3012 }
    ]
  },

  'busqueda_sospecha': {
    id: 'busqueda_sospecha',
    name: 'Antes del hogar está el filtro de confianza',
    color: '#12001F',
    maturity: 'emergente',
    total: 578,
    monthly: [
      { month: '2026-01', mentions: 20 },
      { month: '2026-02', mentions: 32 },
      { month: '2026-03', mentions: 110 },
      { month: '2026-04', mentions: 197 },
      { month: '2026-05', mentions: 219 }
    ]
  },

};

export default signalEvolution;
