# Brand Context compuesto autoservicio · entrega UAT · 11 septiembre 2026

## Resultado de producto

UAT ya conecta el primer tramo pagado del recorrido reusable de una marca. Un cliente con acceso y
política vigentes puede ver un tope emitido por el servidor, confirmar la propuesta semántica de
Brand Context y seguir su progreso. Cuando Claude termina y el servidor publica esa generación, el
recorrido construye el plan real de prototipos y pide una segunda confirmación explícita para Voyage.
Ninguna de las dos etapas se autoriza sólo por abrir o actualizar la pantalla.

El recorrido conserva una sola identidad ante doble clic, timeout o pérdida del acuse HTTP. Una
respuesta Claude ya pagada se puede validar y publicar después de revocar acceso; eso no abre nuevas
llamadas. Los prototipos sólo reciben una admisión propia después de existir un plan determinista. El
catálogo vacío es un estado válido para una marca nueva y deja de depender de datos históricos.

## Entrega ordenada

- Producto compuesto: `0302ebace0c6f2b5afc6d6920d4729a631ecc2d1`.
- Cierre ACL: `f13529e4f9b84568119a971e9feea6eaa60b48ad`.
- Marcador Studio: `76fecc1cdc473d13487fc78b2861afe0f74c9b50`.
- SQL0156–0157 aplicado una sola vez el `2026-09-11T22:20:54.632199Z`; SHA256 del paquete
  `3e2eacd16d825c3f722e6dbc3ab8f29938a630d309fb524d5dd254701c2a4b9e`.
- SQL0158 aplicado una sola vez el `2026-09-11T22:25:27.373589Z`; SHA256
  `bf63dfe094f19119796db686e172f5c475fabe0efa1093e0fc98230d1c09e17d`.
- Worker `abfc48c3-db1f-41f0-86b6-f7a3be1f6a06`, activo con `f13529e`.
- Studio `a2cd1462-a695-4d4d-96a4-8289ccf18622`, activo con `76fecc1`.

No reaplicar SQL0156–0158.

## Evidencia

El ensayo PostgreSQL privado cerró 18 grupos de aserciones sobre 269 tablas y 718 archivos de
runtime. Usó tres respuestas Claude y dos lotes Voyage simulados; transporte remoto y llamadas
reales permanecieron en cero. El fingerprint de esquema y los censos antes/después fueron idénticos.
Recibo: `.data/brand-context-composed-stage2-2026-09-11/result.json`, sello
`250db03d1b017bcde287bcec42b924233e45b2b30d9d307263bbc67bd9e2b3b6`.

- Studio: 970 aprobadas, 7 omitidas, 0 fallidas.
- Worker: 564 aprobadas, 42 omitidas, 0 fallidas.
- DB: suite completa y 27/27 focales aprobadas.
- Typecheck de Studio, Worker y DB, lint focal, build Studio y revisión P0/P1/P2: PASS.
- Las cuatro funciones trigger recreadas por SQL0157 quedaron sin `EXECUTE` de `PUBLIC`, `anon` o
  `authenticated` después de SQL0158.

El recibo remoto posterior al despliegue, `2026-09-11T22:39:15.206892Z`, confirmó SQL0156–0158 y
cero políticas, acciones, admisiones, operaciones, recibos de procesamiento, corridas activas u
outbox activos. No hubo gasto ni proveedor nuevo.

## QA humana UAT

- Brand OS muestra la preparación semántica completa y la sesión interna la ve en sólo lectura por
  no tener autoridad cliente; no aparece una CTA falsa.
- La navegación de marca conserva Overview, Brand OS, Topics, Datos y fuentes, Menciones, Reportes y
  Acceso/configuración. Las revisiones heredadas dejaron de ser entradas principales.
- National conserva 7,396 menciones únicas, 16 archivos, 9,131 filas recibidas, 6,826 preparadas,
  570 excluidas y 20,821 chunks. También conserva 32 Topics de 357 unidades interpretadas.
- El primer acceso al home de Marcas mostró la espera fría; después resolvió correctamente. En
  caliente, Dashboard tomó 186 ms y Marcas 191 ms, sin una regresión específica de la ruta.

## Deuda que abre el siguiente corte

La confirmación pública todavía comparaba importes y tiempo, pero no una referencia opaca a la
cotización exacta. Además, los cambios de Brand OS hechos por un cliente no creaban por sí solos un
sucesor reconciliado, y existía una ventana entre el preflight y el envío en la que una edición podía
volver obsoleta la fuente. El siguiente corte los cierra con una nueva migración; no modifica ni
reaplica SQL0153–0158.
