# Signal desde primera importación: recibo de implementación local

Estado: EN VERIFICACIÓN, no entregado en UAT. Amplía el Compass; no reemplaza historia ni modifica datos de Laika.

## Comportamiento

Un workspace nativo con importaciones terminadas puede mostrar volumen y menciones antes de existir Engine, preparación o clasificación. Resumen y Menciones comparten raíces canónicas y derechos vigentes; licencia de computación no permite publicar texto. El servidor decide la ruta importada: cualquier vínculo operational/legacy conserva su recorrido existente. Una generación previa o binding de consolidación impide convertir una revocación/fallo en un fallback más permisivo.

El DTO distingue `workspace_imported`, clasificación pendiente y generación nula. Las métricas desconocidas quedan nulas. Los cursores se invalidan al cambiar recepción, actor, filtros o derechos. No se ejecutan proveedores ni se inicia un análisis al consultar Signal.

## Evidencia local

Backend focal 20 PASS y suite DB 594 PASS/98 skips; estos skips corresponden a integración y NO certifican PostgreSQL real. Studio antes de corrección visual final: 1,092 PASS/7 skips, lint11/11 y buildPASS. Revisión independiente del lector sin defectos reproducibles P0/P1/P2. Pendiente cierre de revisión frontend y comprobación final después del ajuste visual.

QA con componentes/estilos reales y fixture explícitamente sintético, sin rutas de producto: Overview→Menciones→Topics funciona; Topics pendientes desktop ES y móvil EN (390×844), CTA a Menciones y tabla móvil comprobados. Se encontró y corrigió un defecto real de presentación: ceros de sentimiento/engagement y LIVE de evidencia sin interpretación. Se conservan las tarjetas, mostrando disponibilidad pendiente; legacy conserva datos y controles. El harness no verifica auth/SQL/rendimiento de producción.

## Ensayo PostgreSQL privado

Backend+runner focal respaldados en `cef8e84`, rama `codex/noisia-signal-from-import-2026-09-24`, sin push a UAT. El runner histórico NOI-19 y sus gates permanecen; el nuevo entry import-only requiere identidad/SHA/count sellados, seis escenarios, rollback físico y comprobación de base vacía posterior. Doce tests de guards PASS.

Railway dev-test: runner `fb2b5925-d7aa-4d5d-9353-6e54dfe38c0e`/entorno `5bad359d-cfa4-4e8f-aa41-98e6f075375a` conserva red privada, una réplica, NEVER y tres variables existentes. Root deshabilitó autodeploy y cambió sólo su rama a la focal; bootstrap readonly en construcción `b3e62b50` al corte. No se ejecutó fixture ni migración remota. Los sellos siguen nulos; no inventarlos ni aceptar un esquema antiguo para pasar el gate.

## Pendiente concreto

1. Ver recibo del bootstrap, observar identidad/esquema actual y preparar únicamente la actualización dev-test que resulte necesaria; nunca aplicar SQL ya cerrado en UAT.
2. Ejecutar seis escenarios import-only en PostgreSQL privado con rollback comprobado.
3. Cierre de UI/checks final, commit focal y entrega UAT, QA posterior.
4. Segunda carga real por UI, calidad semántica/consolidación completa y SLO siguen pendientes del plan general; este corte no los declara resueltos.

Studio UAT mantiene recuperación `a4081ee`, 43,159 menciones visibles Alexa+. Cero llamadas pagadas en esta reanudación. Linear requiere reconexión; pendiente sincronización sin cierres ficticios.

## Cierre UI local y hallazgo de infraestructura

Studio final: 1,096 PASS/7 skips, buildPASS y typecheck raíz11/11PASS; revisión frontend/API sin hallazgos nuevos P0/P1/P2. Corrección visual final verificada en Overview; Topics y Menciones responsive ES/EN conservan componentes y navegación reales. No requiere repetir estos checks salvo cambios posteriores.

El bootstrap privado sí arrancó, pero rechazó `noi19_dev_test_url_invalid` antes de PostgreSQL. Root comprobó la causa por UI sin imprimir secretos: DATABASE_URL del runner referencia pgvector.DATABASE_URL, variable inexistente en pgvector (sólo POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB y PGDATA). Se corrige exclusivamente la referencia de conexión del runner usando esas variables privadas existentes; no se cambian contraseñas ni se abre acceso público. Gate SQL todavía pendiente.
