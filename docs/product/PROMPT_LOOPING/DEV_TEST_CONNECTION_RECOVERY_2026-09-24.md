# Recuperación focal de conexión privada — 24 septiembre 2026

Alcance autorizado por el operador presente: resolver la conexión de Railway dev-test.
El desarrollo general y el loop permanecen PAUSED. No autoriza ejecutar las migraciones
ni los ensayos de aceptación pendientes como parte de esta comprobación.

## Evidencia y corrección

1. El operador completó el comando interactivo `\password noisia_dev` con el valor
   actual de POSTGRES_PASSWORD, mediante entrada y confirmación propias en Console.
   psql regresó al prompt sin error. No se guardó ninguna contraseña en código o recibos.
2. Reinicio único del runner anterior, despliegue `2e3afc17-ef2e-4fdd-aa80-fa0e10ec62d8`:
   log de 2026-09-24 10:56:24 CST / 16:56:24 UTC llegó a `stage: identity`, con
   `noi19_dev_test_database_identity_mismatch`. La autenticación ya pasó; el 28P01
   histórico no es el resultado nuevo. La causa exacta de la desincronización anterior
   no queda probada por este resultado.
3. Se identificó un fallo del verificador: `inet_server_addr()::text` incorpora el sufijo
   de red, incompatible con la comparación exacta contra DNS y con `net.isIP`.
   Consulta literal sin escrituras en el PostgreSQL real:
   `SELECT inet 'fd12::1'::text,host(inet 'fd12::1');`
   Resultado observado: `fd12::1/128 | fd12::1`.
4. Commit focal `063e677` cambia sólo la expresión de dirección a
   `host(inet_server_addr())` y añade regresión IPv4/IPv6. Los guards siguen rechazando
   direcciones con CIDR, hosts públicos y discrepancias de identidad. Trece tests PASS,
   diff-check PASS. No cambios al sello, bootstrap, Dockerfile, permisos ni políticas.
5. Entrega manual sólo a `noi19-private-runner` en dev-test, despliegue
   `d3a55ca6-36fa-4585-ac00-fc92a7cce1ff`, rama focal, commit `063e677`.
   Start command conservado: bootstrap-readonly.mjs; autodeploy deshabilitado,
   restart policy never, sin proxy público.

## Resultado remoto

Recibo observado en Deploy Logs a las **2026-09-24 11:03:07 CST / 17:03:07 UTC**:

```json
{
  "contract_version": "noi19-private-bootstrap-v1",
  "status": "observed",
  "system_identifier": "7683766906362679330",
  "schema_sha256": "3e802b520cbfb12e8995103d07d6f2ac5e2d32e9833140d2170f00edf6548d3c",
  "tables": 269,
  "table_count": 269,
  "nonempty_tables": 0,
  "empty": true,
  "read_only": true
}
```

Conexión privada e identidad comprobadas: **bloqueo28P01 resuelto**. Base vacía de269
tablas, no esquema299 todavía. No se aplicó upgrade0153–0182, SQL0183, fixture ni
aceptación funcional. El sello en código sigue sin rellenar; este recibo proporciona
sus valores reales para revisión del siguiente corte. UAT/producción/Laika intactos,
sin importaciones, embeddings, fits, proveedores ni gasto Claude/Voyage nuevos.

## Lo que sigue pendiente

Revisar y sellar el recibo real; actualizar exclusivamente el esquema vacío dev-test si
procede mediante el runner de upgrade explícito; ejecutar los seis escenarios con
rollback de Signal desde importación antes de entregar ese corte a UAT. El ensayo
positivo0183 es independiente. Ninguno de estos pasos se considera cerrado por una
conexión exitosa. No reactivar loop o proveedores sin nueva instrucción.
