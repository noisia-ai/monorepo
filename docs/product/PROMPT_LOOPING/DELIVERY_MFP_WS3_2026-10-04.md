# WS3 — Ficha JEV experimental · 4 octubre 2026

**Entregado en dev-test:** adaptador, mapeador multi-entidad y worker por páginas
sobre run/ledger/etiquetas WS2; demo real de **905/905 raíces con estado** y replay
sin transporte. No aprobación semántica WS4, aceptación integral ni entrega UAT.
Una solicitud por raíz incluye todas las entidades/prominencia; asunto null y
probabilidades completas en crudo, sin afirmar calibración. Flag JEV apagado por
defecto; tarifa explícita. Sin DDL JEV;0225 pertenece a WS2.

**Demo inicial:** **888 labeled** (513 relevant,30 spam,345 unrelated), **7 abstained**
(2 relevant,4 unknown,1 unrelated), **10 error**. Uso **3,636,291 tokens** a
USD0.042/MTok: USD0.152724222 calculados; **USD0.153189 en ledger**, por redondeo
hacia arriba a microUSD por llamada. Reserva0, incertidumbre0. Duración inicial
**877,936ms**; proveedor **p50=97.257ms**, **p95=146.172ms**, n905.
Auditoría independiente sólo lectura10:56:11Z:905 llamadas settled,905 resultados
aplicados,905 crudos/recibos privados y **905/905 SHA256 coincidentes**,905 raíces únicas.

**Errores técnicos:** diez `jev_response_invalid` con factura conocida y conciliada
(USD0.001690 conjunto). Lectura10:56:50Z identifica7 en voice y3 en act: suma0.99
rechazada porque `Math.abs(0.99-1)>0.01` por coma flotante. Es un fallo de frontera
del adaptador; no acredita fallo semántico. Historia conservada. Corrección focal
posterior respeta±0.01 e incorpora sólo margen binario; cliente8/8 PASS local/remoto,
misma identidad lógica. Reparse remoto sólo lectura11:00:46Z:10/10 válidos,0 llamadas,
0 mutaciones. Root ejecutó nueva run explícita: **10 solicitudes,10 labeled,
USD0.001690**, reservas/incertidumbre0,17,755ms. Estado final **898 labeled**
(519 relevant,33 spam,346 unrelated), **7 abstained** (2 relevant,4 unknown,
1 unrelated), **0 error**:905/905 con ficha. Ledger acumulado de ambas runs
**USD0.154879**,915 solicitudes; historia inicial conservada.

**Replay confirmado por root:** misma clave/run, **0 solicitudes nuevas**,905 llamadas
y USD0.153189 sin cambios, reservas/incertidumbre0;2,196ms. El summary fue
sobrescrito por el replay; evidencia inicial y replay permanecen en logs privados
`jev-real-execution-2026-10-04.log` y `jev-real-replay-2026-10-04.log` bajo
`.data/dev-corpus/`.

**Datos y control:** fuentes oficiales en [due diligence](JEV_DUE_DILIGENCE.md).
Sin training con Input sin consentimiento; no ZDR acreditado. Guard MFP remoto
**10:25:43Z** confirmó fixture real con1 fuente/1 lote autorizado para LLM,
retención indefinida. Gate10:29:50Z sin trabajo pendiente. Root ejecutó helper
`jev-policy.ts`: política1→2 JEV y2→3 Claude; cuatro acciones/caps conservadas,
excepto destino/configuración de mention_facets, caps diario y de acción null.
Helper inspecciona por defecto; exige `--execute`, autoridad y conciliación.
Recuperación versionó3→4 JEV→5 Claude, cuatro acciones conservadas y blockers0.
Logs privados: `jev-real-recovery-2026-10-04.log`, `jev-recovery-policy-2026-10-04.log`
y `jev-recovery-policy-restore-2026-10-04.log`, bajo `.data/dev-corpus/`.

**Verificación:**15 pruebas JEV remotas iniciales PASS; cliente8/8 local/remoto incluye streaming y
fronteras0.99/1.01/fuera/NaN.
Typechecks del overlay y helper PASS remoto; lógica de política verificada en PG.
Seis probes sintéticos reales previos:16,802 tokens,USD0.000705684,p50=80.775ms,
p95=146.488ms. No equivalen a gold. Pendientes CI propia tras integrar WS2,
evaluación WS4. Tarifa en identidad invalida caché si cambia.

**Rendimiento pendiente:** uploads crudos secuenciales son una explicación compatible
con~190s/página200; falta instrumentación aislada. Propuesta: concurrencia acotada
4–8 en almacenamiento, recibos completos y DB por página antes de parsear/liquidar;
medir proveedor/upload/DB. Sin cambios a la corrida ni archivos comunes activos.
