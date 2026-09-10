# LAB-3D — propuesta de corte UAT del catálogo y prueba conjunta

Preparación local; NO abierto hasta cerrar LAB-3C con pruebas y auditoría independiente.
La autorización del operador ya cubre este despliegue focal Preview/UAT. No se necesita
otra llamada a IA, nuevo clone ni copia grande del corpus para entregar lo implementado.

## Corte exacto

- Partir del Studio UAT sano bd7dbf9e00fc14775092d827e8018b6347a2e7b6,
  deployment059d80ed-565b-4d76-a5cc-47e8c5ed1bb4, 0123 aplicada una vez.
- Código: commit3B 3e4708b9c6bae753ccef328cf7d24af03071b75f y el commit3C
  final auditado sobre él. No incorporar el worktree principal sucio ni otros agentes.
- Única DDL nueva:0124_signal_topic_rule_cohorts.sql, checksum
  sha256:e510ca59a6f444990d263d306a3ee5bbac1c3e19ef4bf29d3f472333ea76eff7.
  Dos tablas vacías, cuatro funciones y cuatro guards; reutiliza el protector0123.
- Target UAT previamente verificado por fingerprint
  sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815.
  No imprimir ni persistir credenciales. El runner no acepta un target alternativo.

## Ejecución y recuperación

1. Auditoría independiente del runner privado nuevo y del commit final. Plan/allowlist,
   contratos y pruebas locales cerrados; no ejecutar el runner viejo ni reaplicar0123.
2. Abrir CURRENT3D, comprobar Railway Studio/Workers/branches y health actuales.
   Nuevo preflight RRRO contra el target exacto, comparando el último recibo3A post-QA
   24cb9cd9b791f5f78a8383722948d8e8f16403b2a3b66bba69c3eec353a85e8b.
3. Preregistrar recibo fresco/label/checksum;0124 ausente y0123 intacta. Aplicar únicamente
   0124+su fila ledger en una transacción SERIALIZABLE, con sentinels y before/after.
   Si el commit queda incierto, sólo leer/verificar; nunca repetir a ciegas.
4. La recuperación de aplicación conserva las tablas aditivas y vuelve a bd7dbf9.
   Los datos actuales no se restauran desde el viejo archivo393MB pre-LAB2V, que no es
   un backup del estado actual. No hay DDL destructiva ni materialización de datos en este corte.
5. Push fast-forward del rango revisado sólo a la rama Studio existente
   codex/noisia-topic-results-uat-2026-09-06. Workers debe seguir en
   codex/noisia-data-os-cut-1-uat-2026-08-18, commit75f0873f0321b8f4cfb3e6105aefa5b2614784d5,
   deployment012026e1-3c63-4a63-87a0-e7df3f94ea99. No cambiar settings ni redesplegarWorkers.
6. Verificar commit/despliegue exacto y deep health. QA autenticado read-only del catálogo
   de diez candidatos: estado sin reglas guardadas, selección deshabilitada, abrir/cerrar
   editor y citas existentes, refresh, móvil/escritorio, consola y cero requests mutantes.
7. Reconciliar DB post-QA: nuevas tablas0124 vacías,0123 drafts/trials0, diez candidatos
   pending revision1, editorial0, una propuesta archivada, snapshot21195 y sus hashes,
   provider/activation/serving intactos. Workers sigue con el mismo deployment.

No cambiar candidatos, guardar reglas, probar catálogo real ni publicar/adoptar/servir Topics
como parte del QA read-only. Una siguiente prueba de producto se describe por separado;
los recibos locales previos no se presentan como estado persistido en UAT.

## Siguiente resultado de producto

Una vez entregado el corte sano, evaluar el paso mínimo para sugerir reglas cerradas y
medir calidad sobre el catálogo sin pedir consultas manuales a cada usuario. Usar los diez
candidatos existentes y evidencia congelada, no repetir BERTopic ni una evaluación amplia
por costumbre. Cualquier llamada nueva consume el presupuesto y el intento restantes, con
flight card propio. La clasificación persistente/activación de Signal sigue fuera del corte.

Coste3D USD0. Presupuesto conservador restante USD11.374937; nueve experimentos usados.
No producción, provider, migración adicional, adopción/publicación/serving, DiscoveryReview
ni recuperación amplia de Front. Registrar el resultado real, no sólo el lanzamiento.
