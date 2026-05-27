# ADR-004: Compatibilidad TypeScript del website durante migracion

## Status
Accepted (2026-05-23)

## Context
El `tsconfig.base.json` del monorepo activa `noUncheckedIndexedAccess` para los paquetes nuevos de Studio. Al extender esa base desde el website existente, aparecieron decenas de errores por accesos a arrays/objetos que antes compilaban.

## Decision
Mantener `noUncheckedIndexedAccess: false` solo en `apps/website/tsconfig.json` para preservar el comportamiento del website durante F1.1.

## Rationale
- La meta de F1.1 es mover el website sin cambios visuales ni refactor funcional.
- Corregir todos los accesos existentes mezclaria una migracion de estructura con refactor de producto.
- Los paquetes nuevos si conservan la regla estricta.

## Consequences
+ El website puede seguir compilando como antes.
+ Studio y packages nuevos arrancan con TypeScript mas estricto.
- Queda deuda tecnica en el website.

// TODO mejora-futura: habilitar `noUncheckedIndexedAccess` en `apps/website`
// cuando se haga una pasada dedicada de hardening TypeScript.
