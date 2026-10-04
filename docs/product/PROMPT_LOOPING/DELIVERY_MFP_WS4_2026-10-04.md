# WS4 · Evaluador offline preparado · 2026-10-04

**Entrega de código; evaluación humana pendiente (`no_evaluado`).**

- `scripts/eval/facets-report.ts` genera Markdown agregado sin corpus/IDs privados;
  valida huella de selección, gold humano y split fijo. No consulta DB/proveedores,
  no reestratifica ni cambia aprobación de etiquetadores.
- Pruebas A/B separadas, matrices/F1, entidades micro/macro y comparaciones,
  kind/prominencia, relevancia, pertenencia/Wilson, fiabilidad/ECE, acuerdo sin gold,
  costes conocidos/reservados/inciertos y tiempo de pared. No convierte falta de
  respuesta en negativa. Test JEV requiere umbrales declarados fijados en dev.
- CI añade tests focales y TypeScript de `scripts/eval` sin retirar checks.

Verificación local ligera: `node --test --import tsx scripts/eval/*.test.mjs`
**14 PASS** (matemáticas independientes, falta de gold, split, errores, invariancia
al modificar test en reporte dev, privacidad y huella de selección).
`tsc --project scripts/eval/tsconfig.json`: **PASS**, usando runtime/dependencias
existentes sin instalar servicios. Suites completas/typecheck/lint: **pendientes
CI remoto al abrir PR**; no ejecutadas en la Mac.

Demostración sintética del CLI: estado `no_evaluado`, no aprobación, creación
exclusiva del recibo. No se ejecutó evaluación sobre corpus privado ni se inventó
gold. El reporte versionado documenta el estado pendiente y regla preregistrada.

Coste: **USD0 proveedor**, sin DB ni recursos remotos nuevos. Fuera del corte:
anotaciones/conceptos del fundador, pruebas A/B reales, calibración y aceptación
semántica, selección aprobada, UI/UAT. Root integra tras revisión y CI.
