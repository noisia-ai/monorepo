# Evidence Traceability

> **Cada hallazgo en un entregable Noisia tiene que apuntar a evidencia en el corpus.**
> Si no se puede trazar de vuelta a una pieza con URL de fuente, no es hallazgo Noisia.

## Por qué la trazabilidad importa

1. **Defensibilidad.** El cliente puede usar el output en presentaciones internas o externas y citar la fuente. Sin trazabilidad, el output es opinión informada — no inteligencia trazable.
2. **Auditabilidad.** Si en 6 meses alguien cuestiona un hallazgo, el corpus codificado permite re-leer la evidencia original.
3. **Filtro contra el sesgo del analista.** Forzar que cada conclusión apunte a evidencia limita la tentación de "yo sé que es así".
4. **Enseñanza.** Cuando un nuevo analista entra, los hallazgos trazados son su biblioteca de criterio.

Sin trazabilidad, Noisia no es Noisia. Es consultora de opinión.

## La cadena de trazabilidad

Cada entregable Noisia mantiene una cadena de 4 niveles:

```
Hallazgo (en el deck / brief)
    ↓ apunta a
Tag de codificación (en el corpus codificado)
    ↓ se aplica a
Pieza de evidencia (texto + metadata)
    ↓ se origina en
URL de fuente original (post, review, comentario)
```

## Lo que entrega el cliente al cierre

Cada proyecto Noisia entrega un paquete con 4 archivos:

### 1. Entregable principal (PDF / deck / Notion)
Brief estratégico con hallazgos. Cada hallazgo lleva nota al pie con ID de evidencia: `[ID-T-PSI-01: 312 piezas, ej. r/skincare/post123]`.

### 2. Corpus crudo (CSV / JSON)
Las piezas originales con metadata: id, source, author_id, timestamp, text, language, url.

### 3. Corpus codificado (CSV / JSON)
Las mismas piezas con tags de la(s) metodología(s) aplicada(s):
- Tags de la tipología (ej. layer + trigger/barrier para T&B).
- Score de intensidad.
- Confianza por pieza.
- Notas del codificador.

### 4. AI-Brief (JSON estructurado)
Resumen ejecutable por una IA del cliente. Incluye:
- Pregunta de negocio.
- Metodología aplicada.
- Hallazgos jerarquizados con IDs.
- Citas representativas con URL.
- Limitaciones.

Esto permite al cliente alimentar a su propia IA o a su próxima agencia con el contexto completo, sin depender de Noisia para futuras consultas.

## Reglas de citado

### En el entregable principal

- **Cada hallazgo importante** lleva al menos una cita literal del corpus.
- **Citas literales** se transcriben exactamente, sin "limpiar" gramática del usuario original (la imperfección es información — sin tono editorial).
- **Citas se anonimizan** removiendo handle del autor (excepto si el autor es figura pública relevante para Influence Architecture).
- **Cada cita lleva metadata mínima:** plataforma, fecha aproximada, comunidad. Ej. "(Reddit r/skincareaddiction_es, marzo 2026)".

### En el corpus codificado

- **Cada pieza mantiene su URL original.** Si la URL muere (post borrado, plataforma caída), se mantiene en el corpus pero se etiqueta como "URL no recuperable" sin eliminar la pieza.
- **Si una pieza fue editada** después de la ingesta, se mantiene la versión capturada con timestamp de captura.
- **Si la fuente fue eliminada por el usuario** después de captura, la pieza permanece en el corpus codificado interno pero **no se cita públicamente** en el entregable. Se respeta la decisión del autor.

## Cómo se reporta confianza por hallazgo

Cada hallazgo lleva uno de tres niveles:

- **Alta** → `≥50 piezas, ≥3 fuentes distintas, replica entre comunidades`.
- **Media** → `15-50 piezas, 2 fuentes`.
- **Baja / direccional** → `<15 piezas, 1 fuente o emergente`.

**Reportar baja confianza es valor, no debilidad.** Un hallazgo de "alta confianza, 12 piezas, 1 fuente" es deshonestidad metodológica.

## Lo que no se cita

- **Conversación privada.** DMs, threads cerrados, grupos privados a los que no había acceso público al momento de captura. Aunque sean datos potencialmente valiosos, no se citan ni se incluyen.
- **Información identificable de menores.** Plataformas con poblaciones predominantemente menores de edad requieren cuidados extra. Si se incluyen, anonimización refuerza.
- **Conversación dentro de procesos sensibles.** Foros de salud mental, grupos de adicciones, espacios de duelo — incluso si son públicos, manejar con cautela y con criterio caso a caso.

## Flujo de QA antes de entregar

Antes de que cualquier entregable salga, el lead del proyecto valida:

- [ ] Cada hallazgo del entregable tiene ID de evidencia asociado.
- [ ] El corpus codificado tiene los IDs referenciados.
- [ ] Las URLs de fuente fueron testeadas (al menos sample): ¿siguen vivas?
- [ ] Las citas literales coinciden exactamente con la pieza original.
- [ ] La anonimización está aplicada.
- [ ] No hay info personal identificable en el output público.
- [ ] El AI-Brief refleja el entregable principal sin contradicción.

Sin este checklist completo, el entregable no se firma.

## Trazabilidad como propiedad del cliente

Al cierre del proyecto, **toda la cadena de trazabilidad es del cliente**:

- El cliente puede reutilizar el corpus en futuros proyectos (con o sin Noisia).
- El cliente puede compartir el AI-Brief con otras agencias o equipos internos.
- El cliente puede solicitar que Noisia destruya su copia interna del corpus si el NDA lo pide (típicamente no se hace — Noisia retiene anonimizado para mejorar la práctica, pero el contrato puede pedirlo).

Esto es deliberado y diferenciador. **Noisia no se queda con el activo de evidencia.** Eso obliga a que el valor entregado esté en la inteligencia, no en la captura del corpus.

## Cuándo la trazabilidad falla

Casos en que la trazabilidad se rompe y cómo manejar:

| Problema                                                | Manejo                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| URL del post murió post-ingesta.                        | Se mantiene la pieza con timestamp de captura; cita pública sin URL viva.           |
| Una pieza fue mal-codificada (descubierto post-entrega). | Issue documentado; se ofrece corrección al cliente sin costo. Se actualiza el playbook si revela un patrón. |
| Plataforma cambió API y rompe lectura inversa.          | Migración del corpus a formato independiente; documentación del cambio.             |
| Conflicto entre dos hallazgos basados en evidencia divergente. | No se "promedia" — se reporta la divergencia como hallazgo en sí. Eso es lo que la metodología revela.    |

## Versionado del corpus codificado

Si después de la entrega un criterio de codificación cambia (típicamente porque un proyecto posterior reveló que el criterio era ambiguo), el corpus original NO se re-codifica retroactivamente. Razones:

1. El cliente recibió un entregable basado en la codificación vigente al momento.
2. Re-codificar retroactivamente rompe trazabilidad histórica.
3. El cambio de criterio se aplica a proyectos nuevos.

Si el cliente solicita re-análisis con criterios actualizados, es un proyecto nuevo, no una corrección.

## Referencias

- Principios: `00-overview/principles.md` → P5, P9.
- Construcción del corpus: `03-process/corpus-construction.md`.
- Formato del entregable: `03-process/delivery-format.md`.
