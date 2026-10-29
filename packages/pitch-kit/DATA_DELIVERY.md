# Entrega de datos · cuando el producto es el archivo

> La familia **Data** del kit. Aplica cuando lo que sale no es un deck sino datos: una muestra en el
> formato que el sistema del cliente ya ingiere, el paquete de datos que acompaña a un estudio, o un
> feed continuo hacia la plataforma de un socio. `DATA.md` sigue mandando sobre cómo se procesa un
> corpus; este archivo manda sobre lo que se entrega y cómo. Los feeds continuos tienen además
> `CONNECTORS.md`.
>
> Salió de tres casos de octubre de 2026: una muestra de 12 meses en el esquema de 69 columnas de la
> herramienta que el cliente quería reemplazar; el paquete de datos de un estudio para un socio que
> lo revende; y un túnel que entrega TikTok cada 15 minutos al SFTP de una plataforma socia. Los
> registros de cada caso viven fuera del repo.

En la KB la línea Data sigue marcada como exploratoria y sin precio (`packages/kb/02-services/
product-model.md`). Este archivo no la vuelve un producto listo para pitchear: documenta cómo se
entrega bien cuando ya se vendió.

## 1. Tres formas, una disciplina

| Forma | Qué compra el cliente | Quién lo consume | Cadencia |
|---|---|---|---|
| **Muestra o entrega en el esquema del cliente** | Datos de escucha en el formato exacto que su sistema ya ingiere, para reemplazar a su herramienta actual sin tocar su pipeline | Un sistema, no una persona | Una vez como prueba; después, recurrente |
| **Paquete de datos de un estudio** | La base que respalda las cifras del deck, para auditarlas o reproducirlas | Una persona en Excel, o el analista del socio | Una vez, al cerrar el estudio |
| **Feed continuo (conector)** | Un flujo de una red que su plataforma no cubre, en su formato de importación | El parser del socio | Cada 15 minutos o cada pocas horas |

Lo que cambia frente a un estudio, en las tres:

- **El contrato del archivo se negocia primero, no al final.** Formato, columnas, zona horaria,
  idioma, quién lo lee y cada cuánto, antes de bajar nada. Un deck se ajusta en revisión; un archivo
  que no entra al sistema del cliente no tiene revisión.
- **Las queries son el producto.** Sin deck, el valor está en la calidad de la búsqueda y en el
  volumen estimado antes de exportar. Se aprueban por escrito antes de bajar, porque bajar consume
  tope.
- **Sin lectura humana, salvo que se cobre.** Una entrega de datos lleva crudo y etiquetas por regla
  (ventana, idioma, país del tema, emisor, ruido, duplicados). Codificar por lectura es otro producto.
- **Una entrega de "una vez" se vuelve feed.** Pasó dos veces de tres. Ids estables, nombres de
  archivo deterministas y archivos nuevos en lugar de sobrescritos desde la primera entrega.
- **Lo repetible es el adaptador, no el clon.** Tomar el archivo actual del cliente como contrato,
  mapearlo con estados, medir el llenado y declarar lo que no se replica. Imitar las columnas de IA
  de la herramienta de un competidor nunca es producto: se declaran como no replicables y se ofrece
  lo propio, con nombre propio.

## 2. Antes de extraer

### 2.1 El contrato del archivo

Las preguntas, en este orden, con la respuesta por escrito en el registro del caso:

1. ¿Quién o qué lo consume? Si es un sistema, se pide **su archivo actual o su template de
   importación**, y ese archivo es el contrato: encabezados, orden, tipos, codificación.
2. ¿Qué redes, qué mercados y qué periodo? ¿Cuánto histórico, y la herramienta recolecta hacia atrás
   en cada red?
3. ¿El set completo de términos por mercado? (marcas, moléculas o productos, genéricos, errores
   ortográficos). Pedirlo después de la primera muestra costó una vuelta.
4. ¿Su herramienta actual aplica un filtro (por ejemplo, solo profesionales de salud)? Cambia el
   volumen en un orden de magnitud.
5. ¿Qué columnas alimentan vistas en su sistema? Autor y seguidores para un ranking de influencers,
   transcripción, imagen. Esas son las que se miden por red antes de prometer.
6. ¿Canal y cadencia? Archivo, SFTP, bucket o API; cada cuánto; métricas al recolectar o refrescadas.
7. ¿Comentarios o solo posts? Es la decisión que más mueve volumen y costo (§5).
8. ¿Fecha límite?

### 2.2 La auditoría de la recolección

Antes de exportar, por red:

- **¿El proyecto tiene reglas propias de esa red?** En la herramienta que usamos hoy, TikTok e
  Instagram se configuran aparte del query, en la interfaz. Un proyecto sin ellas trae esas redes
  solo por el índice general. Esa fue la causa probable de una caída de 86% de Instagram en un año que
  el cliente encontró antes que nosotros.
- **¿Recolecta hacia atrás o solo hacia adelante?** Si una red solo recolecta desde que se guardó la
  regla, una muestra histórica de esa red no representa al feed. Se dice antes de mandarla.
- **Los cupos de la cuenta:** proyectos, hashtags, llamadas por hora a la API, y los permisos de la
  llave (histórico contra reciente). Una cuenta llegó a 300 de 300 proyectos.
- **El plan de la cuenta.** Un feed en producción sobre una cuenta de prueba vence con ella.

### 2.3 El contrato con la fuente

**Que el contrato con la herramienta de origen permita redistribuir sus datos, por escrito.** En el
túnel no se verificó antes de arrancar y es su riesgo número uno. Ninguna entrega a un tercero sale
sin eso.

### 2.4 La cifra que se puede decir

**Ningún volumen se dice en una llamada sin medirlo antes con la regla de texto propio**
(`DATA.md` §12), y se dice con su definición. En una llamada se prometieron "158K menciones en 12
meses": era el export crudo, con otro país, todas las fuentes y los comentarios que no nombran la
marca. Lo comparable con lo que el cliente recibía de su herramienta eran 35,797, 4.5 veces menos.

**La vista previa de la interfaz tampoco es una cifra citable.** Marcó unas 7,800 menciones al mes y
el mes real dio unas 1,200 limpias. Es un piso para estimar un término nuevo y un techo engañoso para
prometer: la recolección de un término arranca al guardarlo, y un proyecto pasó de 174K en la vista
previa a 840K cinco días después.

## 3. El mapeo

Una fila por columna destino, con su regla y su llenado medido, en un xlsx que se entrega:

| Estado | Qué quiere decir |
|---|---|
| **Directo** | Sale tal cual de un campo del origen |
| **Derivado** | Se calcula: el id nativo desde la URL, la cuenta padre, la miniatura de un video |
| **IA de la herramienta destino** | Lo calcula su herramienta actual con su modelo. No se replica; se declara |
| **No existe en el origen** | Se deja vacío y se dice |
| **Campo de workspace** | Lo llena el usuario en su herramienta (etiquetas manuales, notas). Vacío |

Los campos del origen se describen en términos genéricos, nunca con su nombre de export (§8).

**El llenado se mide por red, por tipo (post contra comentario) y por mes**, nunca como un número
global. El autor global de una muestra se veía razonable; por red, Instagram, un tercio del archivo,
tenía autor en 0.5% de las filas, y el cliente arma su ranking con ese campo.
`builders/check-delivery.py --fill-cols` saca la tabla.

## 4. Formato

- **Encabezados idénticos y en el mismo orden** que el archivo del cliente, verificados por script
  (`check-delivery.py --ref`). Si el socio pide columnas extra, van **al final**, para no mover sus
  índices.
- **Un solo dialecto en todo lo que sale:** el mismo separador, la misma codificación y los mismos
  booleanos. Cuando el destino tiene ejemplo, manda el ejemplo (UTF-8 sin BOM y RFC 4180 para un
  parser; `;` con BOM para alguien que abre en Excel en un idioma con coma decimal). Un paquete salió
  con booleanos 0/1 en un archivo y True/False en otro: se unifica.
- **Entidades HTML decodificadas, URL plana** (nunca una fórmula de hoja de cálculo).
- **Vacío contra cero.** Vacío cuando la red no tiene la métrica; 0 cuando la reporta en cero. Si el
  origen escribe 0 por "no tengo el dato", se deja vacío. Si el ejemplo del destino pone 0 en las
  numéricas, se sigue el ejemplo, y se dice.
- **Ids.** Del tipo que pide el destino. Si es entero, un hash estable del id de origen de 48 bits,
  para que una hoja de cálculo no lo redondee, con el conteo de colisiones. **El mismo id entre
  corridas**, para que el destino deduplique y actualice. La tabla de cruce se queda interna, y
  ningún prefijo del proveedor sale (§8).
- **Zona horaria.** Se convierte con la zona de la cuenta de origen, con su cambio de horario,
  nunca con un offset fijo; se valida contra menciones que estén en las dos fuentes. La zona va en
  el nombre de la columna (`fecha_paris`) o todo va en UTC, y se dice. En una muestra se declara la
  ventana exacta; en un feed se corta en la hora del cliente. Ver también `DATA.md` §5.
- **Métricas fechadas.** Las interacciones y vistas son las del momento de la recolección, y lo dice
  el nombre de la columna (`interacciones_al_recolectar`), no una nota. Las métricas vivas van en un
  archivo aparte que se refresca; nunca se reescribe un archivo ya entregado.
- **Etiquetas por tema como diccionario versionado**, con los errores ortográficos mapeados al
  producto correcto.
- **Autores individuales seudonimizados** con un hash estable, salvo medios, instituciones y figuras
  públicas. Para auditar basta la liga.

## 5. Crudo, limpio y lo heredado

- **RAW** lleva solo los filtros de alcance: el mercado que contamina y los duplicados.
- **LIMPO** aplica pertinencia: el término en el texto propio y, en artículos, en el título o en los
  primeros 600 caracteres (los portales raspan la página completa y la marca aparece en titulares
  laterales bajo notas ajenas; esa regla retiró 2,041 artículos).
- Cada fila cae en **un solo balde con nombre**, y los baldes cuadran contra el total leído.
- **El país, con cuidado.** El campo país de la herramienta asigna países falsos: en X sale de la
  ubicación libre del perfil ("ba" de Bahía leído como Bosnia, "mg" de Minas Gerais como
  Madagascar), y Reddit trae siempre Estados Unidos. Se excluye solo el mercado que contamina, nunca
  "todo lo que no sea el país objetivo": eso tiraba 8,531 filas del mercado correcto.
- **Los comentarios de contexto heredado** (bajo un post que nombra la marca, sin nombrarla ellos)
  pueden ir en un entregable de datos con tres condiciones: separables por una columna, contados, y
  declarados en el mail. La conversación del hilo tiene valor para quien analiza. **La línea no está
  en el archivo, está en la cifra que se dice:** el total con comentarios nunca se presenta como
  "menciones de la marca". En análisis y decks, `DATA.md` §21 C no cambia.

## 6. El paquete de datos de un estudio

Tres capas, en carpetas separadas, unidas por el `id` de la fuente:

1. **Crudo:** el export original, filtrado por filas y nunca tocado en columnas, orden, separador ni
   codificación. **El crudo va intacto o no va.**
2. **Etiquetado por reglas:** cada mención única con las etiquetas del ETL.
3. **Leído:** la muestra codificada con su peso.

Nadie debe confundir una etiqueta por regla con una lectura.

Lo que lleva siempre:

- **Un LEEME generado, no escrito a mano**, con los nombres reales de los archivos, filas por
  archivo, periodo, zona horaria, qué se recortó, en el idioma del destinatario. El idioma y los
  nombres se fijan **antes** de generar: un paquete se renombró al inglés después y su LEEME quedó en
  español con los nombres viejos.
- **Un manifiesto:** archivo, filas, columnas y sha256 (`check-delivery.py --manifest`). El
  destinatario verifica que recibió lo que mandamos, y podemos reentregar idéntico.
- **Un diccionario de valores:** cada código de salida con su definición llana. Sin eso, una etiqueta
  como `T05_legitimidad` no le dice nada a nadie.
- **Las queries del generador**, en sus dos versiones (volumen y análisis), con el volumen que
  devolvió cada una y su rol. Una query de contexto que no entra a los totales del deck se marca como
  contexto en el manifiesto.
- **Los pesos, con su explicación:** cómo se usan y qué pasa si se ignoran.
- **Una cifra del deck reproducible desde el paquete**, con una suma ponderada. Si no sale, el
  paquete o el deck están mal.
- **Los recortes declarados:** qué campo, a cuántos caracteres y dónde está el texto completo. El
  tamaño se decide antes; si no cabe, se divide por query o por mes, sin recortar el crudo.

**Qué sale de la lectura y qué no.** Sale la etiqueta final, el peso y la cita: lo que respalda una
cifra del deck. **No sale** la evidencia por eje, las pasadas intermedias, la adjudicación, el lote o
el codificador, la versión del codebook, ni ninguna columna que exista solo para nuestro control de
calidad. Con miles de ejemplos con evidencia literal, cualquiera entrena un clasificador que imita
nuestra lectura, y las pasadas muestran cómo corregimos: eso es método. Con un socio que también es
plataforma de escucha, las etiquetas por regla (`emisor`, `pais_tema`, `ruido`) salen como resultado,
la columna, y nunca como regla, el script o las listas. Y van **con licencia escrita**: uso para ese
cliente y ese estudio, sin entrenar modelos ni revender las etiquetas.

## 7. Gates

Los de `DATA.md` §21, leídos para una entrega, más seis que solo existen aquí.

| Gate | En una entrega de datos |
|---|---|
| A. Integridad | Sí: hashes de los crudos, filas leídas, fechas inválidas, días de borde parciales |
| B. Reconciliación | Sí, por baldes con nombre. Contra el total del tablero de la herramienta, cuando se pueda obtener |
| C. Pertinencia | Sí, con la variante de §5: contexto heredado separable y declarado |
| D. Relaciones | Sí: roles de query, universo contra corte, nunca sumados |
| E. Codificación | Etiquetas por regla, versionadas |
| F. Verbatims | Casi nunca: en un archivo no hay citas |
| G. Afirmaciones | Sí, en el mail: menciones no son personas; seguidores no es alcance; país vacío no es extranjero |
| **H. Serie mensual por red y tipo** | Antes de cualquier histórico: filas por mes, por red y por tipo. Un salto de más de 2x, una red que aparece o desaparece, o una amplitud de más de 4x en los meses completos se explica antes de mandar o se declara. Se compara contra una red estable del mismo archivo para separar mercado de recolección. `check-delivery.py --date-col` |
| **I. Esquema destino** | Encabezados, orden, tipo del id y codificación, por script. `check-delivery.py --ref` |
| **J. Confidencialidad** | Nada de lo que sale (archivos, nombres de archivo, mapeo, mail) contiene al proveedor, sus prefijos de id ni sus nombres de campo. `check-delivery.py --forbid` |
| **K. Configuración de recolección** | §2.2, hecha y registrada |
| **L. Regresión** | Si el ETL cambia, la entrega anterior se regenera y sale idéntica byte a byte. Un bug de paginación casi reporta un salto falso; lo atrapó la deduplicación por id |
| **M. Cifra citable** | §2.4: el número que se dice tiene su definición y salió de la regla de texto propio |

## 8. Lo que nunca sale

- **El proveedor de la escucha.** Ni su nombre, ni en nombres de archivo, ni en el mapeo, ni en el
  mail. Quitar el nombre no alcanza: sus nombres de campo ("Specific type", "Domain group",
  "influenceScore") y sus prefijos de id también lo identifican. Ante un socio se dice "the data
  source". Todo texto que sale pasa por un filtro probado, y antes de mandar se corre el gate J.
- **Credenciales:** llaves, tokens, DSN, usuarios, ni en un ejemplo de configuración.
- **Método:** scripts, prompts, codebook, listas de ruido, listas de nombres, reglas de
  clasificación, y las columnas de control de §6.
- **Datos de otros clientes o de otros casos**, aunque sea una fila que se coló por una query
  compartida.
- **Consumo de créditos, precios, costos o márgenes** de la herramienta de origen.
- **Lo que el contrato con la fuente no permite redistribuir** (§2.3).
- **Datos personales que el uso no necesita** (§4).
- **Rutas locales**, nombres de máquinas o de carpetas internas dentro de los archivos.

**Las llaves de otro cliente no se usan, tampoco para sondear.**
1. Nunca se usa la credencial de otro cliente o de otra cuenta para un caso ajeno a ella.
2. Primero se pide la llave de la cuenta correcta. Si hace falta otra, aprobación explícita de su
   dueño.
3. Todo uso queda registrado: llamadas, alcance, solo lectura y horario.
4. Las llaves nunca se guardan en la carpeta del caso ni en el repo.

## 9. El mail técnico

- Qué trae cada archivo, con sus conteos.
- Cada filtro, con cuántas filas quitó.
- Qué columnas no se replican y por qué.
- Las limitaciones que el cliente va a ver: una red que recolecta solo hacia adelante, métricas al
  momento de recolección.
- Nunca el proveedor.

**El tono explica cómo funciona y qué se puede sumar; no diagnostica ni pide espera.** Un mail se
reescribió tres veces: una tabla con "Partial", una tabla con diagnóstico, y al final viñetas cortas
en tono "sí, así funciona por diseño". **Ningún compromiso que no esté verificado:** "TikTok y
Facebook son lo siguiente en nuestra lista" salió de un borrador porque esa capacidad no existía.

## 10. Comercial, sin montos

- **Pago único:** la integración (el mapeo al esquema, el conector, la deduplicación, la
  actualización de métricas) y la puesta en marcha.
- **Aparte:** la carga histórica, cotizada por rango. Consume tope y lleva conversión.
- **Recurrente:** el feed, por paquete mensual de menciones.
- **Dos topes distintos que no se mezclan:** el de la herramienta de origen, que es nuestro costo, y
  el paquete que compró el cliente o el socio, que es su contrato. Del segundo se avisa **antes** de
  acercarse al límite.
- Los montos y quién los define viven en el Drive comercial, nunca aquí.

## 11. El caso, fuera del repo

Cada entrega vive en su carpeta, con la misma estructura de los estudios:

```
00_insumos/        crudos intactos, con hashes
01_etl/            scripts del caso
02_trabajo/        intermedios internos: reporte del ETL, gates, llenado, cruces. No salen
03_entregables/    solo lo que sale: archivos, mapeo, LEEME, manifiesto, borrador del mail
PROVENANCE_AND_CHANGELOG.md
CAMBIOS_PROPUESTOS_AL_PITCH_KIT.md
```

El código del caso se ordena en tres capas: un **adaptador de origen** (lee el export y produce una
mención canónica; conoce los campos del proveedor, así que nunca entra al kit público), un **núcleo**
(streaming, id estable, zona horaria, partes de la URL, exclusión de mercado, la regla del lead, texto
propio contra contexto, vacío contra cero, el escritor de baldes, los diccionarios de etiquetas) y un
**adaptador de destino** (la lista de columnas y sus reglas). El núcleo es el candidato a builder del
kit cuando haya un segundo caso que lo use igual; hoy el kit trae `builders/check-delivery.py` para
los gates H, I y J y el manifiesto.
