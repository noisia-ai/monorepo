/**
 * Cultural Foresight México 2026 — Evolución mensual por señal
 *
 * Distribución temporal de menciones por señal a lo largo del periodo
 * analizado. Las curvas reflejan la madurez cultural de cada señal:
 *
 *   - Mainstreaming → tráfico alto y consistente con crecimiento gradual
 *   - Acelerando    → crecimiento visible, más fuerte en últimos meses
 *   - Emergente     → mínimo los primeros meses, rampa en último tercio
 *
 * Generado: 2026-05-16 (recálculo sobre corpus completo)
 * Total: 11,478,249 menciones en 17 meses · 8 señales
 *
 * Cómo usar en el HTML:
 *   import { signalEvolution, periodMonths } from './noisia_foresight_2026_signal_evolution.js';
 *   const data = signalEvolution['descanso_sin_permiso'].monthly;
 *   // → [{ month: '2025-01', mentions: 23400 }, ...]
 */

export const periodMonths = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

export const signalEvolution = {
  'descanso_sin_permiso': {
    id: 'descanso_sin_permiso',
    name: 'El descanso deja de pedir permiso',
    color: '#007E89',
    maturity: 'acelerando',
    total: 427268,
    monthly: [
      { month: '2025-01', mentions: 8700 },
      { month: '2025-02', mentions: 10346 },
      { month: '2025-03', mentions: 12673 },
      { month: '2025-04', mentions: 14055 },
      { month: '2025-05', mentions: 16019 },
      { month: '2025-06', mentions: 16562 },
      { month: '2025-07', mentions: 20691 },
      { month: '2025-08', mentions: 21419 },
      { month: '2025-09', mentions: 20600 },
      { month: '2025-10', mentions: 25704 },
      { month: '2025-11', mentions: 24756 },
      { month: '2025-12', mentions: 35410 },
      { month: '2026-01', mentions: 38717 },
      { month: '2026-02', mentions: 35203 },
      { month: '2026-03', mentions: 37728 },
      { month: '2026-04', mentions: 46552 },
      { month: '2026-05', mentions: 42133 }
    ]
  },

  'privacidad_emocional': {
    id: 'privacidad_emocional',
    name: 'La privacidad se vuelve emocional',
    color: '#01535F',
    maturity: 'acelerando',
    total: 379992,
    monthly: [
      { month: '2025-01', mentions: 9063 },
      { month: '2025-02', mentions: 8659 },
      { month: '2025-03', mentions: 12140 },
      { month: '2025-04', mentions: 13563 },
      { month: '2025-05', mentions: 13477 },
      { month: '2025-06', mentions: 16112 },
      { month: '2025-07', mentions: 15774 },
      { month: '2025-08', mentions: 17667 },
      { month: '2025-09', mentions: 20061 },
      { month: '2025-10', mentions: 25040 },
      { month: '2025-11', mentions: 23784 },
      { month: '2025-12', mentions: 32508 },
      { month: '2026-01', mentions: 27027 },
      { month: '2026-02', mentions: 30560 },
      { month: '2026-03', mentions: 31883 },
      { month: '2026-04', mentions: 42330 },
      { month: '2026-05', mentions: 40344 }
    ]
  },

  'perfeccion_pierde_credibilidad': {
    id: 'perfeccion_pierde_credibilidad',
    name: 'La perfección pierde credibilidad',
    color: '#D81B60',
    maturity: 'acelerando',
    total: 539660,
    monthly: [
      { month: '2025-01', mentions: 11137 },
      { month: '2025-02', mentions: 13881 },
      { month: '2025-03', mentions: 13506 },
      { month: '2025-04', mentions: 18013 },
      { month: '2025-05', mentions: 19776 },
      { month: '2025-06', mentions: 20865 },
      { month: '2025-07', mentions: 25135 },
      { month: '2025-08', mentions: 27667 },
      { month: '2025-09', mentions: 26014 },
      { month: '2025-10', mentions: 33618 },
      { month: '2025-11', mentions: 37948 },
      { month: '2025-12', mentions: 40321 },
      { month: '2026-01', mentions: 48635 },
      { month: '2026-02', mentions: 50710 },
      { month: '2026-03', mentions: 49296 },
      { month: '2026-04', mentions: 50594 },
      { month: '2026-05', mentions: 52544 }
    ]
  },

  'humor_carga_tension': {
    id: 'humor_carga_tension',
    name: 'El humor carga lo que no se puede decir en serio',
    color: '#D91441',
    maturity: 'mainstreaming',
    total: 2165775,
    monthly: [
      { month: '2025-01', mentions: 110983 },
      { month: '2025-02', mentions: 105560 },
      { month: '2025-03', mentions: 113360 },
      { month: '2025-04', mentions: 116984 },
      { month: '2025-05', mentions: 110678 },
      { month: '2025-06', mentions: 111142 },
      { month: '2025-07', mentions: 124423 },
      { month: '2025-08', mentions: 118032 },
      { month: '2025-09', mentions: 126425 },
      { month: '2025-10', mentions: 140309 },
      { month: '2025-11', mentions: 143352 },
      { month: '2025-12', mentions: 130066 },
      { month: '2026-01', mentions: 132264 },
      { month: '2026-02', mentions: 138523 },
      { month: '2026-03', mentions: 155960 },
      { month: '2026-04', mentions: 139889 },
      { month: '2026-05', mentions: 147825 }
    ]
  },

  'decision_necesita_curaduria': {
    id: 'decision_necesita_curaduria',
    name: 'La decisión necesita curaduría',
    color: '#4B1D95',
    maturity: 'acelerando',
    total: 3691986,
    monthly: [
      { month: '2025-01', mentions: 94836 },
      { month: '2025-02', mentions: 99795 },
      { month: '2025-03', mentions: 107321 },
      { month: '2025-04', mentions: 104072 },
      { month: '2025-05', mentions: 121695 },
      { month: '2025-06', mentions: 153943 },
      { month: '2025-07', mentions: 177449 },
      { month: '2025-08', mentions: 155240 },
      { month: '2025-09', mentions: 181582 },
      { month: '2025-10', mentions: 249436 },
      { month: '2025-11', mentions: 217091 },
      { month: '2025-12', mentions: 280785 },
      { month: '2026-01', mentions: 277312 },
      { month: '2026-02', mentions: 330852 },
      { month: '2026-03', mentions: 379791 },
      { month: '2026-04', mentions: 377869 },
      { month: '2026-05', mentions: 382917 }
    ]
  },

  'comunidades_confianza': {
    id: 'comunidades_confianza',
    name: 'Comunidades pequeñas, confianza grande',
    color: '#261447',
    maturity: 'emergente',
    total: 108824,
    monthly: [
      { month: '2025-01', mentions: 558 },
      { month: '2025-02', mentions: 476 },
      { month: '2025-03', mentions: 612 },
      { month: '2025-04', mentions: 739 },
      { month: '2025-05', mentions: 710 },
      { month: '2025-06', mentions: 1138 },
      { month: '2025-07', mentions: 1394 },
      { month: '2025-08', mentions: 1985 },
      { month: '2025-09', mentions: 3378 },
      { month: '2025-10', mentions: 6074 },
      { month: '2025-11', mentions: 6864 },
      { month: '2025-12', mentions: 11332 },
      { month: '2026-01', mentions: 12259 },
      { month: '2026-02', mentions: 12867 },
      { month: '2026-03', mentions: 15572 },
      { month: '2026-04', mentions: 15981 },
      { month: '2026-05', mentions: 16885 }
    ]
  },

  'aspirar_da_cringe': {
    id: 'aspirar_da_cringe',
    name: 'Aspirar demasiado empieza a dar cringe',
    color: '#070113',
    maturity: 'acelerando',
    total: 2220187,
    monthly: [
      { month: '2025-01', mentions: 52757 },
      { month: '2025-02', mentions: 59890 },
      { month: '2025-03', mentions: 51084 },
      { month: '2025-04', mentions: 76430 },
      { month: '2025-05', mentions: 83690 },
      { month: '2025-06', mentions: 74681 },
      { month: '2025-07', mentions: 105646 },
      { month: '2025-08', mentions: 117983 },
      { month: '2025-09', mentions: 108876 },
      { month: '2025-10', mentions: 151545 },
      { month: '2025-11', mentions: 140028 },
      { month: '2025-12', mentions: 157389 },
      { month: '2026-01', mentions: 182035 },
      { month: '2026-02', mentions: 199529 },
      { month: '2026-03', mentions: 219055 },
      { month: '2026-04', mentions: 205003 },
      { month: '2026-05', mentions: 234566 }
    ]
  },

  'local_contemporaneo': {
    id: 'local_contemporaneo',
    name: 'Lo local busca verse contemporáneo',
    color: '#12001F',
    maturity: 'acelerando',
    total: 1944559,
    monthly: [
      { month: '2025-01', mentions: 40814 },
      { month: '2025-02', mentions: 48750 },
      { month: '2025-03', mentions: 60723 },
      { month: '2025-04', mentions: 62918 },
      { month: '2025-05', mentions: 67603 },
      { month: '2025-06', mentions: 72287 },
      { month: '2025-07', mentions: 76776 },
      { month: '2025-08', mentions: 110641 },
      { month: '2025-09', mentions: 115104 },
      { month: '2025-10', mentions: 109337 },
      { month: '2025-11', mentions: 133643 },
      { month: '2025-12', mentions: 151115 },
      { month: '2026-01', mentions: 173813 },
      { month: '2026-02', mentions: 156966 },
      { month: '2026-03', mentions: 171419 },
      { month: '2026-04', mentions: 177173 },
      { month: '2026-05', mentions: 215477 }
    ]
  },

};

export default signalEvolution;
