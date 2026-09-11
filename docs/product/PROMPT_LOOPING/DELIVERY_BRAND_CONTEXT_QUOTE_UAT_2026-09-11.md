# Entrega — cotización de preparación semántica de Brand Context en UAT

Fecha: 2026-09-11

## Resultado visible

La superficie cliente ya puede explicar, sin ejecutar nada, si el contexto de Brand OS está listo para
su preparación semántica. La lectura aparece de forma compacta dentro del recorrido de Datos y en forma
completa dentro del Brand OS de un `client_admin` autorizado. Está separada del paso de vectores del
corpus: informa el estado del contexto de marca y sus intereses; no afirma que las menciones ya tengan
embeddings.

El contrato público contiene sólo ocho campos permitidos y fija `can_start:false`. No expone proveedor,
modelo, configuración, política, digests, acciones, fuentes internas ni ledgers. No existe POST ni CTA de
procesamiento en este corte. Actualizar sólo vuelve a leer política y cotización; no reserva presupuesto,
crea ejecuciones ni envía contenido a modelos.

## Entrega focal

- Código UAT: `5b22d606c707998f55b12acdcf6823eef034619b`.
- Studio deployment: `2c697195-3578-46c3-bd37-bdfd8d4691a3`, `ACTIVE`.
- Worker conservó `cdd93bd`; Railway saltó el deploy por no haber cambios en sus archivos observados.
- No hubo migración. SQL0153–0155 permanecen aplicados exactamente una vez.
- El endpoint sin sesión respondió `401`, `Cache-Control: private, no-store` y el error público
  `brand_context_processing_quote_unauthorized`.

## QA real

La sesión interna de UAT comprobó en Datos de National:

- tarjeta compacta «Preparación semántica de la marca» visible y separada de `Preparar → Vectores → Analizar`;
- estado `Acceso requerido`, sin importes obsoletos, CTA pagada ni datos de proveedor;
- el botón general `Actualizar` vuelve a leer política y cotización sin mutar el workspace;
- corpus intacto: 7,396 menciones recibidas, 6,826 preparadas y 570 excluidas;
- Topics intacto: 32 tópicos activos de 357 grupos interpretados;
- costos históricos intactos: USD 1.918865 registrados y USD 1.6818 reservados.

La página completa de Brand OS cliente exige un rol cliente administrativo vigente. No se cambió el rol
real de la sesión interna para forzar esa vista; su render ES/EN y autoridad permanecen cubiertos por los
tests del componente y del acceso workspace-scoped.

## Verificación

- Studio: 959 pruebas / 961 casos, 954 `PASS`, 7 `SKIP`, 0 fallos.
- Focal UI/contrato cliente: 18/18 `PASS`.
- TypeScript, ESLint focal, `git diff --check` y build de producción: `PASS`.
- Dos revisiones independientes cerraron la allowlist, errores saneados, carreras entre workspaces,
  actualización coordinada y ocultamiento de montos vencidos: 0 P0/P1/P2 pendientes.

## Siguiente corte

SQL0156 permanece local. Debe convertir una confirmación cliente en una admisión Claude atómica con
recibo, ejecución, reserva y outbox; Voyage sólo puede admitirse después de publicar la generación
semántica y construir su plan real. Antes de abrir un POST se requieren pruebas PostgreSQL reales de
reloj IANA/DST, concurrencia monetaria, replay/CAS, rollback y recuperación posterior a revocación.
Ningún proveedor se habilita desde una conexión parcial.
