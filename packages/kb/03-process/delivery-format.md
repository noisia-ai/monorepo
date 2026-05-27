# Delivery Format

> Cómo se estructura, se viste y se entrega un proyecto Noisia.
> El output cambia según el tier, pero los principios de formato son comunes.

## Principios de formato

### F1 — Legibilidad para C-level

El cuerpo principal del entregable se lee en 30-45 minutos por un C-level que no estuvo en el día a día. Si para entender el output el cliente tiene que leer 80 páginas técnicas, el output falló.

La granularidad metodológica vive en **anexos**.

### F2 — Cero gráficos decorativos

Cada gráfico cumple una función. Si quitarlo no afecta la comprensión del hallazgo, se quita. Esto excluye:
- Iconografía decorativa.
- Word clouds (rara vez son insight).
- Bar charts de "menciones por mes" sin diagnosis.
- Sankey diagrams "porque se ve sofisticado".

### F3 — Citas literales sin maquillaje

Las citas se transcriben exactas, con la ortografía y el lenguaje del autor original. La imperfección es información. "Limpiar" una cita le quita densidad cultural.

### F4 — Limitaciones explícitas, no escondidas

La sección "Lo que esta corrida no respondió" tiene la misma jerarquía visual que la sección de hallazgos principales. No se relega a anexo ni se omite.

### F5 — Una recomendación tiene que ser implementable el lunes

Si una recomendación no se puede empezar a implementar el lunes siguiente, es opinión, no recomendación. Toda recomendación lleva:
- Acción concreta (qué hacer).
- Responsable sugerido (quién).
- Indicador de éxito (cómo se sabe si funcionó).
- Riesgo asociado (qué podría empeorar).

## Estructura por tier

### Foundation (20-40 páginas)

```
1. Resumen ejecutivo (1 página)
2. Pregunta y hipótesis evaluada (1 página)
3. Frame metodológico (2 páginas)
   - Por qué esta(s) metodología(s)
   - Qué responde, qué no
4. Corpus orquestado (2 páginas)
   - Fuentes, window, tamaño, criterios de exclusión
5. Hallazgos (10-20 páginas)
   - 3-7 hallazgos con evidencia
   - Cada hallazgo: enunciado, evidencia, cita representativa, confianza
6. Diagnóstico (2 páginas)
   - Sí / no / depende de
7. Limitaciones explícitas (1 página)
8. Próximo paso recomendado (1 página)
9. Anexos: corpus codificado, AI-Brief, fichas técnicas
```

### Intelligence (40-80 páginas)

```
0. Resumen ejecutivo (2 páginas)
1. La pregunta y lo que cambió desde el diagnóstico (1 página)
2. Frame metodológico (3-4 páginas)
   - Por qué este combo de metodologías
   - Qué responde cada una, qué responde el cruce
3. Corpus orquestado (2 páginas)
4. Hallazgos por metodología (15-30 páginas)
   - Sub-secciones por metodología
   - Cross-references entre metodologías
5. Lectura cruzada (5-8 páginas)
   - Las tensiones y resonancias entre los outputs
   - Aquí vive el valor diferencial de Intelligence vs. Foundation
6. Roadmap de activación (5-10 páginas)
   - Recomendaciones priorizadas
   - Cada una con acción / responsable / indicador / riesgo
7. Limitaciones explícitas (1 página)
8. Anexos extensos: outputs por metodología, corpus codificado, AI-Brief
```

### Strategy (entregables continuos)

No hay un único deliverable. Strategy entrega **continuamente**:

| Cadencia              | Entregable                                                          |
| --------------------- | ------------------------------------------------------------------- |
| Continuo              | Acceso al corpus vivo, alertas de movimiento de nodos / códigos.    |
| Quincenal             | Working session con stakeholders del cliente.                       |
| Mensual               | Pulse — 5-10 páginas con hallazgos del mes.                        |
| Trimestral            | State-of-Category Report (15-30 páginas) + revisión de protocolo.   |
| Semestral             | Auditoría profunda + redefinición de scope si aplica.               |
| Anual                 | Renovación con revisión completa + aprendizajes.                    |
| Bajo demanda          | Workshops de decisión cuando se acerca un punto de inflexión.       |

## Vehículo de entrega

### Formato técnico

- **PDF** — para distribución amplia interna del cliente.
- **Notion / Confluence** — cuando el cliente tiene wiki interno y quiere que el output viva ahí.
- **Deck (Keynote / Google Slides)** — para presentación a C-level o board.
- **CSV / JSON** — corpus codificado y AI-Brief, siempre.

### Sesión de Q&A

Todo entregable Foundation o Intelligence incluye sesión presencial o remota con el equipo del cliente. Mínimo 60 min (Foundation), 90-120 min (Intelligence). Strategy tiene Q&A continuo en working sessions.

La sesión NO es repaso del deck. Es:
- Validación de que el cliente entendió.
- Resolución de objeciones o dudas.
- Discusión de próximos pasos.

### Re-presentación a stakeholders adicionales

Si el cliente necesita re-presentar a stakeholders distintos (board, equipo regional, partners), Noisia ofrece:
- Versión condensada del deck (5-10 páginas).
- Sesión adicional de presentación facilitada por Noisia (con costo adicional, transparente).

## Branding del entregable

- Cabecera con logo Noisia.
- Identidad visual de Noisia (no del cliente — el output es producto Noisia).
- Footer con contacto y referencia al proyecto.
- Marca de agua en draft / final.
- Versionado: v1.0 (final), v0.9 (draft midpoint), etc.

Excepción: si el cliente pide white-label explícitamente y se acuerda en propuesta, se entrega sin marca Noisia. Caso a caso.

## Confidencialidad post-entrega

- El cliente decide si y cómo compartir el output internamente.
- Noisia no publica casos del cliente sin autorización explícita escrita.
- Noisia puede publicar **patrones generalizables aprendidos** sin identificar al cliente (typical en field-notes). Esto se acuerda en NDA.
- El corpus crudo nunca se publica.

## Lo que NO se entrega como output

- ❌ Brand guidelines, brand books, identidad visual (no es Noisia).
- ❌ Mock-ups creativos / route-cards de campaña (no es Noisia).
- ❌ Specs de producto / wireframes / prototipos (no es Noisia).
- ❌ Plan de medios con presupuestos por canal (no es Noisia).

Cuando el cliente espera estos outputs, hay mismatch. Recomendar partner especializado.

## El AI-Brief — formato técnico

Es el JSON estructurado que permite a otra IA del cliente operar con el output Noisia. Estructura mínima:

```json
{
  "proyecto": {
    "id": "...",
    "fecha_entrega": "2026-mm-dd",
    "tier": "intelligence",
    "pregunta_negocio": "..."
  },
  "metodologias_aplicadas": [
    {
      "slug": "triggers-y-barriers",
      "playbook_version": "2026-05-04",
      "output_principal": "ref://outputs/tb-map.json"
    }
  ],
  "hallazgos_principales": [
    {
      "id": "H-01",
      "metodologia": "triggers-y-barriers",
      "enunciado": "...",
      "confianza": "alta",
      "evidencia_ids": ["ID-T-PSI-01", "ID-T-PER-04"]
    }
  ],
  "limitaciones": [...],
  "corpus_referenciado": "ref://corpus/codified.json"
}
```

Esto convierte a Noisia en parte de la cadena de IA del cliente sin lock-in. **Es deliberado** y diferenciador.

## Versionado de entregables

- **v0.x** — drafts internos.
- **v0.9** — draft compartido al cliente para revisión midpoint.
- **v1.0** — entrega final.
- **v1.1+** — correcciones post-entrega (si las hay), con changelog.

Nunca se reemplaza una v1.0 — se publica una nueva versión y se mantienen ambas.

## Referencias

- Tiers: `02-services/foundation.md`, `intelligence.md`, `strategy.md`.
- Trazabilidad: `03-process/evidence-traceability.md`.
- Principios: `00-overview/principles.md`.
