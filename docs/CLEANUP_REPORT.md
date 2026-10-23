# Cleanup Report — `cleanup/auto-refactor`

Análisis y refactor autónomo del codebase. Todos los cambios están en commits atómicos en esta rama.

---

## Commits

| Hash | Descripción |
|---|---|
| `92648de` | refactor(venta): añadir `norm` y `fmtTipo` como exports de `js/utils.js` |
| `6e757f5` | refactor(venta/filters): eliminar `_buildRange` muerto y simplificar con imports |
| `8bd6fed` | refactor(venta/comparativa): eliminar `fmtTipo` local y simplificar `findCol` |
| `5f41549` | fix(venta/map): implementar `_captureMapCanvas` faltante y eliminar `norm` local |
| `8a0a883` | refactor(renta/main): eliminar comentario huérfano sin código asociado |
| `11e5c0b` | refactor(venta): eliminar pestaña genérica de gráfico removida del HTML (-205 líneas) |
| `1e70f30` | refactor(renta): extraer `norm` a utils y corregir imports cross-módulo |

---

## Cambios detallados

### 1. `js/utils.js` (Venta)
**Añadidas dos funciones compartidas:**
- `norm(s)` — normalización Unicode sin tildes (ya existía inline en 3+ módulos de venta)
- `fmtTipo(v)` — formatea `"2"` o `2` como `"2D"` (ya existía duplicada en filters.js y comparativa.js)

### 2. `js/filters.js` (Venta)
- `findCol()` simplificada: eliminada `const norm = s => ...` local (36 chars), ahora usa el import
- Eliminada función local `fmtTipo` (8 líneas), ahora usa el import
- **Eliminada función muerta `_buildRange`** (35 líneas): estaba definida pero nunca llamada desde `buildFilters()`. `buildFilters()` solo llama a `_buildMulti`, `_buildSupTipo`, `_buildSlider`, `_buildMinMax`, `_buildQuarters`. Cero call sites externos.

### 3. `js/comparativa.js` (Venta)
- `findCol()` simplificada: eliminada `const norm = s => ...` local
- Eliminada función local `fmtTipo` (6 líneas), ahora usa el import

### 4. `js/map.js` (Venta)
- Eliminada `function norm(s)` a nivel de módulo (4 líneas), ahora importada desde `./utils.js`
- **Corregido bug silencioso**: `_captureMapCanvas(scale)` era llamada en el handler del botón "Copiar imagen" (línea ~369) pero nunca estaba definida en el codebase. Causaba un `ReferenceError` silencioso atrapado por el `try/catch` circundante, haciendo que el botón no hiciera nada. Se añadió la implementación que captura los `<canvas>` internos de Leaflet. Limitación documentada: la capa SVG de marcadores no se captura (requeriría html2canvas externo).

### 5. `js/renta/main.js`
- Eliminado comentario huérfano `// ============== Copiar tabla comparativa ==============` que aparecía sin código debajo.

### 6. `js/chart.js` (Venta) — -205 líneas
**Eliminadas 5 funciones muertas:**
- `populateChartSelectors()` (export) — populaba selects `#chartX`, `#chartY`, `#chartGroup` que no existen en `index.html`
- `renderChart()` (export) — usaba `#mainChart`, `#chartType`, `#chartX`, `#chartY`, `#chartAgg`, `#chartGroup`, `#chartSort` — ninguno existe en `index.html`
- `aggregate(values, mode)` — solo usada por `renderChart()`
- `chartBaseOptions(opts)` — solo usada por `renderChart()`
- `sortEntries(entries, mode)` — solo usada por `renderChart()`

Estas funciones pertenecen a una pestaña genérica de "Gráfico" que fue eliminada de `index.html` en algún refactor anterior, pero el código JS no se limpió en ese momento. La constante `palette[]` (entre las dos secciones muertas) se preservó porque sí se usa en las funciones activas de Proyectos y SVP.

### 7. `js/renta/utils.js`
- Añadida `export const norm = s => ...` — versión centralizada con null guard (`String(s ?? '')`)

### 8. `js/renta/chart.js` (Renta) — -17 líneas netas
- Import actualizado para incluir `norm`
- Eliminadas 7 definiciones inline de `normStr`/`normFn` (todas idénticas a la nueva `norm` central)
- Renombradas todas las llamadas `normStr(...)` → `norm(...)` y `normFn(...)` → `norm(...)`

### 9. `js/renta/filters.js` (Renta)
- Corregido import: antes `import { $, debounce } from '../utils.js'` (módulo Venta), ahora `import { $, debounce, extractDormitorios, norm } from './utils.js'` (propio módulo Renta)
- Eliminada la definición local de `norm` dentro de `findCol()`
- **Nota**: importar desde `'../utils.js'` (Venta) violaba la independencia de módulos definida en CLAUDE.md

### 10. `js/renta/comparativa.js` (Renta)
- Corregido import: antes importaba `$` desde `'../utils.js'` (Venta), ahora todo desde `'./utils.js'` (Renta)
- Eliminada la definición local de `norm` dentro de `findCol()`

### 11. `js/renta/data.js` (Renta)
- Corregido import: antes `import { $, detectColType } from '../utils.js'` (Venta) con comentario `// Mantenemos tu ruta original`, ahora `import { $, detectColType } from './utils.js'`

### 12. `js/renta/map.js` (Renta)
- Import actualizado para incluir `norm`
- Eliminada `function norm(s)` a nivel de módulo (4 líneas)

---

## Hallazgos NO modificados (documentados aquí)

### Exportaciones sin consumidores externos (no eliminadas — conservador)

| Archivo | Export | Motivo de no eliminar |
|---|---|---|
| `js/core/utils.js` | `uniqueValues` | Nunca importada externamente; posible uso futuro |
| `js/renta/utils.js` | `uniqueValues` | Ídem |
| `js/utils.js` | `uniqueValues` | Ídem |
| `js/core/map.js` | `getLastPolygon()` | El comentario indica "usado por módulos de visor para consultar la API"; es parte de la integración planificada con `multifamily/api.js` |
| `js/core/chart-svp.js` | `svpMarkers` | Set usado internamente; el `export` parece legado |
| `js/multifamily/api.js` | `fetchMultifamily()` | Feature de integración con Inciti en desarrollo; no está conectada a la UI todavía |

### `fmtTipo` en `renta/chart.js`
Hay al menos 2 variantes de `fmtTipo` en `renta/chart.js` (líneas 670 y 1506), una con `.toUpperCase()` y otra sin. No se unificaron por posible diferencia semántica intencional en cada contexto.

### `_normStr` en `multifamily/estrellas.js`
Esta variante hace normalización más agresiva (elimina puntuación, colapsa espacios) para fuzzy matching de nombres de edificios. No es equivalente a `norm` estándar — se preservó tal cual.

### Módulos de Venta `js/` y Renta `js/renta/` (no migrados a core/)
Los dos visores Venta y Renta tienen módulos independientes que no usan `js/core/`. No se migró nada a `core/` — solo se limpió internamente según CLAUDE.md.

---

## Resumen de impacto

| Métrica | Valor |
|---|---|
| Archivos modificados | 12 |
| Líneas eliminadas (código muerto) | ~270 |
| Líneas añadidas (refactor limpio) | ~30 |
| Bugs corregidos | 1 (`_captureMapCanvas` indefinida) |
| Violaciones de CLAUDE.md corregidas | 3 (imports `../utils.js` en módulo Renta) |
| Commits atómicos | 7 |
