# Evidencia de Narratives consolidadas en Signal

Fecha: 2026-09-27

## Resultado del corte

Signal nativo enviaba siempre `kind=topic` al pedir detalle y evidencia, aunque el usuario hubiera seleccionado Narratives. Los endpoints nativos rechazaban cualquier otro tipo. Ahora el tipo editorial seleccionado viaja desde los paneles de Signal hasta el lector de DB y vuelve en los contratos de detalle/evidencia.

El lector comprueba que la clave seleccionada pertenece a la clase declarada, conserva los mismos filtros de workspace, currentness, selección, derechos y digest de alcance, y liga el tipo al cursor de paginación. Los cursores Topic anteriores siguen siendo válidos; un cursor Topic no se acepta al paginar una Narrative. Los conceptos relacionados en el panel de detalle se limitan a la misma clase editorial.

## Validación

- La prueba de serving con snapshot consolidado sintético confirma Narrative → detalle → cita, derechos de lista/texto, rechazo al cambiar a Topic y rechazo de cursor con tipo distinto.
- 10 pruebas de DB focales y 39 pruebas focales de UI/API reportaron PASS.
- Typecheck Studio y ESLint Studio pasaron; ESLint mantiene 13 advertencias existentes.
- El build de Studio compiló código y pasó tipos, pero Next no pudo terminar la recopilación de rutas sin `DATABASE_URL` local. Primero faltaron variables Kinde; se repitió con placeholders ficticios y nunca se leyó ni cambió una credencial real.
- Sin SQL, importación, actualización de datos ni llamadas a proveedores.

## Alcance pendiente

La verificación positiva usa un snapshot y menciones sintéticos; Alexa+ sigue sin una revisión consolidada final activa, así que todavía no existe una Narrative real en UAT para recorrer de extremo a extremo. El corte queda listo para Studio UAT, pero no se debe describir como verificación visual positiva de Narrative hasta que haya una Narrative real servida.

Después de instalarlo, verificar que Topics y Signal existentes sigan cargando sin cambios; al publicar una consolidación real, comprobar Narrative → evidencia → mención original desde la interfaz. El trabajo no calibra la calidad semántica ni completa los lotes pendientes de Alexa+.
