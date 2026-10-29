# Conectores · un feed continuo de la herramienta de origen al destino de un socio

> La parte continua de la familia Data (`DATA_DELIVERY.md`). Salió del primer conector de Noisia en
> producción: TikTok desde la herramienta de escucha hasta el SFTP de una plataforma socia, cada 15
> minutos, para un cliente final del socio, en vivo desde el 23 oct 2026 sin perder una ventana. Su
> código, su configuración y su runbook concreto viven en un repo privado, nunca aquí.
>
> Nombres genéricos: **origen** es la herramienta de escucha de la que leemos; **socio** es la
> plataforma que compra los datos; **cliente final** es el cliente del socio.

**Es un patrón, no un framework.** Hay un solo conector de streaming. Cuando exista el segundo, se
extrae lo común; antes de eso se copia el patrón y las piezas probadas, sin abstraer.

## 1. La regla de aislamiento

Todo conector para un socio vive en **su propio repo privado y su propio proyecto de
infraestructura**, sin recursos compartidos con el producto. El monorepo es público y despliega a
producción desde `main`; un conector lleva datos de cliente, credenciales de terceros y nombres de
socios.

- Los secretos viven solo en las variables del proveedor de despliegue, nunca en git ni en la carpeta
  del caso.
- Los datos de cliente (exports, CSV, volúmenes, nombres) nunca entran al monorepo ni a este kit.
- **El repo privado es la única fuente de verdad:** lo que corre se despliega desde ahí, con commits,
  no desde una carpeta local ni pegando un bundle a mano. El primer conector todavía no lo cumple, y
  por eso es regla.

## 2. Cómo funciona un ciclo

```
API del origen (export por stream, por proyecto, filtrado por fecha de RECOLECCIÓN)
        │
        ▼
Función programada (cron)
  extraer   ─► Postgres: mentions (llave feed + id), runs, files, usage_monthly, alert_state, locks
  publicar  ─► CSV en el formato del socio ─► SFTP (.part y renombrar)  +  bucket propio de respaldo
  reportar  ─► alertas, heartbeat, métricas refrescadas y correos al socio en sus horarios
```

## 3. Reglas

1. **Ventanas sin traslape, por fecha de recolección.** Se pide `[marca, ahora − margen)` filtrando
   por cuándo se recolectó, no por cuándo se publicó: así entra lo publicado hace días que se recolectó
   hoy. La marca avanza solo si el stream terminó limpio. Tras una caída, se pone al día en rebanadas
   acotadas (6 horas). Nunca se repide una ventana completa "por si acaso": se paga dos veces.
2. **El endpoint correcto.** El stream "reciente" del origen descarta lo publicado hace más de 7
   días aunque se haya recolectado hoy: en una misma ventana dio 153 menciones contra 270 del
   histórico. El conector usa el histórico.
3. **Margen de seguridad para la indexación**, unos 10 minutos entre "ahora" y el fin de la ventana.
   Se mide: la misma ventana pedida dos veces, con 15 a 30 minutos de diferencia, tiene que dar lo
   mismo.
4. **Dedupe por id estable**, con upsert sobre la llave (feed, id). Si un feed une varios proyectos
   del origen, la llave es el id de la plataforma, no el del proyecto. La misma mención puede ir a dos
   feeds distintos.
5. **Comentarios contra posts, decisión explícita por feed.** En modo contextual, los comentarios de
   un post que hace match multiplican el volumen (más de 75 por video en el primer feed: el 98.7% de lo
   encontrado eran comentarios) y entran aunque no nombren el término. Es la decisión que más mueve el
   costo. El tipo va en su propia columna, porque el "tipo de medio" del destino no distingue post de
   comentario.
6. **Consumo por feed.** Se cuenta lo bajado por feed y por mes, con tope por feed y alerta al 80%.
   La pausa al 100% solo con acuerdo comercial: pausar a la mala corta al cliente final. Lo que se
   cuenta es lo bajado, que puede no coincidir con lo que el origen factura; se verifica contra su
   cuenta.
7. **Métricas.** Las del registro son las del momento de recolección, y se declara así. Si el socio
   quiere métricas vivas, van en un archivo aparte que se refresca (en el primer conector, dos veces
   al día sobre los últimos 7 días). Nunca se reescribe un archivo ya entregado.
8. **El formato del socio.** Se sale en su template de importación, pedido desde el día uno. Las
   columnas extra que pida van al final. Se valida contra datos reales: 50 o más filas del API contra
   un export manual de la interfaz, columna por columna (en el primero, 55 de 56 columnas idénticas;
   la única diferencia era que el API entrega los saltos de línea como espacios).
9. **Entrega atómica.** En SFTP se sube como `.part` y se renombra al final, para que su parser nunca
   lea un archivo a medias. En bucket, un objeto nuevo por archivo. Un archivo nuevo por ventana, con
   nombre determinista en UTC, nunca el mismo archivo sobrescrito.
10. **Destinos independientes.** Cada destino (cada carpeta del SFTP, el bucket) tiene su estado de
    entrega. Si uno falla, la siguiente corrida reintenta solo ese, con el mismo archivo y sin volver a
    extraer. El estado "parcial" refleja lo que importa al socio: si llegó a su destino, no si llegó
    el respaldo.
11. **Un solo worker, idempotente.** Un candado en la base y un solo cron. Para migrar, se apaga el
    viejo y se confirma su última corrida. Migraciones idempotentes que corren en cada ciclo. Los
    envíos programados se marcan como hechos para no repetirse.
12. **Confirmación de llegada.** Lo mínimo es verificar que el archivo existe en el destino después
    del renombre. Lo correcto es una señal de importación del socio: un conteo por archivo, o un
    `.done` de su lado. **Se pide desde el contrato**; el primer conector no la tiene.
13. **Respaldo propio.** Cada archivo va también a un bucket nuestro, para reenviar, auditar y
    contestar "¿qué les mandamos el martes?".
14. **El origen no se nombra ante el socio** si el contrato lo pide así. Todo texto que sale pasa por
    un filtro probado (`DATA_DELIVERY.md` §8).

**El histórico queda corto los primeros días.** El origen sigue recolectando comentarios de videos
viejos durante días: en las 6 horas siguientes a una carga histórica, un feed recolectó decenas de
miles de menciones nuevas publicadas la semana anterior, y ninguna estaba en el archivo histórico. El conector las
entrega como datos nuevos, y se le dice al socio desde el principio.

## 4. Gates de un feed

**En cada ciclo, automáticos:**
- [ ] El stream terminó limpio. Si no, la marca no avanza.
- [ ] El retraso está por debajo del umbral (60 minutos).
- [ ] Cada archivo llegó a todos sus destinos. Si no, "parcial" y reintento solo en el que falló.
- [ ] Sin 429, 401 ni 403 del origen. Un 401 o 403 es llave o cuenta vencida: se escala de inmediato.
- [ ] El consumo del mes está bajo el tope del feed.
- [ ] Ping al heartbeat solo si todo lo anterior salió bien. El ping prueba que la corrida terminó,
      no que el socio importó.

**Cada semana, con informe:**
- [ ] Volumen por día contra la semana anterior: ¿silencio anómalo o pico?
- [ ] Consumo acumulado contra el paquete del socio, con su proyección a fin de mes.
- [ ] Veinte filas del último archivo: columnas completas, URLs que abren, sin texto roto.
- [ ] El radar: términos que aparecen en lo ya recolectado y que el query no tiene, con evidencia,
      como propuesta al socio. Del primero salió una propuesta de "query que aprende de la
      conversación", y el socio aprobó una tanda grande de términos nuevos.
- [ ] Qué trajo cada término activado, y si se queda.
- [ ] El plan de la cuenta del origen, su vencimiento y su changelog de API.

## 5. Definición de "en producción"

Entregar a un cliente que paga, con alertas y sin perder ventanas, es necesario y no alcanza. Un
conector está en producción cuando además tiene:

- [ ] la cuenta del origen en plan definitivo, no de prueba, y el **contrato de redistribución
      escrito**;
- [ ] el repo privado como única fuente, con despliegue desde ahí (§1);
- [ ] un entorno de staging contra un destino de prueba;
- [ ] la señal de importación del socio (regla 12);
- [ ] el tope por feed configurado, no vigilado a mano;
- [ ] una segunda persona que sabe operarlo, además de cualquier agente de guardia.

El primer conector cumplía cero de seis al cumplir una semana en vivo. Se escribe como lista para
que el siguiente arranque con ella.

## 6. Altas y cargas

**Alta de un feed:**
1. El socio manda sus búsquedas.
2. Se traducen a las reglas de la red en la interfaz del origen (la API no crea reglas de TikTok):
   frases entre comillas, plurales y variantes explícitos (no hay stemming), regla de idioma, sin
   país (TikTok casi no lo trae). En el origen actual, la búsqueda ignora mayúsculas y acentos con la
   opción de caracteres especiales, el comodín `*` funciona y dos palabras sin comillas son un AND.
3. Se estima el volumen con la vista previa, que no consume tope y es un piso, y se compara con lo
   que ya se entrega.
4. El socio aprueba por escrito.
5. Se agrega el feed: proyectos, si lleva comentarios, filtro de fecha de publicación, carpeta
   destino y tope.
6. Se activa con la marca en "ahora" o en el fin de la carga histórica.

**Carga histórica:** por API, bajando lo publicado en un rango (gasta tope), o desde el export de la
interfaz convertido al formato del socio. Va como archivo aparte con `history` en el nombre, y el feed
sigue exactamente desde la hora del export.

## 7. Runbook genérico

**Antes de tocar nada:** leer el README del conector y su brief de operación; confirmar que se
despliega desde el repo privado; nunca correr un segundo worker en paralelo.

**Chequeo diario, cinco minutos:** heartbeat arriba; última corrida bien y retraso normal; ningún
archivo sin llegar a todos sus destinos; consumo en línea con el paquete; llegó el resumen diario.

| Síntoma | Primero mira | Acción |
|---|---|---|
| Heartbeat caído | Logs de las últimas corridas | ¿Falló o fue parcial? Sigue la fila que aplique |
| Parcial | Qué destino falló | Se reintenta solo. Si persiste dos corridas: credenciales, permisos o espacio de ese destino |
| Retraso creciendo | ¿429? ¿Stream cortado? | Con 429 se espera y se pone al día solo. Si dura más de una hora, revisa el tope del origen |
| 401 o 403 del origen | Plan y llave | Escala de inmediato: cuenta vencida o llave revocada |
| Cero menciones durante horas en un feed activo | Vista previa del proyecto en el origen | ¿Cambió la regla? ¿Se cayó la recolección del origen? |
| El socio dice que faltan datos | El bucket de respaldo: ¿existe el archivo de esa hora? | Si existe, se reenvía. Si no, carga del rango (gasta tope) |
| Consumo al 80% del paquete | La proyección a fin de mes | Se avisa al responsable comercial antes de que el socio llegue al límite |

**Cambios:** pausar sin perder la marca; prender o apagar un feed; mover la marca (hacia atrás gasta
tope); cambiar código con pruebas, build y despliegue desde el repo, avisando qué cambió, por qué y
cómo revertirlo. Los correos al socio nunca se reenvían a mano ni se borran sus marcas de envío para
forzarlos.

**Se escala** ante un 401 o 403, más de una hora de retraso, un destino caído más de dos corridas, o
cualquier cosa que el socio note antes que nosotros.

## 8. Antes de cotizar un conector nuevo

1. ¿Qué red y qué origen? ¿Su API exporta por stream y filtra por fecha de recolección? ¿Qué plan
   exige?
2. ¿El contrato con el origen permite redistribuir? Por escrito.
3. ¿Volumen esperado, con o sin comentarios? Estimado con la vista previa antes de prometer.
4. ¿Formato del destino? Su template o su parser. ¿SFTP, bucket o API? ¿Llave o contraseña? ¿IP fija?
5. ¿Cadencia? ¿Archivo nuevo por ventana o uno actualizado? ¿Quién borra los leídos?
6. ¿Métricas vivas o al momento de recolección?
7. ¿Carga histórica, de cuánto?
8. ¿Qué señal de importación nos pueden dar?
9. ¿A quién se avisa en un corte? ¿Hay SLA?
10. ¿Cuántos feeds o clientes finales en tres meses? Cambia los límites de API a vigilar.

## 9. Lo que se sabe del origen actual, y con qué certeza

Los límites de la API del origen se documentan de forma contradictoria. Se separa lo observado de lo
leído, y se vuelve a revisar después de cada cambio de su changelog.

| Afirmación | Certeza |
|---|---|
| El stream "reciente" descarta lo publicado hace más de 7 días | Confirmado por nosotros |
| `publishedAt.to` tiene que estar en el pasado | Confirmado (error del API) |
| Sin retraso de indexación con 10 minutos de margen | Confirmado |
| Mayúsculas y acentos ignorados, sin stemming, `*` funciona | Confirmado en la interfaz |
| Las reglas de TikTok solo se crean en la interfaz | Documentación más interfaz |
| 14,400 streams por hora | Observado en el encabezado de límite; la misma documentación dice 5 por hora en otro lado. Nunca dio 429 por tasa |
| 2 streams simultáneos | Solo documentación |
| Desde el 5 nov 2026: 50 streams históricos por cada 15 minutos | Changelog; verificar con los encabezados |
| Al pasar el tope mensual, 429 hasta el mes siguiente | Solo documentación; no se ha vivido |
| Todo endpoint que devuelve menciones cuenta contra el tope | Solo documentación |

Nada de esto se confirmó persona a persona con el origen. Si se negocia algo, va al registro del
conector.

## 10. Lo que se puede copiar

Del repo privado del primer conector, sanitizado: el ciclo con marcas y rebanadas; los destinos SFTP
(`.part` y renombrar), S3 con reintento por throttling, Drive y local con una misma interfaz; el
esquema de la base con migraciones idempotentes; las alertas que abren tras N fallas y se cierran
solas; el heartbeat solo en corridas buenas; la lectura NDJSON por stream con reintento que no
reintenta 4xx; el bundle de un archivo para una función programada; y un arnés de punta a punta con
origen falso, Postgres en Docker y un SFTP real en proceso.

No se copia: el template, el mapping, las carpetas ni los textos de correo del socio, ni el cliente
concreto del origen.
