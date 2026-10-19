# Plan — admisión compuesta de Brand Context para cliente

Fecha: 2026-09-11
Base visible UAT: `5b22d606c707998f55b12acdcf6823eef034619b`

## Resultado de producto

Un `client_admin` con Brand OS vigente y política activa podrá confirmar una sola preparación
semántica. El servidor admitirá primero la propuesta Claude y, sólo después de publicar ese resultado
y construir el plan real de prototipos, admitirá Voyage. El cliente verá un tope máximo y saldo diario;
no elegirá proveedor, modelo, configuración, timezone ni cap.

La confirmación no puede dejar una llamada, reserva, ejecución u outbox parcial. Perder acceso,
revocar la política, agotar el día o cambiar Brand OS impide trabajo nuevo. Los resultados ya pagados
se conservan y pueden conciliarse o materializarse sin crear otra capacidad monetaria.

## Precondiciones cerradas

- SQL0153 mantiene la autoridad de Brand Context y el recorrido histórico.
- SQL0154 separa el catálogo editorial de Topics de la definición servida.
- SQL0155 aporta política versionada, admisiones y presupuesto agregado. No modificar ni reaplicar
  estas migraciones.
- `brand-context-processing-quote-v1` es una lectura workspace-scoped. Siempre devuelve
  `can_start:false`; su digest identifica estado observado y no concede autoridad.
- El GET cliente sólo puede devolver un DTO construido por allowlist, sin política, acciones,
  proveedores, modelos, digests, fuentes o ledgers internos.

## SQL0156 mínimo

### Etapa 1: Claude

`authorize_signal_brand_context_processing_v1(...)` recibe únicamente workspace, actor,
idempotencia, digest del quote y confirmación estable. Dentro de una transacción:

1. toma locks en orden fijo: operación semántica del workspace → política de organización →
   presupuesto organización/día → actor, organización, marca, workspace y grant;
2. recarga política, acciones, reloj PostgreSQL, exposición y fuente de Brand Context;
3. recomputa el quote y exige igualdad exacta de política, versión, digest, acción, configuración,
   topes, día presupuestal, autoridad de fuente y exposición observada;
4. rechaza quote vencido, sucesor existente, drift, falta de saldo o runtime no disponible;
5. crea recibo padre v2, admisión Claude, ejecución semántica, reserva de ledger y outbox en la misma
   transacción.

Un replay exacto devuelve el mismo recibo y ejecución. Cambiar actor, workspace, fuente, quote,
confirmación o solicitud produce conflicto y no renueva ni reserva.

### Publicación semántica

La respuesta Claude recibida y pagada puede validarse y publicarse aunque la política o el grant hayan
vencido después del envío. Esta transición no crea admisiones, reservas ni llamadas nuevas. Si la
fuente cambió, conserva el resultado como histórico/obsoleto y no lo publica sobre la generación
actual.

### Etapa 2: Voyage

`admit_signal_brand_context_prototypes_v1(...)` sólo existe después de una publicación semántica y de
un plan determinista real. Dentro de otra transacción:

1. toma locks: taxonomía/workspace → solicitud de embeddings → política → presupuesto/día → actor;
2. valida recibo padre, generación publicada, plan y digest actuales;
3. vuelve a comprobar actor/grant, política, fuente, acción, configuración, saldo y disponibilidad;
4. crea admisión Voyage, ejecución y dispatch juntos.

La idempotencia se deriva de recibo padre + digest del plan. No se crea una admisión Voyage, target o
reserva durante la cotización inicial porque el plan aún no existe.

## Costos y configuración

No se añade otro ledger. Se reutilizan los tres ledgers agregados por SQL0155. Cada reserva mantiene el
advisory lock de organización/día hasta commit.

La configuración efectiva Claude depende del input, en particular `max_output_tokens`. SQL0156 añade
un comparador específico por acción:

- proveedor, modelo, versión, pricing y rates deben coincidir exactamente;
- el conjunto de claves permitido es cerrado;
- los límites efectivos deben ser positivos y menores o iguales a los de política;
- ninguna configuración efectiva viene del navegador.

Voyage puede conservar igualdad exacta de configuración. El recibo padre sella la configuración de
política; la ejecución inmutable sella la configuración efectiva.

## Autoridad y recuperación

- El camino compuesto usa `can_request_processing`; no abre `can_execute_topics` ni mutadores internos.
- Sólo roles cliente administrativos vigentes y grants actuales pueden crear capacidad nueva.
- Revocación o expiración bloquea nuevas admisiones, claims, renovaciones y envíos.
- `outcome_unknown` se concilia antes de cualquier reenvío.
- Una llamada Claude pagada permanece recuperable si Voyage no puede iniciar.
- Lotes Voyage settled alimentan caché aun si la autoridad vence después; no habilitan envíos nuevos.
- Una confirmación posterior crea un sucesor y reutiliza caché; nunca sustituye la admisión de una
  ejecución histórica.

## Pruebas obligatorias

- PostgreSQL real para reloj IANA, medianoche y un límite DST; el quote simulado actual no basta para
  convertir su digest en admisión.
- Dos conexiones, misma organización y día, cap 100: writer A reserva Claude 70 y retiene el lock;
  writer B intenta Voyage 40 desde otro workspace. B espera y después falla por límite. Resultado:
  exposición 70, una fila monetaria y ningún run/outbox duplicado. Repetir en orden inverso.
- Carrera de dos confirmaciones: la segunda usa exposición/digest obsoleto y falla CAS.
- Replay exacto, mismatch de idempotencia, política revocada, grant revocado, fuente obsoleta, cambio de
  día y proveedor no disponible.
- Fallo antes y después de cada insert: rollback deja cero admisión, reserva, ejecución y outbox parcial.
- Cap Voyage cero sólo continúa cuando el plan prueba cobertura completa de caché.
- Resultado pagado se recupera después de revocación sin reservar ni enviar otra llamada.

## Orden de entrega

1. Ensayo SQL0156 y pruebas PG contra base sintética privada; rollback y fingerprint exactos.
2. Adaptadores DB/Studio/Worker, todavía sin endpoint POST cliente.
3. Revisión P0/P1/P2, suites y build.
4. Aplicación UAT una sola vez en orden DB → Worker → Studio, con proveedores deshabilitados.
5. GET y estado visual comprobados; luego habilitar POST únicamente con política explícita para la
   marca nueva del experimento.
6. Primera llamada real acotada desde la UI, con recibo de costo antes/después. No usar National como
   objetivo ni ejecutar proveedor para probar cableado incompleto.
