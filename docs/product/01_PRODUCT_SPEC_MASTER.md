# Noisia Studio — Product Spec Master

> El documento central. Las 8 dimensiones del producto, las respuestas a cada una, y el bloque de mínimo para arrancar.

---

## 0. Resumen del producto

**Qué es:** una plataforma operativa de inteligencia social donde el equipo Noisia (Insights Managers, KAMs, UX Data Specialists) ejecuta análisis cualitativo basado en metodologías propias sobre conversación digital pública.

**Quién paga:** brand managers y agencias en México (próximamente LATAM hispanohablante). Pagan por consultoría, no por software.

**Qué hace distinto:** la inteligencia se diseña por pregunta, no por dashboard. Hay un **Engine de Validación de Queries** que combina IA con seeds de metodología para construir corpus accionables, no listas de menciones. El cliente recibe outputs curados por humanos del equipo Noisia, no acceso self-service a un dashboard genérico.

**Qué entrega al cliente:** un dashboard navegable conectado en vivo a la data + una vista Scrollytelling de la misma data, presentados periódicamente por el Insights Manager + notificaciones puntuales de WhatsApp cuando emerge algo relevante.

**Por qué importa la plataforma:** porque hoy todo el conocimiento Noisia vive en archivos, scripts, conversaciones de Slack y la cabeza del fundador. La plataforma estabiliza el flujo: ingesta → validación de query → corpus → metodología → output → curación → publicación. Reduce dependencia de personas individuales y hace el negocio escalable.

---

## 1. Entidades de negocio

### 1.1 Jerarquía organizacional

El sujeto de un corpus puede ser una **marca** (caso comercial típico) o un **tema** (estudio temático sin marca específica). Esto permite tanto trabajo cliente como estudios internos de Noisia (freebies tipo Cultural Foresight 2026).

```
Organización (Grupo Salinas / Church & Dwight / Noisia Internal)
    ├── Marcas                                 Themes
    │   (Elektra, Banco Azteca, Coppel,        (Cultural Foresight 2026,
    │    Oxiclean, Nair, Seguros El Potosí)     Future is Human,
    │                                           The Mexican Home, etc.)
    │           ↓                                       ↓
    │           └────────→ study_corpora ←──────────────┘
    │                       (1 corpus por sujeto × metodología)
    │                              ↓
    │                       Análisis temporal (corridas en el tiempo)
    │                              ↓
    │                       Outputs (Dashboard normal + Scrollytelling)
```

**Reglas:**

- Una **organización** (o grupo) puede tener varias **marcas**. Caso real: Grupo Salinas tiene Elektra, Banco Azteca, Coppel, Italika.
- Una **marca** puede tener varias **categorías o industrias**. Caso real: Church & Dwight tiene Oxiclean (detergente) y Nair (depilación) — categorías totalmente distintas, mismo dueño corporativo.
- Una **marca** puede aplicarse en varios **países** del bloque LATAM hispanohablante. Caso real: Elektra opera en varios países LATAM. En MVP cubrimos solo México, pero el schema soporta multi-país desde el día 1 para no rehacer.
- **Competidores se configuran a nivel `marca`**, no a nivel organización ni estudio. Cada marca tiene su lista propia de competidores relevantes para cada metodología.
- Un **corpus es 1:1 con la combinación (sujeto × metodología)**. El sujeto es **marca** O **tema** (nunca ambos, nunca ninguno). Decisión fundamental: no hay un corpus que sirva para varias metodologías porque cada metodología introduce sus propios seeds y sesgo positivo. Esto se valida en P3 de los principios del KB.
- **Themes (estudios temáticos) son nueva entidad respecto a versión previa de este spec.** Pueden tener `organization_id = NULL` (themes de Noisia internal) o asociarse a un cliente cuando se vuelven brand-specific en el futuro.

### 1.2 Roles del sistema

Tres tiers de roles. Cada uno con permisos distintos:

#### Tier Noisia (interno)

| Rol | Responsabilidad principal | Acceso |
|---|---|---|
| **Founder / Admin Global** | Configura Noisia Studio, gestiona equipo, ve métricas de plataforma | Todo |
| **KAM (Key Account Manager)** | Acompaña al cliente comercialmente, no opera análisis, aprueba propuestas | Todas las organizaciones que maneja, modo solo lectura sobre corpus |
| **Insights Manager** | El analista. Opera el Engine de Validación de Queries, cura corpus, ejecuta metodologías, presenta outputs al cliente | Lectura/escritura sobre las marcas que tiene asignadas |
| **UX Data Specialist** | Diseña componentes visuales custom cuando una metodología los pide. Mantiene el banco de charts | Modo creación/edición sobre el banco de componentes, lectura sobre corpus para entender qué viene |

#### Tier Cliente (externo, paga)

| Rol | Responsabilidad principal | Acceso |
|---|---|---|
| **Cliente Owner** | Persona que firma el contrato. Caso real: Alba en Church & Dwight. Da acceso a sus equipos | Toda la organización contratada, gestión de usuarios |
| **Brand Manager** | Persona responsable de la marca específica. Caso real: Romina en Elektra | Solo las marcas que le asignaron, ve sus outputs |
| **Agency Insights / Planner** | Persona externa del lado agencia. Caso real: Janeth en la agencia de Elektra | Modo solo lectura sobre las marcas a las que el Brand Manager le dio acceso |

#### Reglas de acceso

- El **Cliente Owner** da acceso a Brand Managers (sus marcas).
- El **Brand Manager** da acceso a Agency Insights (las suyas).
- **Cualquiera del tier cliente puede comentar** sobre cualquier insight/bloque, no editar.
- **Solo el Insights Manager** puede editar el corpus, los seeds, los queries, los outputs.
- **Auditoría completa**: quién comentó qué y cuándo queda en log.

### 1.3 Modelo comercial implícito

- El cliente paga por consultoría: tamaño del análisis (cantidad de menciones, fuentes, metodologías aplicadas) × frecuencia (puntual / recurrente).
- Quién consume del lado cliente es indistinto para el negocio. Lo que se cobra es el trabajo de Insights Manager + KAM + plataforma.
- Esto desacopla el pricing del modelo per-seat tradicional de SaaS. La plataforma es infraestructura del trabajo Noisia, no producto que el cliente opera.

---

## 2. Workflow interno

### 2.1 Estados del proceso

```
[Workshop offline opcional]
        ↓
[Propuesta KAM]
        ↓
[Aprobación KAM]
        ↓
[Configuración inicial — Insights Manager]
   ├── Marca + competidores
   ├── Metodología seleccionada (1 por corpus)
   └── Formulario de contexto (memoria por marca)
        ↓
[Engine de Validación de Queries]
   ├── IA genera primer query desde seeds de metodología + brand seeds
   ├── Loop de validación con la API de la fuente (SentiOne)
   ├── Insights Manager confirma en puntos críticos
   └── Corpus inicial generado (~12 meses por default)
        ↓
[Análisis automático con IA]
   ├── Codificación contra protocolo de la metodología
   ├── Extracción de evidencia, jerarquización, layers
   └── Genera draft de output JSON
        ↓
[Curación humana del Insights Manager]
   ├── Revisa hallazgos, citas, jerarquización
   ├── Edita corpus si hay ruido emergente (ver caso Bimbo NSFW)
   ├── Re-dispara análisis si edita corpus
   └── Aprueba el output
        ↓
[Revisión Cuentas / KAM]
        ↓
[Presentación al cliente]
   ├── Insights Manager + KAM presentan
   ├── Dashboard publicado, cliente tiene acceso
   └── Notificaciones WhatsApp configuradas
        ↓
[Cliente comenta / pide cambios]
        ↓
[Insights Manager actualiza]
        ↓
[Ciclos siguientes]
   └── Insights Manager re-dispara análisis cuando agrega data nueva
       o edita el corpus
```

### 2.2 Decisiones operativas explícitas

- **El workshop es offline y opcional.** Lo hacen Comercial + KAM + Insights Manager con notas propias. En el futuro la plataforma podría asistirlo, pero no es bloqueante hoy.
- **El KAM aprueba la propuesta antes de iniciar.** Pero hoy cualquiera del equipo Noisia con acceso a la plataforma puede crear un estudio — eso es proceso comercial fuera del scope plataforma. La plataforma asume que cuando aparece un estudio, ya fue aprobado.
- **Un corpus por (marca × metodología).** No combinar. Cada metodología introduce seeds que generan sesgo positivo intencional. Mezclar metodologías en el mismo corpus colapsa esa lente.
- **El corpus es editable siempre.** Si emerge ruido inesperado (caso real: en Bimbo apareció contenido NSFW asociado al nombre de marca), el Insights Manager edita los criterios de exclusión y re-dispara. Sin esto, los insights se ensucian.
- **Reviewer interno = el Insights Manager mismo + KAM en aprobación final.** El Insights Manager presenta al cliente — no es solo curador, es el rostro humano de Noisia frente al cliente.
- **El cliente puede pedir cambios.** Vía comments dentro de la plataforma, vía WhatsApp con el Insights Manager, o presencialmente. El Insights Manager los procesa, edita lo que aplique, re-dispara, vuelve a presentar.
- **El KAM acompaña, no lidera.** Es el dueño comercial de la relación. El Insights Manager es el dueño técnico.

### 2.3 Quality gates obligatorios antes de publicar al cliente

Inspirado en los principios P5 (trazabilidad) y P7 (confianza calibrada) del KB:

1. Cada hallazgo del output tiene cita de vuelta al corpus.
2. Cada hallazgo tiene nivel de confianza (alta / media / baja / direccional).
3. Sección "Lo que esta corrida no respondió" presente y firmada.
4. Insights Manager dio aprobación explícita en plataforma (log de aprobación).
5. KAM dio visto bueno comercial.
6. Comparativos competitivos (si los hay) están balanceados — ninguna marca con >60% del corpus comparativo.

Sin estos 6, la plataforma no permite publicar al cliente. Hard block.

---

## 3. Fuentes y corpus

### 3.1 Estrategia de fuentes

#### MVP (mes 1-3 del producto)

- **SentiOne** vía CSV descargado y vía API. Es la fuente principal hoy y cubre la mayoría de plataformas (X, Facebook, TikTok, YouTube, Instagram, Reddit, Reviews, blogs, news).
- **Upload manual de CSV** desde cualquier fuente que el Insights Manager tenga a mano.

#### Inmediatamente después (mes 4-6)

- **Datashake** (API + JSONL export). Útil para volúmenes grandes y casos puntuales por pregunta.
- **Apify** (orquestación). Útil para scrapers de un solo cliente que pide algo específico.

#### Integración como producto vivo

El sistema debe permitir al Insights Manager **agregar una nueva fuente sin pedir desarrollo**. UI de configuración de integración:

- Form para meter API key, secret, base URL, headers.
- Form para mapear el response del API a los campos canónicos del schema Noisia (text, author, date, url, platform, etc.).
- Soporte para webhooks de entrada.
- Validación: el Insights Manager hace una prueba con 10 menciones antes de activar la integración para el corpus.

**Caso de uso típico:** un cliente pide LinkedIn, ninguna integración estándar lo tiene, Apify tiene un actor que sí lo trae. El Insights Manager configura Apify con el actor de LinkedIn, mapea campos, valida 10 menciones, activa. La data entra al corpus normalizada.

**Punto crítico:** mientras el formato no esté 100% normalizado, las menciones de la fuente emergente deben poder ser interpretadas igualmente por Claude/OpenAI con el texto bruto. La normalización completa puede venir después; la interpretabilidad debe ser inmediata.

### 3.2 Qué se guarda

- **Menciones completas** del corpus operante del cliente. No solo metadatos. Texto completo, autor, fecha, plataforma, URL, engagement, sentiment de la fuente, etc.
- **Raw data del API** cuando la fuente lo provee, en campo `raw_metadata` jsonb. Si después descubrimos que un campo importa, está ahí sin re-importar.
- **Versiones del corpus** cuando el Insights Manager edita criterios. No sobrescribir — versionar. La auditoría es parte del valor.
- **Queries que se intentaron y descartaron** durante la validación. Eso alimenta el aprendizaje del Engine. Cada query fallido es una lección.

### 3.3 Engine de Validación de Queries

Este es el componente central de Noisia Studio. Lo más diferenciador. Su funcionamiento:

```
[Insights Manager configura: marca + metodología + competidores]
        ↓
[IA genera primer query basado en:
   - Brand seeds (Inmuebles24, Banamex, etc. según marca)
   - Signal phrases de la metodología (seeds propios de T&B, VPM, etc.)
   - Exclusiones globales (ruido conocido por industria)
   - Memoria por marca/industria/cliente (aprendizaje acumulado)
]
        ↓
[Query se envía a la API de fuente (SentiOne)]
        ↓
[Vuelve volumen y muestra]
        ↓
[IA evalúa la muestra:
   - ¿Hay densidad temática?
   - ¿Hay sesgo de fuente única?
   - ¿Hay ruido detectable?
   - ¿Está en idioma esperado?
]
        ↓
[IA propone ajustes: agregar phrases, excluir términos, ajustar fuentes]
        ↓
[Insights Manager confirma o ajusta manualmente]
        ↓
[Loop hasta que la calidad pasa quality gates]
        ↓
[Corpus aprobado]
```

**Lo que ve el Insights Manager:**

Un progress bar, métricas del intento actual (volumen, densidad, ruido detectado), y solicitudes puntuales de confirmación cuando la IA no puede decidir sola. No ve los queries crudos del API. Esa complejidad vive en backend.

**Lo que NO ve el cliente:**

Nada de esto. El cliente ve el output final. El corpus, los queries, las decisiones de exclusión son interno Noisia.

### 3.4 Curación humana en el corpus

Inspirado en `corpus-construction.md` del KB:

Puntos donde el Insights Manager interviene obligatoriamente:

1. **Validación de fuentes** al inicio. ¿Estas son las fuentes que importan para esta marca y pregunta?
2. **Sampling de calidad** durante ingesta. Plataforma muestra 50-100 piezas aleatorias y el Insights Manager confirma.
3. **Validación de codificación.** Cuando la IA clasifica el corpus contra el protocolo de la metodología, doble pase humano sobre 5-10% del corpus para validar que las clasificaciones son correctas.
4. **Cierre de corpus.** El Insights Manager firma explícitamente que el corpus está listo antes de que la metodología corra el análisis final.

La plataforma no permite saltarse ninguno de los 4. UI explícita para cada paso.

### 3.5 Qué es "ruido"

El KB del corpus de Noisia define los criterios. La plataforma los aplica automáticamente con override del Insights Manager:

**Excluido por default:**
- Content de marca oficial (posts de la marca misma).
- Testimoniales incentivados explícitos.
- Reseñas con timestamps sospechosos (bot farms).
- Repeticiones literales de claims oficiales.
- Bots detectables.
- Conversación que el autor eliminó después.

**Evaluado caso por caso (UI muestra al Insights Manager):**
- Reviews tras incentivo no declarado.
- Contenido traducido automáticamente.
- Threads truncados sin contexto.

**Nuevos criterios emergentes:**
- El Insights Manager puede agregar exclusiones en cualquier momento. Caso Bimbo: agregar exclusiones de términos NSFW que aparecieron asociados al nombre.

---

## 4. Metodologías

> **Este bloque tiene su propio archivo: `02_METHODOLOGIES_CATALOG.md`.** Cubre las 6 metodologías Noisia con el template completo (nombre, objetivo, preguntas, inputs, outputs, componentes visuales, criterios de calidad, prompts base, memoria de industria, estructura del resultado).

Resumen aquí para mantener el master coherente:

### 4.1 Catálogo

Las 6 metodologías propietarias de Noisia (todas vienen del KB público):

1. **Triggers & Barriers** — qué motiva y qué frena la decisión del consumidor. **Primera a implementar en MVP.**
2. **Value Perception Matrix** — cómo se percibe el valor de una marca vs. competidores en términos del consumidor real.
3. **Journey Friction Mapping** — dónde se cae la conversión en el journey real (no el del workshop).
4. **Cultural Codes Decoding** — qué códigos culturales están vigentes en la categoría y cuáles se están moviendo.
5. **Influence Architecture** — qué nodos mueven la conversación de la categoría (y no son los más grandes).
6. **Decision Velocity** — qué tan rápido toma decisiones la audiencia en esta categoría y por qué se acelera o frena.

### 4.2 Cómo se modelan como sistema

Cada metodología tiene la misma estructura en plataforma:

- **Definición conceptual** (qué pregunta responde, cuándo aplica, cuándo no, fundamentos teóricos).
- **Playbook ejecutable** (inputs requeridos, pre-flight check, protocolo paso a paso, criterios de codificación, formato del output, quality gates, failure modes).
- **Componentes visuales del dashboard** (qué charts, qué tarjetas, qué jerarquía).
- **Prompts base para IA** (qué exactamente se le pide a Claude/GPT al ejecutar).
- **Memoria por industria** (qué aprendizajes acumulados consulta antes de operar).
- **Estructura del JSON resultante** (forma del output que Codex renderiza).

La plataforma debe permitir agregar metodologías nuevas sin tocar código — sí tocar config. Cada metodología es un módulo declarativo.

### 4.3 Decisiones específicas del bloque metodologías

- **Una metodología por corpus.** Reafirma 1.1. No mezclar.
- **El cliente no elige metodología.** El Insights Manager la elige basándose en la pregunta de negocio. El cliente recibe la justificación.
- **No publicar Decision Velocity en MVP.** Es la más conductual y la que más estructura adicional necesita. Posponer 6 meses.
- **Cultural Codes Decoding y Value Perception Matrix son las segundas a implementar.** Después de T&B funcional.

---

## 5. Outputs

### 5.1 Naturaleza del entregable

**El estudio es un dashboard.** No es un PDF. No es un PowerPoint. No es un Markdown. Es un dashboard conectado en vivo a la data, hospedado en Noisia Studio, al que el cliente accede con sus credenciales.

**Cada dashboard tiene 2 vistas de la misma data:**

| Vista | Para qué sirve | Cuándo se usa |
|---|---|---|
| **Dashboard normal** | Navegación libre, exploración por bloque, filtros, drill-down | Cuando el cliente quiere indagar o validar algo después de la presentación |
| **Scrollytelling** | Narrativa lineal pre-curada de los hallazgos, formato vertical (como TikTok pero de data) | Cuando el cliente quiere recorrer la historia completa, especialmente en mobile o para compartir con equipo |

Ambas vistas comparten el mismo backend de data. Cambiar el corpus actualiza ambas.

### 5.2 Componentes del dashboard

Cada dashboard se compone de **bloques modulares**. Cada metodología trae su set de bloques default. El Insights Manager puede agregar o quitar bloques del banco. Si necesita uno que no existe, lo solicita al UX Data Specialist quien lo diseña, lo registra en el banco, y queda disponible para futuros estudios.

**Tipos de bloque:**

- **Charts predefinidos** — bar, line, area, heatmap, treemap, sankey, scatter, radar. Curados con la estética Noisia.
- **Cultural Tension Cards** — la tensión central de un hallazgo + cita + implicación.
- **Evidence Lists** — lista de citas con plataforma, fecha, brand pill, link a fuente.
- **Brand Pills** — detección automática de marca en cita.
- **Action Map** — matriz Hacer / Evitar / Categorías por hallazgo.
- **Maturity Badges** — clasificación emergente / acelerando / mainstreaming.
- **Hero Stats** — números clave del corpus (volumen, fuentes, periodo).
- **Methodology Note** — explicación de cómo se llegó al output.
- **Comparative Block** — comparativo entre marcas o entre periodos.
- **Custom blocks** — diseñados ad-hoc por el UX Data Specialist cuando una metodología lo pide. Caso: un Customer Journey Map con steps específicos.

Cada bloque es un componente React/Vue versionado en el banco. Cuando el cliente activa/desactiva, no se borra — se hide.

### 5.3 Quién activa qué

- **Cada metodología trae sus bloques default** según los outputs del playbook (en T&B: Triggers & Barriers Map, Activation Playbook, Friction Removal Plan).
- **El Insights Manager** agrega/quita bloques del banco según el cliente.
- **El cliente** puede activar/desactivar bloques que ya estén en el banco, dentro de su dashboard. No puede crear bloques nuevos.
- **Si el cliente quiere un bloque que no existe**, lo solicita al Insights Manager, quien lo solicita al UX Data Specialist, quien lo diseña y registra. Ciclo virtuoso: el banco crece con cada cliente.

### 5.4 Versioning de outputs

- El **output es el dashboard mismo, en vivo**. No se "publica una versión" — la versión vive.
- Cuando el Insights Manager edita el corpus, el dashboard se actualiza. Se guarda **snapshot histórico** de la versión anterior para auditoría y para comparación temporal.
- El **PDF export** se genera desde la vista actual del dashboard con `mediaprint`. Es derivado, no entregable principal.
- El cliente puede pedir un PDF en cualquier momento, desde cualquier vista del dashboard.

### 5.5 Formatos de exportación

| Formato | Caso de uso |
|---|---|
| **PDF** | Compartir con stakeholders que no tienen acceso al dashboard, archivo legal de la sesión |
| **CSV** | El cliente quiere los datos crudos del análisis para meterlos a su propia herramienta |
| **Markdown** | El cliente quiere copiar/pegar insights a su propio documento de planning |

Cada vista del dashboard tiene botón de export. Default export = todo lo visible. Avanzado = elegir bloques específicos.

### 5.6 Presentación humana es parte del valor

> **Noisia no es self-service.** Hay cientos de herramientas de social listening que el cliente puede comprar y nadie usa. Lo que sí ven los clientes son reportes que una persona les cuenta.

La plataforma facilita la presentación, no la reemplaza:

- El Insights Manager y el KAM presentan el dashboard al cliente periódicamente (mensual, quincenal, según contrato).
- Entre presentaciones, el cliente recibe **notificaciones de WhatsApp** cuando emerge un patrón importante (similar a notificaciones de performance en HubSpot, pero mejoradas con IA — texto curado, no auto-generado plano).
- El cliente puede consultar su dashboard en cualquier momento, pero Noisia opera asumiendo que la mayoría del consumo del cliente pasa por las presentaciones, no por la exploración self-service.

---

## 6. Audiencias cliente

### 6.1 Audiencia de entrada (MVP)

**Solo Marketing.** Brand Manager y su equipo de agencia.

(En el futuro podríamos sumar CX, Innovation, Strategy, Insights Corporativo. No en MVP.)

### 6.2 Qué ve el cliente

- Sus dashboards (Dashboard normal + Scrollytelling) para cada marca a la que tiene acceso.
- Comentarios propios y de otros usuarios autorizados.
- Histórico de versiones de dashboard (si quiere ver cómo evolucionó).
- Notificaciones WhatsApp recibidas.
- No ve: corpus crudo, queries del Engine, decisiones de exclusión, citas excluidas, comentarios internos de Noisia.

### 6.3 Qué exporta

PDF, CSV, Markdown. Ver 5.5.

### 6.4 Lenguaje

**Súper comprensible.** Sin jerga académica. Sin métodos descritos en lenguaje técnico. Sin frases tipo "underscore", "intricate", "pivotal moment".

La plataforma usa el **skill humanizer** (basado en Wikipedia Signs of AI writing) sobre todos los copys generados por IA antes de mostrarlos al cliente. 24 patrones de AI writing eliminados antes de render. Ver `humanizer/SKILL.md` referencia externa.

### 6.5 Interacción

- **Comentarios sí.** Cada bloque/insight tiene icono de comentario. El cliente comenta, el Insights Manager le responde dentro de la plataforma. Quedan en log.
- **Solicitudes formales sí.** El cliente puede solicitar al Insights Manager (botón "Pedir cambio" sobre cualquier bloque) que cambie algo. Esto crea un ticket interno.
- **Edición de output no.** El cliente no puede editar el contenido del dashboard. Solo comentar y pedir cambios.
- **Reacciones rápidas sí.** Like, important, addressed — para que el cliente marque insights sin tener que escribir.

### 6.6 Notificaciones WhatsApp

Caso de uso: emerge un patrón importante entre presentaciones (caso real: crisis emergente, mención inusual de marca competidora ganando tracción, nueva queja recurrente sobre la marca).

**Cuándo se dispara:**
- Detección automática de pattern anomaly por el IA del Engine (frecuencia 3x desviación standard sobre el promedio histórico).
- Disparo manual del Insights Manager cuando detecta algo en la curación diaria.

**Qué dice:**
- Mensaje curado por IA pero firmado por el Insights Manager. Texto humanizado, no auto-generado plano.
- Una línea de qué pasa.
- Una línea de qué significa.
- Link al dashboard con el filtro aplicado.

**Quién lo recibe:**
- Brand Manager con notificación activada.
- Opcionalmente Cliente Owner si se configuró así.

---

## 7. Memoria e inteligencia acumulada

> El sistema aprende. Esto es parte de la propuesta de valor. Sin esto, Noisia Studio es un wrapper de SentiOne con bonita UI.

### 7.1 Capas de memoria

| Capa | Qué contiene | Quién la consulta |
|---|---|---|
| **Memoria por industria** | Aprendizajes de queries que funcionan / fallan en una vertical (CPG bebidas, banca, fintech, retail, telco, etc.) | El Engine de Validación al construir un primer query |
| **Memoria por marca** | Contexto específico de la marca: brand seeds, exclusiones (ej. caso Bimbo NSFW), audiencias relevantes, historia previa de análisis | El Engine + el Insights Manager al iniciar una nueva metodología |
| **Memoria por metodología** | Casos de éxito de aplicación de T&B, VPM, etc. Qué tags emergentes funcionaron, qué fuentes dieron mejor densidad, qué bloques visuales tuvieron mejor recepción | El IA al codificar contra protocolo |
| **Memoria por cliente** | Preferencias del cliente: lenguaje, formatos preferidos, cadencia de notificaciones, equipo, tono | El Insights Manager al armar presentaciones |
| **Memoria por output** | Qué insights del pasado el cliente marcó como más relevantes, qué bloques pidió, qué citas commentó | El IA al priorizar evidencia para nuevos outputs |

### 7.2 Formulario de contexto

Al crear una nueva combinación (marca × metodología), el Insights Manager llena un **formulario de contexto** que alimenta la memoria por marca:

- ¿Cuáles son los competidores directos?
- ¿Qué audiencias prioritarias? (segmentos demográficos, edad, NSE)
- ¿Qué territorios geográficos relevantes? (México completo, regiones específicas)
- ¿Hay términos a excluir desde el inicio? (NSFW, política, nombres ambiguos)
- ¿Hay análisis previos de la marca? Upload de PDFs/MDs históricos.
- ¿Qué decisión de negocio se quiere informar?
- ¿Qué fuentes ya sabemos que importan para esta marca?

Este formulario alimenta el primer query del Engine. Sin él, el Engine arranca con menos contexto.

### 7.3 Reglas de no-reuso entre clientes

- **Brand seeds:** son globales. Inmuebles24 sigue siendo Inmuebles24 para cualquier cliente.
- **Industry insights:** se anonimizan antes de reusarse. "En CPG bebidas, las queries con X seed tienden a traer mucho contenido de receta — sumar exclusión" → válido cross-client.
- **Brand-specific findings:** NO se comparten. Si dos clientes de bebidas distintas usan la plataforma, los hallazgos de uno no informan al otro.
- **Tagging interno:** cada pieza de memoria lleva tag `internal_only` vs. `shareable_across_industry`.

### 7.4 Librería interna de benchmarks

Noisia genera inteligencia de negocio acumulada. Se materializa en:

- **Library de casos** internos (sin datos cliente, sin nombres) — qué metodologías corrieron, qué outputs, qué resultados.
- **Library de queries que funcionaron** por industria.
- **Library de bloques visuales** del banco — el cliente nunca elige uno que no haya sido validado previamente.
- **Library de Cultural Codes activos en México** (cross-categoría) — alimentada por estudios tipo Cultural Foresight 2026.

Esta library mejora el Engine, el ingestor, los outputs y las recomendaciones default.

---

## 8. Evolución temporal

### 8.1 Cadencia

**No hay default fijo de quincenal o mensual.** Cada cliente define.

- **Corpus inicial:** típicamente 12 meses de historia.
- **Actualizaciones:** disparadas por el Insights Manager cuando agrega data nueva o cuando hay un trigger temporal (evento, campaña, crisis).
- **Posibilidades:** quincenal, mensual, trimestral, ad-hoc. Depende del contrato.

### 8.2 Mecánica de actualización

Cuando el Insights Manager agrega menciones nuevas al corpus (vía API live, vía CSV import, vía nueva corrida del Engine):

1. Las menciones nuevas se ingestan al schema.
2. Se clasifican contra el protocolo de la metodología activa.
3. Se actualizan los hallazgos: pueden reforzar uno existente, mutar uno, o emerger uno nuevo.
4. El dashboard se actualiza en vivo.
5. Si el IA detecta cambio significativo (ver criterios abajo), se dispara notificación WhatsApp al cliente.

### 8.3 Comparativos antes/después

La plataforma soporta comparativos temporales en bloques especiales:

- **Comparative Block** — selección de dos periodos, mismo dashboard de la metodología.
- **Delta indicators** — flechas y % sobre cada métrica clave.
- **Cita representativa de cada periodo** — mostrar lado a lado cómo cambió el lenguaje.

Esto se usa típicamente para medir efecto de una activación o intervención del cliente.

### 8.4 Activaciones del cliente

**Fuera de scope MVP.** El usuario fue explícito: si el cliente quiere registrar sus campañas para correlacionar con cambios en barriers, eso es funcionalidad futura. Por ahora, los comparativos antes/después se hacen seleccionando fechas manualmente.

### 8.5 Cómo se mide si una barrera desapareció, bajó o mutó

Cada metodología define su propio espectro. Para Triggers & Barriers específicamente:

- **Desaparecida:** la barrier que tenía frecuencia >50 baja a <5 en el periodo nuevo.
- **Bajó:** la barrier mantiene presencia pero baja en frecuencia, intensidad O capacidad predictiva en ≥30%.
- **Mutó:** la barrier mantiene frecuencia pero cambia layer (de psicológica a cultural) o cambia vocabulario sustancial.
- **Persistente:** sin cambios significativos.
- **Emergente:** nueva barrier con frecuencia >15 que no aparecía antes.

Umbrales calibrados por metodología. La plataforma los aplica automáticamente y los muestra como anotaciones sobre el dashboard.

---

## 9. Schema de datos

> **Este bloque tiene su propio archivo: `04_DATABASE_SCHEMA.md`.** Cubre tablas completas, junctions, índices, particionado, mapeo desde SentiOne/Datashake, queries operativas.

Resumen aquí:

### 9.1 Entidades principales

```
organizations  (Grupo Salinas, Church & Dwight, Noisia Internal)
    ↓                                        ↓
brands                                     themes  (Cultural Foresight 2026, etc.)
    ↓                                        ↓
    └──→ study_corpora ←──────────────────  ┘
           UNIDAD ATÓMICA: 1 corpus por (brand × methodology) O (theme × methodology)
                ↓
        mentions                    ← las menciones del corpus
                ↓
        mention_codings             ← codificación contra el protocolo (T&B layers, etc.)
                ↓
        analysis_runs               ← cada corrida del análisis
                ↓
        findings + evidence_quotes  ← hallazgos curados con citas
                ↓
        dashboards                  ← lo que el cliente ve (con 2 vistas: normal + scrollytelling)
```

**Nuevo respecto a versión anterior del spec:** se agregó la entidad `themes` para soportar estudios temáticos sin marca específica (Cultural Foresight México 2026, Future is Human, etc.). El corpus tiene sujeto polimórfico: `brand_id` O `theme_id`, nunca ambos.

### 9.2 Stack firmado

Ver `06_TECHNICAL_DECISIONS.md` para la lista completa. Resumen:

- **Database:** Supabase Postgres 15 con jsonb + Drizzle ORM
- **Auth:** Kinde (multi-org nativo, $0 hasta 7.5K MAU)
- **Frontend:** Next.js 15 App Router + Tailwind + shadcn/ui (mismo stack que website)
- **Backend:** Next.js Route Handlers en el mismo monorepo (no FastAPI separado)
- **Workers:** Node 20 TypeScript + BullMQ + Redis (no Python — todo TS para que Codex no cambie de stack)
- **LLM:** Anthropic Claude vía Vercel AI SDK
- **Hosting:** Railway (consistente con website)
- **Particionado:** por `study_corpora_id` (cada corpus en su partición)
- **Full-text search:** Postgres tsvector nativo

### 9.3 Decisiones de diseño relevantes

- **Junction tables para todo many-to-many.** Una mención puede sostener varias señales, mencionar varias marcas, hablar de varios territorios. Nunca columnas booleanas tipo `is_signal_1`.
- **Versionado del pipeline.** Cada decisión (clasificación, exclusión, jerarquización) registra qué versión del pipeline la produjo. Si mejoramos el clasificador en 6 meses, no perdemos histórico.
- **Brand seeds globales.** Inmuebles24 es Inmuebles24 cross-cliente. Catálogo central.
- **Author table separada.** Permite analizar al autor independientemente (¿bot? ¿influencer? ¿cuántas menciones tiene cross-corpus?).
- **Evidence quotes separada de mentions.** La cita que va al dashboard final es decisión editorial, no cualquier mención. Tabla propia con flags `is_lead_quote`, `used_in_report`.

Detalle completo en `04_DATABASE_SCHEMA.md`.

---

## 10. Roadmap MVP

### 10.1 Decisiones del bloque "Lo mínimo ahora"

| Decisión | Respuesta |
|---|---|
| Primera metodología | **Triggers & Barriers** |
| Primera fuente | **SentiOne** (CSV + API) + **UI de integración de fuentes nuevas** + **upload manual CSV** |
| Primer cliente ejemplo | **Seguros El Potosí** (con fallback a análisis de industria seguros cuando los datos de marca sean escasos) |
| Outputs iniciales | **Dashboard normal + Scrollytelling + PDF + CSV** |
| Roles | **Internos + cliente** (los 7 listados en 1.2) |
| Comentarios cliente | **Sí en cada bloque/insight** |
| Aprobaciones | **El Insights Manager aprueba corpus y output antes de publicar** |

### 10.2 Fases del MVP

#### Fase 1 — Foundation (semanas 1-4)

Backend mínimo viable.

- Schema PostgreSQL completo (ver `04_DATABASE_SCHEMA.md` fases 1-2).
- Auth con roles (Founder/KAM/Insights Manager/UX Data Specialist + Cliente Owner/Brand Manager/Agency Insights).
- Org > Brand > Corpus structure.
- Importador SentiOne CSV (manual upload).
- Browser de menciones por corpus (lista, filtros básicos).

**Validación de fase:** subir un CSV de SentiOne real de Seguros El Potosí, navegar las menciones.

#### Fase 2 — Engine de Validación de Queries (semanas 5-8)

El componente más diferenciador. Versión 1.

- Conector API SentiOne (no solo CSV).
- Prompts a Claude para generar query desde brand seeds + signal phrases T&B.
- Loop de validación: muestra → IA evalúa → propone ajuste → Insights Manager confirma.
- Memoria por marca (formulario de contexto) y por industria (seed inicial de seguros).
- Curación del corpus con quality gates obligatorios.

**Validación de fase:** generar corpus de T&B para Seguros El Potosí desde cero usando el Engine. Comparar calidad vs. corpus generado manualmente.

#### Fase 3 — Triggers & Barriers ejecutable (semanas 9-12)

La primera metodología corriendo end-to-end.

- Prompts de Claude para los 6 pasos del protocolo T&B (ver `03_TRIGGERS_BARRIERS_DEEPDIVE.md`).
- Codificación contra los 4 layers (psicológico/personal/social/cultural).
- Jerarquización tridimensional (frecuencia/intensidad/capacidad predictiva).
- Generación de los 3 outputs JSON (T&B Map, Activation Playbook, Friction Removal Plan).
- Quality gates pre-publicación.

**Validación de fase:** correr T&B completo sobre el corpus de Seguros El Potosí. El JSON cumple el formato spec del playbook.

#### Fase 4 — Dashboard outputs (semanas 13-16)

La parte visible del cliente.

- Banco inicial de bloques: 4 charts (bar, line, heatmap, scatter) + Cultural Tension Cards + Evidence Lists + Brand Pills + Action Map + Maturity Badges + Hero Stats.
- Dashboard normal con layout de T&B.
- Scrollytelling de T&B con la narrativa de los 4 layers.
- Export PDF + CSV + MD.
- Comentarios por bloque.
- Aprobación del Insights Manager antes de publicar al cliente.

**Validación de fase:** presentar el dashboard de Seguros El Potosí al fundador como si fuera el cliente. Tiempo de comprensión de hallazgos clave: <10 minutos.

#### Fase 5 — Notificaciones y memoria evolutiva (semanas 17-20)

- Integración WhatsApp Business API.
- Detección de pattern anomaly con umbrales por metodología.
- Mensajes humanizados con el skill humanizer.
- Memoria por output (qué insights el cliente marcó como relevantes).
- Comparativos antes/después con Comparative Block.

**Validación de fase:** disparar una notificación real al cliente de Seguros El Potosí cuando una barrier crece de forma inesperada.

#### Fase 6 — Integración UI de fuentes (semanas 21-24)

El multiplicador a largo plazo.

- UI para configurar nueva integración (form de API key, mapping de campos).
- Soporte de webhooks de entrada.
- Validación de 10 menciones antes de activar.
- Soporte explícito para Datashake (segunda fuente nativa).
- Documentación interna del flow para que cualquier Insights Manager pueda integrar.

**Validación de fase:** integrar Apify desde la UI sin tocar código. Levantar Datashake con la integración nueva.

### 10.3 Lo que NO está en MVP

- Cultural Codes Decoding, Journey Friction Mapping, Influence Architecture, Value Perception Matrix, Decision Velocity. Vienen después de validar T&B.
- Registro de activaciones del cliente.
- Multi-país más allá de México (estructuralmente soportado pero no UI de selección de país).
- App móvil nativa (responsive web es suficiente).
- Self-service signup (los clientes se onboardean a mano).

### 10.4 Métricas de éxito MVP

Al cierre del MVP (24 semanas):

- **Operativo:** 1 cliente real (Seguros El Potosí) corriendo T&B mensualmente en la plataforma.
- **Tiempo de generación de corpus:** del orden de 1-2 horas con el Engine (vs. 1-2 días manual hoy).
- **Tiempo de generación de output T&B:** del orden de 1 hora con la pipeline IA + 2 horas de curación humana (vs. 1 semana manual hoy).
- **Cliente satisfaction:** NPS >40 en la primera presentación.
- **Insights Manager satisfaction:** Insights Manager prefiere usar la plataforma vs. el flow manual actual.

---

## 11. Riesgos conocidos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El Engine de Validación de Queries no produce mejor corpus que el manual | Tener al Insights Manager como override constante. Si la IA fall, el humano corrige y eso alimenta la memoria. Iterar antes de escalar. |
| La IA clasifica mal contra el protocolo T&B (4 layers) | Pre-flight check obligatorio. Doble pase humano sobre 5-10% del corpus. Failure modes del playbook bien definidos. |
| El cliente quiere self-service y la plataforma no se lo da | Posicionamiento desde día 1: Noisia es consultoría con plataforma, no SaaS. Sales material que lo dice antes de firmar. |
| Los componentes visuales del dashboard se ven genéricos | UX Data Specialist desde Fase 4. Banco curado, no plantillas. |
| Multi-tenant scaling | Particionado por corpus desde el día 1. Postgres aguanta hasta 50M rows con índices correctos antes de necesitar sharding. |
| Datos personales en menciones (GDPR / LFPDPPP) | Política de retención desde día 1. UI para takedown requests. Tabla `authors` no guarda más de lo necesario. |

---

## 12. Glosario rápido

Ver `05_GLOSSARY_AND_REFERENCES.md` para versión completa.

- **Corpus** = conjunto de menciones que sostiene una metodología corrida sobre una marca. 1:1 con `(marca × metodología)`.
- **Engine de Validación de Queries** = el componente central. Construye y refina queries iterativamente con IA + confirmación humana.
- **Insights Manager** = analista Noisia. Persona crítica.
- **Output** = un dashboard, con dos vistas (Dashboard normal + Scrollytelling).
- **Bloque** = componente modular del dashboard.
- **Brand Pill** = etiqueta visual de marca cuando aparece en una cita.
- **Maturity Badge** = emergente / acelerando / mainstreaming.
- **Quality gate** = check obligatorio antes de avanzar fase.

---

## Cierre

Este documento es la fuente de verdad para desarrollo de producto. Cualquier decisión que contradiga lo escrito aquí debe documentarse en una nueva versión, no en un Slack volátil.

El siguiente nivel de detalle vive en los archivos adyacentes:
- Metodologías como sistema → `02_METHODOLOGIES_CATALOG.md`
- Primera metodología en detalle build-ready → `03_TRIGGERS_BARRIERS_DEEPDIVE.md`
- Schema de datos para implementar → `04_DATABASE_SCHEMA.md`
- Términos y referencias → `05_GLOSSARY_AND_REFERENCES.md`
