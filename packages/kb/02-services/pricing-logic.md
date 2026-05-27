# Pricing logic

> **No hay rate card.** Cada propuesta se construye contra la pregunta específica.
> Este archivo documenta la **lógica** del cálculo, no los montos. Los montos viven en el sistema interno de propuestas.

## Principio de pricing

> **Cobramos por inteligencia construida, no por horas.**

Esto importa porque define qué **no** se cobra:
- No se cobra acceso a herramientas (no revendemos software).
- No se cobra horas trabajadas (proyectos pueden tomar más o menos tiempo según complejidad real).
- No se cobra por número de menciones analizadas (esa métrica no es valor).

Se cobra por:
- La pregunta de negocio respondida.
- La metodología(s) aplicada(s).
- La construcción del corpus específico para esa pregunta.
- La síntesis e interpretación.
- La transferencia trazable de evidencia al cliente.

## Variables que determinan el precio

### V1 — Cantidad y combinación de metodologías

| # de metodologías | Tier típico            | Justificación                                                  |
| ----------------- | ---------------------- | -------------------------------------------------------------- |
| 1                 | Foundation (mín)       | Diagnosis directa de una pregunta.                             |
| 2                 | Foundation (alto) o Intelligence (mín) | Combinación de lentes para enriquecer.   |
| 3-4               | Intelligence           | Lectura cruzada — síntesis cruzada agrega complejidad.         |
| 5+ o continuo     | Strategy               | Sistema metodológico, no proyecto.                             |

Cada metodología adicional **no es lineal** en costo — la síntesis cruzada crece más rápido que la suma de partes. Combinar 3 metodologías cuesta más que correr 3 metodologías por separado.

### V2 — Profundidad y diversidad de fuentes

| Cobertura de fuentes                        | Multiplicador relativo   |
| ------------------------------------------- | ------------------------ |
| 3-4 fuentes de uso común (Amazon, Reddit, X) | base                     |
| + foros de nicho o comunidades cerradas     | × 1.2-1.4                |
| + audio/video transcrito (podcasts, YouTube) | × 1.3-1.5                |
| + fuentes especializadas (industria-vertical) | × 1.5-1.8               |
| + corpus archivístico histórico             | × 1.8-2.5                |

El cliente paga por la **construcción** del corpus, no por su existencia. Fuentes nicho cuestan más porque requieren scrapers especializados, validación de calidad, y curación humana.

### V3 — Alcance temporal del corpus

| Window temporal             | Multiplicador relativo   |
| --------------------------- | ------------------------ |
| 3-6 meses (estándar)        | base                     |
| 6-12 meses                  | × 1.1-1.2                |
| 12-24 meses                 | × 1.3-1.5                |
| Histórico extenso (>24m)    | × 1.5-2.0                |

Más window = más datos a normalizar y codificar = más costo.

### V4 — Alcance geográfico

| Mercados                    | Multiplicador relativo   |
| --------------------------- | ------------------------ |
| 1 país / mercado            | base                     |
| 2-3 países comparables      | × 1.6-1.9                |
| 4-6 países                  | × 2.2-2.8                |
| Multi-mercado con análisis cruzado | × 2.8-3.5         |

Cada mercado nuevo no es +50% del costo — es ~80% (cada mercado tiene corpus propio, validación local de codificación, y la síntesis cruzada agrega trabajo).

### V5 — Alcance competitivo

| Comparativo                     | Multiplicador relativo   |
| ------------------------------- | ------------------------ |
| Solo marca cliente              | base                     |
| Cliente + 1-2 competidores      | × 1.4-1.7                |
| Cliente + 3-5 competidores      | × 1.9-2.4                |
| Análisis competitivo exhaustivo | × 2.5+                   |

### V6 — Modalidad

| Modalidad                       | Lógica                                                   |
| ------------------------------- | -------------------------------------------------------- |
| Foundation (proyecto puntual)   | Fee fijo, pago a hito (kickoff / midpoint / entrega).    |
| Intelligence (proyecto puntual) | Fee fijo, pago en 3-4 hitos.                             |
| Strategy (retainer evolutivo)   | Mensual fijo + ajustes trimestrales si scope cambia.     |
| Custom (caso especial)          | Caso-a-caso con contrato específico.                     |

### V7 — Urgencia (deadline contraído)

Si el cliente necesita timeline acelerado significativamente bajo el típico:

| Aceleración                | Multiplicador           |
| -------------------------- | ----------------------- |
| Estándar                   | base                    |
| -25% del tiempo típico     | × 1.2-1.3               |
| -50% del tiempo típico     | × 1.5-1.8 (caso a caso) |
| Urgencia menor a 3 semanas | Caso a caso, alto       |

Aceleración cuesta porque requiere paralelización de equipo, no porque "el equipo trabaje más rápido". El paralelismo cuesta proporcionalmente más que el tiempo lineal.

## Lo que NO modifica el precio

- Tamaño del cliente o su capacidad de pago. No hay pricing por industria ni por revenue del cliente.
- Tamaño del corpus en menciones absolutas (no cobramos por mention count).
- Tamaño del entregable (no cobramos por número de páginas).
- Si el output confirma o desafía la hipótesis del cliente.

## Lógica del diagnóstico previo gratuito

El diagnóstico inicial (8-10 minutos del cliente, lectura por arquitecto Noisia) es **gratuito**. Razones:

1. Sin diagnóstico, la propuesta sería genérica (rate card disfrazado).
2. El diagnóstico filtra clientes con mismatch antes de comprometer tiempo.
3. Permite al cliente comparar diagnósticos de Noisia con otras firmas sin compromiso.
4. La propuesta que sale del diagnóstico es defensible — cada variable de pricing sale del diagnóstico, no del aire.

## Cuándo se cobra antes de empezar

- **Foundation:** 50% al kickoff, 50% a entrega.
- **Intelligence:** 30% al kickoff, 30% al midpoint, 40% a entrega.
- **Strategy:** mensual con orden de compra trimestral o anual. Renovación con revisión de scope cada trimestre.

## Términos comerciales

- **NDA estándar** firmable antes de cualquier diagnóstico (no-negociable: la confidencialidad de la pregunta y del corpus).
- **Propiedad de evidencia:** todo el corpus, codificación y AI-Brief es del cliente al cierre.
- **No exclusividad de categoría** — Noisia puede operar para múltiples clientes en categorías solapadas, separando equipos.
- **Excepción de exclusividad:** Strategy puede negociar exclusividad de marca dentro de un sub-segmento por costo adicional, caso a caso.

## Lo que el cliente paga implícitamente

(Componentes del costo que no se desglosan en factura pero entran al precio.)

- Construcción y mantenimiento de la infraestructura propia (scrapers, normalización, enriquecimiento).
- Tiempo de protocolo: cada propuesta toma horas de equipo Noisia para diseñarse.
- Tiempo de QA y revisión: ningún output sale sin doble pase de revisión interna.
- Tiempo del lead estratégico que firma el output.

## Cuándo se decide no cobrar (excepción rara)

- **Pro bono:** ONGs o proyectos con propósito social donde la inteligencia social tiene impacto desproporcionado. Decisión caso a caso.
- **Investigación propia:** Noisia puede correr metodologías sin cliente para alimentar la práctica. Esto es interno, no se factura.

## Quien aprueba la propuesta final

Toda propuesta de Foundation/Intelligence/Strategy pasa por al menos:
1. El arquitecto Noisia que llevó el diagnóstico.
2. Lead estratégico que validó el alcance.
3. Quien firmará la entrega (lead del proyecto + senior si aplica).

Este filtro de 3 personas evita propuestas con scope mal-calibrado o pricing fuera de lógica.

## Lo que NO está en este archivo (a propósito)

- Montos absolutos en USD/MXN/EUR. No viven aquí (ver sistema interno de propuestas).
- Múltiplos exactos. Las variables de arriba son rangos orientativos — el número final lo calibra el lead.
- Descuentos por volumen / multi-proyecto. Caso a caso, no codificado.

## Referencias

- Sitio público: `/servicios` → la lógica está visible pero sin variables explícitas.
- Diagnóstico previo: `03-process/diagnostic-protocol.md`.
- Tier files: `02-services/foundation.md`, `intelligence.md`, `strategy.md`.
