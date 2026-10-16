# Releases de la skill `noisia-comercial`

La skill no se actualiza sola. Ferdi y David la tienen subida en sus cuentas personales de
claude.ai, y cada versión nueva la tienen que volver a subir a mano. Por eso no se publica cada
cambio del kit comercial: se junta diff y se saca una release cuando vale la pena reinstalar. Una
release es un commit manual: número de versión, tag de git y entrada en esta tabla.

## Cuándo se saca una release

```bash
python3 packages/pitch-kit/commercial/build_skill.py --status
```

Lista lo que cambió en lo que viaja dentro de la skill desde la última release, agrupado por lo
que le pasa a quien la usa. Vale la pena una release cuando hay al menos uno de estos:

- **Cambia lo que sale**: copy (`copy/`), recetas, una slide nueva o rediseñada, assets o fondos.
- **Cambia cómo trabaja**: la entrevista, el flujo o las reglas de `SKILL.md` y `COMMERCIAL.md`.
- **Se arregla algo que les pega**: un bug del builder que ya vieron o que van a ver en su próximo deck.

No vale una release por sí sola: una corrección de redacción en las reglas, un cambio que solo
usa quien trabaja desde el repo, o algo que ninguno de los dos va a notar. Eso espera a juntarse
con lo siguiente. Si hay duda, la pregunta es: ¿les pediría que reinstalen por esto?

## Cómo se saca

1. En una rama al día con `main`: sube `skill/VERSION` (1.1 → 1.2 para cambios normales, 1.x → 2.0
   si cambia la forma de trabajar) y agrega la fila arriba de la tabla, escrita para ellos, no para
   el repo. Commit.
2. Desde esa rama, sin cambios locales: `python3 packages/pitch-kit/commercial/build_skill.py` arma
   `dist/noisia-comercial-v<versión>.zip`. Se niega si el árbol está sucio, si la rama no contiene
   `origin/main`, si falta la fila de la versión o si esa versión ya salió en otro commit.
3. Tag del commit con el que se armó, push del tag y de la rama, y PR. El PR se mergea con merge
   commit, nunca squash: así el commit del tag queda en la historia de `main`.
   `git tag -a skill-comercial-v<versión> -m "noisia-comercial v<versión>" && git push origin skill-comercial-v<versión>`
4. Se sube el zip a Drive, a *Kit comercial · demos (oct 2026)*, con la versión en el nombre. La
   versión anterior pasa a la subcarpeta *Skill · versiones anteriores*. Nunca se borra.
5. Mensaje a Ferdi y David: qué cambió (la columna de abajo, tal cual), el link al zip y el paso
   para reemplazarla: en claude.ai, Customize, Skills, borrar `noisia-comercial` y subir el zip
   nuevo.

La versión viaja dentro de `SKILL.md`, así que en cualquier chat se le puede preguntar a la skill
qué versión es, y cuando reporten un problema se sabe con qué kit lo vieron.

## Versiones

| Versión | Fecha | Tag | Qué cambia para quien la usa |
|---|---|---|---|
| 1.1 | 2026-10-15 | `skill-comercial-v1.1` | Puede rehacer un deck que ya existe (lee el anterior, propone cómo pasarlo y avisa qué copy choca antes de construir) y agregar slides que la receta no trae. Los fondos ya no tapan el texto de las tablas de precio. El logo del cliente siempre cabe en su recuadro. Avisa cuando el copy trae contrastes tipo "no es X: es Y". El PDF que se manda es el de Google Slides, y la skill lo dice claro |
| 1.0 | 2026-10-14 | `skill-comercial-v1.0` | Primera versión: seis entregables (opener, outbound, overview, oferta, propuesta, one-pager), en español o inglés, PPTX para Google Slides o PDF. Entrevista una pregunta a la vez, investigación de la marca con confirmación, cero insights, precios en XXX, portadas bloom, entrega en la carpeta del lead |
