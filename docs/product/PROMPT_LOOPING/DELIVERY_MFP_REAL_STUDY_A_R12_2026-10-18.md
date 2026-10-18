# Estudio real A (cerveza, Brasil) — corte parcial para revisión 12

18 de octubre de 2026 · Agente configurado `mfp_estandar`, `gpt-6.1-sol / medium`.

**Resultado comprobado.** La marca se creó por UI y el corpus conserva alcance global, sin filtro por país. Los 11 archivos y sus SHA coinciden con los originales: 113,338 filas, 96,150 raíces únicas, 96,149 con texto. La preparación gratuita terminó con 83,962 elegibles, 12,188 excluidas y 127,122 fragmentos. La recuperación por UI cerró 480 raíces sin procedencia sin cambiar IDs, hashes ni inclusión. El último archivo añadió 253 raíces y dejó cero huérfanas.

**Autoridad y configuración.** La acción interna por UI completó la política clásica: ocho acciones preservadas exactamente más las dos ausentes; misma zona, vencimiento y límites existentes. MFP permanece apagado. La migración 0269 se aplicó una vez: seis funciones y cuatro constraints verificados; RLS/ACL y 18 censos de filas intactos. Studio y Runner quedaron fijados en `80cf9077`, con CI/PostgreSQL verdes; no UAT ni producción.

**Comparación preparada, pendiente de ejecución.** El anexo privado conserva taxonomía inducida y reglas congeladas v5.1, 22 etiquetas, validaciones generalmente de 25 casos y la reclasificación de 371 emisores. Dos reestimaciones reutilizan la muestra previa y no son holdout independiente. La matriz tiene 49 filas del estudio y todos los campos del producto vacíos. Los clusters todavía no se han calculado; por eso la comparación producto/estudio permanece pendiente. Todavía no hay Topics, Narrativas, Noise, cobertura ni temas compartidos/nuevos/perdidos que reportar.

**Costo y tiempo.** Consumo observado de proveedores: USD 0; compras: USD 0. No se ejecutaron fichas ni pertenencia. Del primer import a texto preparado transcurrieron 2 h 6 min, incluidas reparaciones y esperas; clustering y tiempo humano aún no medidos. La documentación del estudio fecha iteraciones en dos fechas consecutivas, sin acreditar horas humanas.

La cotización gratuita de vectores se repitió por UI con idéntica población y máximo estimado USD 33.232724; no creó ejecución. Es un límite estimado conservador, no consumo ni saldo. La preparación no se repitió: su botón desaparece al terminar.

**Bloqueos concretos.** La build fijada durante este corte aplicaba un máximo histórico de USD 5 por defecto de código, sin configuración explícita del operador. #69 lo corrigió en código y PostgreSQL; falta comprobar la build integrada por UI. Faltan lecturas actuales de saldo Voyage y Anthropic. No se ejecutará una etapa pagada hasta resolverlo. Las proyecciones del corte y corpus completo son escenarios con tarifas heredadas del estimador, no facturas actuales ni cotizaciones de UI.

Los nombres, rutas, textos, citas e identificadores originales quedan únicamente en el anexo privado. El siguiente corte será vectores → descubrimiento → consolidación editorial y la comparación pendiente, sin cambiar la ruta por defecto.
