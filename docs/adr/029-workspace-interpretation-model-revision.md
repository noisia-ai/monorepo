# ADR 029 — Continuar interpretación con Sonnet sin repetir el cómputo

Estado: aceptado; implementación local, despliegue pendiente. 9 septiembre UTC / 8 septiembre México de 2026.

El operador eligió Sonnet 4.6 y excluyó nuevas llamadas con Opus, incluido Advisor. La ejecución existente conserva el cómputo completo y cuatro interpretaciones válidas; la segunda reparación editorial terminó con citas inválidas. Cambiar el modelo debe conservar ese trabajo y su contabilidad.

Decisión: Sonnet 4.6 es el perfil predeterminado de nuevas interpretaciones. Los perfiles históricos permanecen exactos para verificar respuestas, artefactos y costos. El adaptador rechaza todo nuevo envío Opus antes del registro de envío y del acceso al proveedor.

Una revisión editorial explícita, sellada y única puede continuar la misma ejecución fallida con Sonnet. Conserva snapshot, fit, grupos, actor, permisos, topes y todas las reservas previas. Se admite sólo con respuestas conciliadas o terminales externos comprobados; una respuesta incierta bloquea. La reserva terminal continúa contando. SQL0143 registra esa revisión y asocia los nuevos recibos; no abre una ejecución alternativa ni reescribe el modelo de recibos antiguos.

Antes de pedir interpretaciones, el Worker recupera las unidades ya cerradas, verifica sus objetos privados, SHA, contexto, grupos y citas, y omite sólo esas unidades. El materializador acepta evidencia de ambos perfiles contra la configuración que autorizó cada llamada. Sigue exigiendo cobertura completa; publicación parcial con excepciones es trabajo posterior.

Sonnet recibe referencias cortas por grupo, por ejemplo r1. El sistema las resuelve exclusivamente contra el texto del mismo grupo y guarda las referencias originales verificables. El JSON bruto queda intacto. No hay reparación por semejanza, citas inventadas ni aceptación de respuestas incompletas.

Consecuencias: no se repiten embeddings ni fit, no se vuelve a pagar por cuatro interpretaciones válidas y no cambia la selección individual para Signal. La transición no prorroga el permiso de gasto: la autorización actual vence el 9 septiembre a las 06:00 UTC. El modelo tampoco convierte coherencia temática en relevancia para la marca. La recuperación administrativa y la renovación de permisos fechados aún requieren trabajo para el producto self-service.
