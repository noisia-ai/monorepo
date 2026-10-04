# Accesos y credenciales compartidas del programa MFP

Preparado el 4 de octubre de 2026 a petición del fundador para que el nuevo orquestador y sus auxiliares reutilicen accesos existentes. Complementa el spec v1.3 y sus reglas vigentes de presupuesto orientativo, verificación JEV y entregas progresivas en UAT.

## Archivo privado compartido

`/Users/brandhon_o/.config/noisia/mfp/credentials.env`

Directorio con permisos `0700`, archivo `0600`, fuera del repositorio y de los worktrees. Formato dotenv con valores entre comillas dobles. Leer mediante dotenv, nunca mediante `cat`, logs, prompts ni comandos que impriman el entorno. No hacer `source`: los valores están serializados para dotenv, no para expansión de shell.

Variables disponibles:

- Claude: `ANTHROPIC_API_KEY`.
- Voyage: `VOYAGE_API_KEY`.
- JEV: `TYPESAFE_API_KEY`, guardada desde la clave que el fundador indicó reutilizar.
- Supabase: URL, anon key, service role y nombres de buckets.
- Kinde: client ID, client secret e issuer.
- Resend: API key y remitente.
- SentiOne: API key, base URL y proyecto predeterminado.

No copiar todas las credenciales a cada proceso: cargar las necesarias para el servicio o proveedor correspondiente. No pasar claves de servicio al navegador ni a variables NEXT_PUBLIC.

## Resultado de comprobación

- Claude: `GET https://api.anthropic.com/v1/models` respondió HTTP 200 con JSON.
- JEV: `GET https://api.typesafe.ai/v1/models` respondió HTTP 200 con JSON.
- Voyage y demás servicios: credenciales presentes; no se ejecutaron inferencias ni se certificó su estado de facturación/permisos.
- No se enviaron menciones a proveedores ni se iniciaron ejecuciones de producto. Las comprobaciones de modelos no certifican saldo, todos los modelos ni límites de uso.

Recibo privado sin valores: `/Users/brandhon_o/.config/noisia/mfp/access-check.json`.

## Entorno de ejecución separado

Los archivos existentes `apps/studio/.env.local` y `services/workers/.env` contienen una conexión de DB remota y conservan configuración histórica. No copiarlos completos ni enlazarlos a WS1.

El archivo compartido NO incluye `DATABASE_URL`, `REDIS_URL`, selección de modelo, callbacks de login ni flags de ejecución. WS1 debe configurar los servicios del `dev-test` remoto con conexiones exclusivas de MFP y cargar sólo las credenciales necesarias por servicio. PostgreSQL, Redis y Worker corren allí; no se levanta Docker en la Mac. Las conexiones privadas de ese entorno se resuelven desde el runner remoto, no copiando URLs históricas al proceso local. Mantener secretos en variables privadas del servicio y fuera de Git, logs y recibos. El archivo compartido no acredita que la base/cola MFP ya estén provisionadas: WS1 verifica y configura ese destino según §9.1 del spec.

Tener una clave no sustituye autoridad, configuración del servicio ni derechos sobre los datos. Los presupuestos de las demos son orientativos: el fundador autoriza superarlos para completar el programa, con coste registrado y previsión actualizada; no se pide autorización rutinaria por una desviación. Sólo un máximo estricto configurado explícitamente constituye un tope (§6.5). WS3 verifica JEV con fuentes oficiales y pruebas según §9.3; `JEV_DUE_DILIGENCE.md` registra evidencia, sin firma ni carta obligatorias. Las restricciones reales de tratamiento de datos siguen aplicando. UAT admite cortes parciales coherentes según §6.9; producción conserva su aceptación integral.

Las sesiones de GitHub/Railway/navegador y los permisos de herramientas pertenecen al host y al chat; no son credenciales que deban extraerse de almacenes o copiarse indiscriminadamente a dotenv. El nuevo chat debe usar las sesiones existentes cuando estén disponibles y comprobar el permiso necesario para una operación concreta. No afirmar acceso de escritura por haber validado sólo lectura.

## Instrucción para el nuevo orquestador

Lee este documento junto al spec. Ya hay credenciales compartidas, incluidas Claude, Voyage y JEV. No vuelvas a pedirlas sin comprobar primero su disponibilidad y el error real de la operación necesaria. Enlaza su carga selectiva al harness remoto de WS1, usando exclusivamente su destino dev-test verificado, sin heredar la base/cola de los .env históricos. No publiques claves, no leas secretos históricos y no actives el loop anterior. Si una credencial falla, registra sólo servicio y código saneado; continúa el trabajo independiente.
