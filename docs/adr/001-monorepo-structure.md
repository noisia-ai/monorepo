# ADR-001: Monorepo con Turborepo + pnpm workspaces

## Status
Accepted (2026-05-20)

## Context
Necesitamos alojar el website publico actual, Noisia Studio, workers backend y packages compartidos. El paquete de producto firma Turborepo + pnpm como estructura base.

## Decision
Usar un monorepo con Turborepo + pnpm workspaces.

## Rationale
- El KB se reusa entre website y studio.
- TypeScript types compartidos eliminan duplicacion.
- pnpm workspaces ya estaba en uso.
- Turborepo es suficiente para el tamano inicial.
- Railway puede desplegar subdirectorios.

## Consequences
+ Single source of truth para tipos y KB.
+ Refactors cross-package en un solo PR.
+ CI puede paralelizar builds.
- Setup inicial mas complejo que single app.
- Requiere disciplina de dependencias entre packages.
