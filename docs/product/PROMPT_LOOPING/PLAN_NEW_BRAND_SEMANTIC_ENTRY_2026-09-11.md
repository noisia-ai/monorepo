# Nueva marca → contexto e intereses listos para importar

Fecha: 11 septiembre 2026

## Resultado visible

Un `client_admin` crea una marca de su organización, completa el Brand OS y sus fuentes de
conocimiento, genera vocabulario y límites con Claude, corrige o elimina las excepciones y llega a
Topics con guías Voyage vigentes. El catálogo puede contener intereses definidos por el usuario aun
cuando el corpus esté vacío. En ese punto la siguiente dependencia legítima son menciones reales
cargadas por la interfaz.

National conserva su función de regresión; no define este recorrido ni se reutilizan sus datos para
la marca nueva.

## Cortes en ejecución

1. **Autoridad del creador.** La marca nueva concede al `client_admin` creador administración sólo
   sobre esa marca. El replay no amplía grants históricos ni restaura accesos revocados.
2. **Preparación gratuita desacoplada.** Sellar la fuente de Brand OS requiere configuración
   semántica válida, pero no llave de proveedor, Redis ni Worker. Cotizar, admitir y enviar conservan
   todos sus gates.
3. **Política mínima de organización.** Cuando se crea la primera marca de una organización sin
   historia de política, el servidor puede provisionar las acciones exactas de Brand Context. El
   iniciador autenticado queda ligado al alta y una identidad interna configurada firma la política;
   un cliente nunca se convierte en autoridad financiera. Tope diario y vigencia proceden de
   configuración explícita; su ausencia conserva la marca y muestra `configuration_required`.
   Provisionar no crea admisiones, corridas, outbox ni gasto.
4. **Interfaz de alta.** El cliente no ve el slug técnico, el CTA anticipa que continuará en Brand OS,
   Datos conserva el regreso a Brand OS y todos los controles del formulario respetan ES/EN.
5. **Refresco de guías.** Si cambia el catálogo después de preparar Brand Context, una nueva
   autorización `topic_prototype_embeddings` liga el plan vigente, reutiliza caché por hash y prepara
   sólo las guías faltantes. No repite Claude ni hereda la autorización anterior.

## Secuencia de producto

```mermaid
flowchart LR
  A[Crear marca] --> B[Brand OS y Knowledge Base]
  B --> C[Fuente semántica versionada]
  C --> D[Claude propone vocabulario y límites]
  D --> E[Activación automática y excepciones editables]
  E --> F[Topics e intereses]
  F --> G[Voyage prepara guías vigentes]
  G --> H[Esperando menciones reales]
  H --> I[Importar marca, competencia y categoría]
  I --> J[Corpus completo e incremental]
  J --> K[BERTopic y métodos numéricos]
  K --> L[Claude interpreta evidencia]
  L --> M[Topics editables y selección]
  M --> N[Signal]
```

## Gates de este tramo

- La organización, marca, workspace, actor y grant se derivan de PostgreSQL.
- Una política se crea únicamente sin historia previa. PostgreSQL comprueba al iniciador del alta y
  al actor interno configurado que SQL0155 acepta como creador; ambas identidades son server-side.
- La configuración, modelo, topes, vigencia y zona horaria nunca vienen del navegador.
- El GET sigue siendo informativo. Una acción pagada requiere su admisión exacta y su replay conserva
  la misma identidad.
- Guardar marca, Brand OS, Knowledge Base o Topics no implica una llamada de proveedor.
- Un fallo de provisión posterior al commit no convierte la creación de marca en una respuesta
  ambigua; un replay exacto puede recuperar únicamente el caso de cero historia.
- Sonnet 4.6 y Voyage 4 Large son las identidades actuales; Opus no se usa.

## Después de las menciones

La importación y preparación gratuita cliente ya existen. Todavía debe conectarse
`can_request_processing` con admisiones acotadas para embeddings del corpus, full fit, interpretación
y ciclo incremental. `can_execute_topics` permanece interno y no se ensancha para resolver esa deuda.

## Punto de parada

La entrega se detiene sólo cuando UAT permita llegar desde una marca nueva hasta contexto e intereses
preparados y el siguiente paso sea escoger la marca real y cargar sus CSV por la UI. No se fabrican
menciones ni se ejecuta un proveedor para una identidad de prueba sin valor.
