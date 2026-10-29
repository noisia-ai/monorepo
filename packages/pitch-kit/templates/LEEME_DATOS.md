# << Nombre de la entrega >> · LEEME

> Plantilla. **El LEEME se genera con un script desde los archivos reales**, no se escribe a mano:
> los nombres, conteos y columnas de abajo salen de lo que de verdad va en la entrega. El idioma y los
> nombres de archivo se fijan antes de generar, en el idioma de quien lo recibe. Ver
> `DATA_DELIVERY.md` §6. Borra este bloque al usarla.

Generado el << fecha >> por << script >>. Periodo: << desde >> a << hasta >>, << zona horaria >>.
Contiene datos publicados por terceros en redes; uso limitado a << cliente y propósito >>.

## Qué hay

| Archivo | Filas | Qué es |
|---|---|---|
| << 01_.../archivo.csv >> | << n >> | << crudo intacto, etiquetado por reglas o leído >> |

El manifiesto (`MANIFEST.csv`) trae filas, columnas y sha256 de cada archivo, para verificar que
llegó lo mismo que salió.

## Formato

Separador << ; o , >>, << UTF-8 con o sin BOM >>. Fechas en << ISO, zona >>; la zona va en el nombre
de la columna. Booleanos como << 0/1 >> en todos los archivos. Varios valores en una celda se
separan con `|`. Las métricas son las del momento de la recolección.

## Columnas que no son obvias

| Columna | Qué quiere decir |
|---|---|
| << columna >> | << definición llana >> |

Los códigos de cada columna están en `DICCIONARIO.csv`.

## Lo que se recortó

<< Campo, a cuántos caracteres y dónde está el texto completo. Si nada, "Nada". >>

## Cómo reproducir una cifra

<< Una cifra del entregable, y la suma (ponderada si aplica) que la da desde estos archivos. >>
