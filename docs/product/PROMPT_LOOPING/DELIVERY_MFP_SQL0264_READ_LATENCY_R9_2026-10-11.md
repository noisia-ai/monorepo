# Recibo SQL0264 — lecturas MFP para revisión 9

Corte de §14.1.2 de la auditoría y spec v1.3. Aceptación escrita primero en
`783b7568`; implementación destinada a #57 sobre `develop`, sin fusión.

SQL0264 materializa dentro de cada lectura las unidades y el historial comunes
al plan editorial. La validación por unidad conserva workspace, ejecución,
identidad, origen, pertenencia de nacimiento, censo y estado. El nuevo guard
`signal_workspace_projection_assignments_current_v1` valida la fuente una vez
por generación y conserva las comprobaciones por asignación: término, definición,
modelo, política, corrección humana, artefactos y fragmento de la raíz. Las guardas
originales de escritura y serving siguen vigentes. Cinco hashes de preimagen
protegen las definiciones copiadas; las funciones nuevas quedan privadas.
No añade tablas, caché persistente, autoridad de gasto ni proveedores.

Medición sobre el workspace de QA en PostgreSQL 17 del runner MFP, en una
transacción con rollback físico. La consulta de proyección usa el nuevo guard
mediante sustitución de SQL en el cliente de prueba; no reemplaza el runtime.

| Lectura | Antes | SQL0264 | Paridad |
|---|---:|---:|---|
| Plan editorial completo | 16,658 s | 0,936 s | válido en ambos |
| Estado de proyección completo | 13,423 s | 4,883 s | SHA-256 idéntico |
| `loadSignalWorkspaceAnalysisUpdateV1` | 14,333 s | 6,174 s | SHA-256 idéntico |
| `loadWorkspaceAnalysisForActorV1`, DTO completo de Studio | 38,856 s | **11,956 s** | SHA-256 idéntico |

Hash de la respuesta completa:
`7b7a744600f881083ec1949f6a79a8222c368eb28d8018ea1ca3aac37ca7d9e5`.
Las generaciones completa y pendiente mantienen respectivamente `true` y `false`
en el predicado anterior y en el nuevo. Desactivar al actor o archivar la fuente
invalida el plan en ambos. Tres negativos por unidad (digest de nacimiento, estado, censo) y tres por
asignación (raíz, definición, modelo) rechazan el dato corrupto en ambos predicados.
La suite PG de CI exige además latest/latest-complete separados y revocación viva.
El probe de regresión en el runner reportó una aceptación PASS y tres fallos de
staging: mocks #57 contra readers aún antiguos, y fixture sintético que requiere
una base vacía; esos tests se verifican en CI sobre el corte integrado. Hubo
contención de transacciones concurrentes, registrada aparte de la latencia del
panel. Las pruebas y la medición revierten sus cambios; la aplicación persistente y la verificación HTTP
pertenecen al corte integrado que coordina Root. Typecheck DB remoto verde con los tests nuevos; CI del SHA final corresponde a #57.
Los hashes observados están en `EVIDENCE_MFP_SQL0264_FUNCTION_HASHES_2026-10-11.json`.
Tras comprobar que sólo SQL0264 está pendiente en dev-test, la aplicación usa
`node scripts/dev-corpus/migrate.mjs` desde `/app` del runner con el corte integrado;
el harness verifica destino, historial y SHA y registra la migración una vez.

Cero llamadas a proveedores y **USD 0 de coste de proveedor nuevo** en este corte;
infraestructura no cuantificada. Evidencias privadas en
`.data/r9-sql/{probe-result,full-probe-result,negative-result,test-result}.txt` del worktree SQL.
Agente configurado mediante el perfil `mfp_critico`: `gpt-6.1-sol`, esfuerzo `high`;
la configuración de spawn es la evidencia disponible, sin telemetría independiente
del modelo efectivo. La medición acredita el workspace de QA; no establece un SLO
para catálogos mayores.
