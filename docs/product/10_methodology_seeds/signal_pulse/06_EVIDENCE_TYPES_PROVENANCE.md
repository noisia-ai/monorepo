# 06 — Evidence types and provenance

## Propósito

Signal Pulse debe poder defender cada señal con evidencia trazable. Evidence no significa solo comentarios o menciones. Significa cualquier registro que ayude a sostener una lectura de marketing.

## Tipos de evidencia

| Tipo | Ejemplos | Uso principal |
|---|---|---|
| Comment | TikTok, YouTube, Instagram, X, Reddit | Voz del consumidor |
| Review | App reviews, Google, Birdeye, marketplaces | Percepción de experiencia/producto |
| Post | Post orgánico de marca, creator, competidor | Contenido y narrativa |
| Ad / creative | Campaña o anuncio pagado | Pauta, claim, performance |
| Performance record | Métricas de ads/orgánico | ROI, alignment, budget defense |
| Author / creator | Top authors, influencers, comunidades | Amplificación, creators |
| Entity | SKU, tienda, campaña, producto, región | Segmentación y joins |
| Knowledge source | Brief, brand book, research, legal | Contexto y restricciones |
| Query provenance | Query pack, import batch, connector run | Trazabilidad técnica |

## Evidence item mínimo

Todo evidence item debe poder responder:

- qué es;
- de dónde viene;
- cuándo ocurrió;
- a qué fuente pertenece;
- qué periodo alimenta;
- qué señal soporta;
- qué fragmento o métrica es relevante;
- qué limitación tiene;
- si es visible al cliente.

## Provenance obligatorio

Cada evidence item debe apuntar a:

- source dataset;
- source run;
- connector or upload;
- raw source record si existe;
- normalized record;
- import batch o equivalente;
- query pack si aplica;
- mapping version;
- period bucket;
- entity refs.

## Evidence pack por señal

Cada señal debe tener un evidence pack con:

| Campo | Descripción |
|---|---|
| protagonist evidence | evidencia más representativa |
| support evidence | evidencia adicional |
| counter evidence | señales contradictorias o matices |
| source mix | composición por fuente |
| period coverage | meses donde aparece |
| author/creator highlights | autores relevantes si aplica |
| performance support | si hay contenido/pauta relacionada |
| confidence notes | por qué la señal es fuerte o débil |
| limitations | sesgo, gaps, baja cobertura |

## Reglas de evidencia

1. Ningún marketing move se publica sin evidencia mínima.
2. La evidencia debe estar conectada al periodo analizado.
3. Si una recomendación usa data de performance, debe mostrar métrica y periodo.
4. Si una señal usa TikTok o comentarios como evidencia cualitativa, no debe presentarse como volumen total de mercado.
5. Si la evidencia viene de fuente dominada por una plataforma, debe mostrarse source bias.
6. Si hay contradicción, debe aparecer como caveat o counter evidence.
7. Evidencia sensible puede ocultarse al cliente, pero debe existir internamente.
8. Las citas largas deben truncarse en card y abrirse completas en drawer.
9. No anonimizar artificialmente si el dato público ya trae handle, pero respetar políticas internas de privacidad.
10. Si no se puede mostrar link externo, conservar referencia interna.

## Evidence drawer

Cada drawer debe contener:

- título de la señal;
- explicación corta;
- filtro aplicado;
- lista de evidencias;
- fuente;
- fecha;
- emoción/polaridad;
- texto o métrica;
- link o ref;
- tags;
- relación con marketing move;
- botón para abrir en Corpus View;
- botón para agregar al Composer;
- warning si la evidencia es limitada.

## Counter evidence

Signal Pulse debe tener espacio para matices. No todo es confirmación.

Ejemplo:

- Señal: “Contenido práctico supera aspiracional.”
- Counter evidence: “En audiencias nuevas, la aspiración todavía genera mayor awareness.”
- Implicación: “No eliminar aspiración; moverla a awareness y usar prueba concreta en consideration/performance.”

## Confidence por evidence pack

La confianza se calcula con factores visibles:

- volumen suficiente;
- consistencia temporal;
- diversidad de fuentes;
- recencia;
- claridad semántica;
- calidad de citas;
- relación con performance;
- baja contradicción;
- comparabilidad de periodo.

## Evidence visibility

| Rol | Qué ve |
|---|---|
| Cliente | evidencia curada, citas, fuentes, charts, limitaciones visibles |
| Agencia | evidencia curada + assets/campaigns autorizados |
| Interno Noisia | todo, incluyendo refs técnicas y raw metadata |
| Admin | todo + mappings + runs + errores |

## Regla final

La evidencia no es apéndice. Es el mecanismo que convierte una lectura de IA en una decisión defendible.
