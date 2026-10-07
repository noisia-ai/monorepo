# Recibo — frente 5, revisión 4 · 2026-10-07

**EN CURSO; sin aceptación integral.** Entorno exclusivo **dev-test**, marca y
organización QA nuevas. Carga 2, corrección de contenido y consolidación cerradas;
pertenencia del segundo adoptado terminal; H1 pendiente.
Guía reproducible y evidencia: [QA_FUNDADOR_MFP.md](QA_FUNDADOR_MFP.md).

**Código:** base #38 `9bc7ff9d`; rama `feat/mfp-front5-qa-r4`.
[PR #40](https://github.com/noisia-ai/monorepo/pull/40), corte de producto `3a1f546e`,
corrige F5-06 (receiver de fetch) y F5-08 (selección MFP en Signal).
CI `37595736324` y PostgreSQL17 `37595736358` SUCCESS; typecheck remoto 10/10.
Studio `562dcfd9` verificó ese HEAD. El redeploy posterior `3859dd3c`
se atribuyó erróneamente a #40: SSH/hashes confirman `4bbd2e`. Restauración
exacta `6980f50d` SUCCESS: health profundo200 y hashes iguales al archive
#40 (2793 blobs sin diferencias). Flag de revisiones true sólo Studio. Worker #38 `74ad8524`,
sin redeploy por estas correcciones. No merges, UAT ni producción.

**Verificado en producto y datos:**

- Carga 1: 1000 filas → 977 raíces; 905 elegibles/72 excluidas. Ficha:
  377 relevantes, 402 ajenas, 27 spam, 99 indeterminadas (88 abstenciones,
  11 errores). Preview real de cobros: 10 raíces, 4 llamadas; no publicado.
- Discovery: 377 relevantes → 12 grupos interpretados. Numérica 12/12;
  editorial terminal: 1 Topic, 0 Narrativas, 7 Noise, 4 evidencia insuficiente.
  Se adoptó sólo Emerald Aisle/estatus élite, alcance Marca principal: **1/2**.
- Pertenencia manual: 114 pares, 20 llamadas; atención 6/51 y cobros 4/53.
  Adoptado: 57 pares, 21 llamadas incluida una reparación; 15/42. Todo settled.
  Citas literales verificadas; F5-07 conserva un defecto de atribución a marca.
- Signal ES/EN: selección manual y adoptada visible, mismas fechas/población;
  evidencia resaltada y navegación al original. No acredita calidad global.
- Narrativa: CE/digest/fichas/decisiones intactos. Editar sólo cobros invalida
  exactamente sus 57 pares; las otras definiciones conservan resultados.
  Alias nuevo: targeted/0 raíces; Sixt: targeted/62 raíces antiguas. UI excluye
  esas 62 de las fichas vigentes. Ninguna llamada causada por guardar.
- Carga 2 única: 250 filas → 199 raíces nuevas (181 elegibles/18 excluidas),
  46 existentes + 5 duplicadas dentro del archivo; total 1176 raíces.
  Vectores terminales: 3159 cache hits/475 nuevos, 1086 raíces completas.
  Ficha incremental: 254 enviadas = 181 nuevas + 62 afectadas + 11 errores;
  las 832 vigentes no se reenviaron. Terminal: USD 0.850967, 65/65 settled;
  465 relevantes, 480 ajenas, 29 spam, 112 indeterminadas (3 errores).

**Límites y recuperación:** F5-02/03 refresco, F5-04 badge dependiente del estado,
F5-05 preview no recuperable en UI, F5-07 atribución y F5-09 costes globales
omitidos en tarjeta documentados. F5-10: revisión de contenido oculta por
`NOISIA_MFP_ENABLED` false en Studio; carga 2 quedó append_only, revisiones 0.
Recuperado en `6980f50d`: batch 3 de 23 IDs con opt-in de revisión por UI,
19 revisiones reales/4 duplicadas/0 inserciones; total 1176 intacto. Snapshots
actuales verificados 19/19. Vectores 19 nuevos/3614 cache hits, USD 0.000428.
Ficha correctiva terminal: 22 raíces, 17/17 llamadas, USD 0.134326.
Censo final: 1086 fichas actuales; 468 relevantes, 481 ajenas, 30 spam y
107 indeterminadas; 0 errores técnicos. Las 19 revisiones sirven texto nuevo,
0 digests antiguos servidos y CE v2 vigente. Los 612 pares de pertenencia
finales coinciden en contexto, entidades efectivas y fingerprint.
No se repitieron las 250 filas.

**Coste settled acumulado antes de H1: USD 6.484515**, incluidos discovery, editorial y pertenencia tras carga 2:
vectores 0.110855; fichas 3.581149; preview 0.051516;
interpretación 0.551190; editorial 0.336952; pertenencia 1.852853.
Presupuesto orientativo, sin máximo estricto configurado. Fichas y vectores terminales sin
reservas activas. Railway/CI no cuantificados.

Discovery final: 468 raíces/1494 chunks, 13/13 grupos interpretados,
USD 0.276342, reserva cero. Preparación numérica nueva 13/13. Editorial de esas 13 unidades enviado
por IDs propios con huella histórica intacta.
Pertenencia final: 121 pares nuevos/obsoletos, 36 llamadas incluidas dos
reparaciones, USD 0.357144; 86 vigentes reutilizados. 207 pares sin pendientes,
3 errores de cita y 1 insuficiente conservados como tales. Cribado editorial
13/13 USD 0.093035 + global USD 0.081039, terminal: 5 Topics, 0 Narrativas,
4 Noise y 4 insuficientes. Segundo concepto adoptado por UI tras revisar su
original Southwest: integración de renta en plataformas de viaje, Categoría.
Cobertura **2/2**; 405 pares nuevos terminales: 24 pertenecen/378 no/1 insuficiente/2 errores.
58 llamadas settled (53 iniciales + 5 reparaciones), USD 0.996055; estimación USD 1.177746.
Los 612 pares finales no tienen pendientes; cinco errores y dos insuficientes
permanecen explícitos. Todos los jobs del recorrido están terminales.

Signal ES/EN post-carga 2: 3 conceptos (5/2/18), 21 únicas seleccionadas,
447 sin concepto. Citas/navegación correctas; badge 134 discrepante (F5-04).

F5-11: resultados guardados HTTP 409/SQL 42601 por tres comillas ausentes;
reproducido con EXPLAIN en PG17. Explore groups y original disponibles en UI.
No se modificó el módulo ni se adoptó por SQL.

Signal ES/EN final: cuatro conceptos (5/2/24/18), 45 únicas seleccionadas y
423 sin concepto, badge F5-04 en 134. Evidencia del segundo adoptado HTTP 200,
24 ítems/24 citas resaltadas. Capturas privadas 21–23.

**Pendiente:** ventana H1 #39 y tres excepciones reales.
Ventana abierta al coordinador tras censo terminal y Runner libre; no se iniciarán
más proveedores desde este frente antes del despliegue coordinado.

Guard PG17/rol/base/DNS privados verificado. Migraciones 0252/0254/0257/0258
aplicadas una vez (239 totales); no repetir. Editorial ejecutado por IDs con
huella histórica intacta y drainers apagados. Datos/IDs operativos y capturas
sólo en evidencia privada ignorada. Toda infraestructura y suites pesadas remotas.
Modelo/esfuerzo del agente no expuestos; no se acredita variante efectiva.
