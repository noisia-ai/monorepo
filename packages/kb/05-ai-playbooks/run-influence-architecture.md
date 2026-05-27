# Run Influence Architecture — Playbook operativo

## Inputs requeridos

| Input                          | Mínimo viable                                              | Ideal                                                |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| Comunidades identificadas      | 3-5 comunidades relevantes                                 | 8-15 incluyendo adyacentes y disruptivas             |
| Corpus de contenido + interacciones | 2,000-5,000 piezas con metadata de autor, fecha, RTs, citas | 10,000+ con archivos / podcasts / newsletters       |
| Window temporal                | ≥6 meses                                                   | 12-24 meses para detectar emergentes                 |
| Definición de categoría        | Lista clara de qué temas / hashtags / términos delimitan la categoría | + criterios de exclusión explícitos    |
| Pregunta de negocio            | Una frase                                                  | + decisión específica (activación, monitoreo, defensa) |

## Pre-flight check

1. **¿Las comunidades están delimitadas o son hashtag soup?** Una comunidad tiene moderación, vocabulario distintivo, miembros recurrentes. "Gente que usa #skincare" no es comunidad, es etiqueta.
2. **¿Hay metadata suficiente de autores?** Necesitas: handle/identificador, plataforma, fecha de actividad, frecuencia de posting, audiencia visible, interacciones recibidas. Sin metadata, no hay red.
3. **¿La window temporal es ≥6 meses?** Menos no permite distinguir nodo estable de pico viral pasajero.
4. **¿Las comunidades cubren el espectro?** Si solo hay comunidades "amigas" de la categoría, faltan los dissenters y gatekeepers — output sesgado a optimismo.

**Si falla → abortar o pedir cobertura adicional.**

## Protocolo

### Paso 1 — Construcción del grafo

**Acción:** Para cada autor identificado en el corpus, registrar:
- Identificador (handle, URL, etc.).
- Comunidad principal (la que más contribuye / le contribuye).
- Conexiones explícitas (citas, RTs, replies, menciones, enlaces).
- Conexiones implícitas (vocabulario compartido, referencias compartidas).

Esto produce un grafo: nodos (autores) + edges (relaciones).

**Criterio de éxito:** entre 200 y 800 nodos en el grafo principal después de filtrar autores con <3 interacciones (ruido).

### Paso 2 — Cálculo de centralidades

Para cada nodo, calcular las 3 métricas:

- **Degree centrality** (cuántas conexiones directas).
- **Betweenness centrality** (cuántas veces aparece en el camino más corto entre otros nodos).
- **Eigenvector centrality** (qué tan conectado está a otros nodos centrales — autoridad heredada).

**Si el equipo / IA no tiene tooling para calcular centralidades formales** (NetworkX, Gephi, etc.), aproximar:
- Degree → conteo simple de interacciones recibidas.
- Betweenness → conteo de comunidades distintas a las que el nodo conecta (proxy).
- Eigenvector → ¿quién cita a este nodo? Si es citado por nodos de alto degree, hereda autoridad.

Reportar metodología de cálculo siempre.

### Paso 3 — Tipificación de nodos

Para cada nodo en el top 30-50 por betweenness y eigenvector, asignar tipo:

**Innovator:**
- Audiencia chica (típicamente <50K en plataformas masivas, o <5K en comunidades nicho).
- Vocabulario distintivo que empieza a aparecer en otros nodos 3-6 meses después.
- Ratio alto de contenido propio vs. compartido.
- Adopta cosas que fallan también — no toda innovación escala.

**Early adopter:**
- Adopta segundo pero legitima.
- Suele tener autoridad técnica o cultural en la comunidad.
- Vocabulario propio + adopta el del innovator con sello propio.

**Validator:**
- Citado por otros como prueba.
- No adopta primero, pero cuando habla, otros se mueven.
- Eigenvector alto.

**Connector:**
- Activo en ≥3 comunidades con vocabulario distintivo de cada una.
- Bajo en producción de contenido propio, alto en circulación.
- Betweenness alto, degree medio.
- **Suelen ser invisibles a métricas de plataforma. Aquí está el oro de la metodología.**

**Dissenter:**
- Articula contra-narrativa de manera coherente y replicada.
- En crisis, su frame es el que otros adoptan para criticar la categoría/marca.
- No es hater random — tiene argumentos que se sostienen.

**Gatekeeper:**
- Modera comunidad, cura contenido, decide qué entra a un espacio.
- Poder estructural más que reach.
- Identificable por rol explícito (mod, editor, curator) o implícito (cuando posa, otros responden con deferencia).

**Edge case:** un nodo puede cumplir múltiples roles. Asignar el dominante; anotar secundarios.

### Paso 4 — Mapeo de ties

Para cada nodo top, clasificar sus conexiones:

- **Ties fuertes** — interacciones frecuentes, mismas comunidades, vocabulario compartido.
- **Ties débiles** — conexiones cross-community, menos frecuentes pero estructuralmente más informativas.

**Reportar nodos con alto ratio de ties débiles** — son los puentes estructurales (Granovetter). Suelen ser connectors.

### Paso 5 — Reconstrucción de propagación de narrativas reales

Tomar 3-5 narrativas significativas de la categoría (un cambio de vocabulario, una práctica nueva, una controversia) y reconstruir cómo se propagaron:

- ¿Quién la introdujo (innovator / early adopter)?
- ¿Quién la legitimó (validator)?
- ¿Quién la circuló entre comunidades (connector)?
- ¿Quién la bloqueó o produjo contra-narrativa (dissenter / gatekeeper)?
- ¿Cuánto tardó cada salto?

Esto valida que la tipología asignada en paso 3 funciona — si el narrative tracking no calza con la tipificación, hay error en algún paso.

### Paso 6 — Priorización de nodos a activar / monitorear / investigar

Para cada nodo top, recomendación:

- **Activar (relación)** — nodos con alta centralidad, fit cultural con la marca, sin conflictos previos. Plan: relación, no transacción.
- **Monitorear** — nodos importantes que hoy no son foco pero podrían volverse críticos (emergentes, dissenters latentes).
- **Investigar más** — nodos detectados pero con metadata insuficiente para clasificar bien.
- **Excluir** — nodos con conflictos previos, fit cultural malo, o riesgo reputacional.

### Paso 7 — Construcción del Early Warning System

Identificar 5-10 nodos cuya conducta es predictiva de movimientos de categoría. Definir:
- Qué señales mirar de cada uno (cambio de vocabulario, adopción de competidor, crítica nueva).
- Frecuencia de revisión recomendada.
- Quién es responsable del monitoreo.

## Criterios de codificación

### Diferenciar follower-count de centralidad

Un creador con 2M de followers y bajo betweenness es un broadcaster, no un connector. Reportar centralidad **siempre antes** de follower-count en outputs.

### Validar tipificación con narrative tracking

Si tipificas a alguien como "innovator" pero no se replica su vocabulario en otros nodos 3-6 meses después, no es innovator — es alguien con vocabulario raro propio que no escaló. Re-clasificar.

### Excluir nodos artificiales

Excluir o etiquetar:
- Cuentas que parecen orgánicas pero pertenecen a marcas (incluido la cliente y competidores).
- Bots o cuentas con patrones automatizados.
- Cuentas con engagement comprado (ratios sospechosos: muchos followers, pocas interacciones reales).

## Formato de output

### Output 1 — Influence Architecture Map (visualización + JSON)

```json
{
  "categoria": "...",
  "comunidades_mapeadas": ["...", "...", "..."],
  "total_nodos_relevantes": 287,
  "nodos_top": [
    {
      "id": "@username_o_url",
      "comunidad_principal": "...",
      "comunidades_secundarias": ["...", "..."],
      "tipo_dominante": "connector",
      "tipo_secundario": "validator",
      "centralidades": {
        "degree": 142,
        "betweenness": 0.087,
        "eigenvector": 0.042
      },
      "ratio_ties_debiles": 0.61,
      "vocabulario_distintivo": ["...", "..."],
      "recomendacion": "activar (relación)",
      "fit_cultural_marca": "alto",
      "riesgos": "..."
    }
  ],
  "limitaciones": "..."
}
```

### Output 2 — Key Nodes Dossier (1 ficha por nodo top, 15-30 nodos)

Por cada nodo:
- Identidad, plataforma principal, audiencia visible.
- Tipo de nodo + evidencia.
- Comunidades que conecta.
- Tono de discurso típico.
- Riesgos (controversias previas, posturas que podrían chocar con la marca).
- Valor estratégico de la relación.

### Output 3 — Activation Strategy (narrativo, 2-4 páginas)

Por nodo recomendado para activar:
- Rationale.
- Tipo de relación a construir (no transacción).
- Cadencia sugerida.
- Contenido / acción que tendría sentido para ese nodo (no para la marca — para él/ella).
- Indicador de éxito.

### Output 4 — Early Warning System (1 página + dashboard de monitoreo)

Lista de nodos a monitorear con:
- Qué mirar.
- Cadencia.
- Responsable de seguimiento.

## Quality gates

- [ ] Las 3 centralidades están reportadas (no solo degree).
- [ ] Los 6 tipos de nodo están representados o ausencia justificada.
- [ ] Hay narrative tracking que valida la tipificación.
- [ ] Cada nodo top tiene fit cultural marca evaluado, no solo centralidad.
- [ ] La recomendación de activación es relacional, no transaccional.
- [ ] Cero recomendación de "comprar al influencer X". Eso no es Influence Architecture.
- [ ] Confianza calibrada por nodo (alta = >12 meses de actividad consistente; baja = emergente).

## Failure modes conocidos

| Síntoma                                                  | Causa                                                       | Cómo corregir                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Top 10 son todos los más grandes por followers.          | Solo degree centrality, falta betweenness y eigenvector.    | Re-correr cálculo con las 3 métricas.                         |
| No hay connectors en el top 30.                          | Comunidades mapeadas son muy similares — no hay puentes que mapear. | Sumar comunidad estructuralmente distinta (adyacente o disruptiva). |
| Todos los nodos top tienen tipo "validator".             | El paso 3 colapsó por falta de criterio diferenciador.      | Re-aplicar diagnósticos del archivo de metodología por tipo. |
| El cliente quiere lista de influencers para contratar.   | Mismatch de expectativa.                                    | Reset: IA da topología; activación es trabajo posterior y relacional. |

## Versionado

| Fecha       | Cambio                                                                              | Razón                                                                |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-05-04  | Versión inicial con tipología 6 nodos × 3 centralidades + ties Granovetter.         | Formaliza el cruce que evita reducir IA a "lista de big accounts".    |
