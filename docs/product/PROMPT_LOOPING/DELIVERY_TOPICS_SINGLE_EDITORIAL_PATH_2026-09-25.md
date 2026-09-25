# Un solo camino editorial en Topics — 25 septiembre 2026

## Problema visible

Alexa+ muestra 1,652 grupos numéricos preparados y una revisión de consolidación Claude en 2/42 lotes. En la misma pantalla, la sección antigua «Analizar conversaciones» ofrecía «Autorizar y continuar» para una interpretación parcial distinta. Ese control podía llevar al usuario a gastar en el catálogo de 36 Topics anteriores en vez de completar la consolidación que representa el camino vigente.

## Corte focal

Cuando la lectura validada de consolidación confirma uno o más grupos preparados, Topics conserva el análisis anterior como historial legible, con sus resultados y recibos, pero oculta sus acciones de iniciar, reintentar o autorizar interpretación. La revisión editorial y el censo completo permanecen arriba. Una marca sin grupos preparados conserva el control de análisis inicial; si la lectura de consolidación falla, la acción pagada permanece oculta hasta recuperar el estado. Si hay un permiso anterior activo, sigue disponible la acción de detener envíos y recuperar solicitudes pendientes. No cambia backend, SQL, catálogo, Signal, ni importación.

Typecheck Studio, lint focal, parseo de ambos idiomas y diff-check pasaron. Corte `611d8e7` enviado a la rama UAT; despliegue Studio `5122d66b-ba24-44e7-b952-b57e034aa826` Active con healthcheck aprobado. No hubo despliegue Worker ni SQL.

La interfaz real de Alexa+ muestra «Análisis anterior», conserva 2/42 lotes de revisión, 1,652 dossiers y los 36 Topics parciales, y ya no ofrece «Autorizar y continuar» en el camino antiguo. Signal conserva el Topic seleccionado con 67 menciones y advierte «interpretación parcial»; no se alteraron selección ni asociaciones. El editor consolidado y SQL0185 siguen cerrados. Falta un catálogo consolidado real para probar edición y selección del resultado final; la política de pago vencida impide reanudar los 40 lotes pendientes sin un nuevo tope y vencimiento explícitos.
