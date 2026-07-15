# Visor de Mercado Inmobiliario — Guía para Claude

## Qué es este proyecto

Aplicación web estática (HTML + JS modules + CSS) para visualizar datos de mercado inmobiliario. Carga archivos Excel y muestra mapas, gráficos y tablas comparativas. Sin servidor, sin build step, sin npm.

Los datos vienen de dos fuentes: **Inciti** y **GFK**. Cada visor tiene su propio parser.

## Estructura de archivos

```
index.html          ← Visor Venta Residencial
renta.html          ← Visor Renta Residencial
multifamily.html    ← Visor Multifamily
styles.css          ← Importa styles/base.css, layout.css, components.css
styles/
  base.css
  layout.css
  components.css
js/
  core/             ← Módulos compartidos (NO tocar sin entender impacto)
    utils.js        ← $, $$, fmt, norm, findCol, debounce, detectColType
    export.js       ← exportCsv, copyChartPng, copyTableHtml
    filters.js      ← Motor de filtros genérico (multi + slider)
    table.js        ← Tabla paginada con sort
    kpis.js         ← Renderizado de KPIs
    chart-proyectos.js  ← Gráfico de barras por proyecto
    chart-svp.js    ← Scatter Sup vs Precio/Renta con tendencia
    chart-distrib.js ← Curva de distribución acumulada (CDF)
    map.js          ← Mapa Leaflet con modo calor y ranking
    comparativa.js  ← Tabla comparativa (flat o con grupos tipología)
  multifamily/      ← Visor Multifamily (usa core/)
    config.js       ← TODA la config específica de este visor
    data.js         ← Carga Excel + normalización de columnas
    miProyecto.js   ← Panel "Mi Proyecto" del sidebar
    main.js         ← Tabs, reset, exports, listeners
  renta/            ← Visor Renta Residencial (módulos propios, NO usa core/)
    data.js, filters.js, chart.js, map.js, comparativa.js, table.js, miProyecto.js, main.js, utils.js
  js/               ← Visor Venta Residencial (módulos propios, NO usa core/)
    data.js, filters.js, chart.js, map.js, comparativa.js, table.js, miProyecto.js, main.js, utils.js
```

> **Importante:** `js/renta/` y `js/` (venta) son módulos independientes que NO importan de `js/core/`. Funcionan solos. No modificarlos para arreglar algo en core/ — son sistemas separados.

## Cómo crear un visor nuevo

### Paso 1 — Definir el config.js

Este es el único archivo que describe completamente el visor. Copiar `js/multifamily/config.js` como base y adaptar:

```js
// js/oficinas/config.js

export const COLUMN_MAP = {
  'Nombre Excel':  'Nombre Interno',  // mapeo fuente → nombre interno
  'Latitud':       '__lat',           // coordenadas siempre con __ prefix
  'Longitud':      '__lng',
};

export const FILTERS = [
  { key: 'clase',  candidates: ['clase', 'categoría'], label: 'Clase',    type: 'multi' },
  { key: 'precio', candidates: ['precio uf', 'renta'],  label: 'Precio UF', type: 'slider', step: 1 },
  // type: 'multi' → checkbox list
  // type: 'slider' → dual slider con inputs editables
  // candidates: array de strings que se buscan (parcial, sin tildes) en los nombres de columna del Excel
];

export const KPIS = [
  { label: 'Proyectos',  col: 'Proyecto',  agg: 'countUnique', fmt: 'int' },
  { label: 'Precio prom', col: 'Precio UF', agg: 'avg',         fmt: 'uf1', sub: 'UF/mes' },
  // agg: 'avg' | 'sum' | 'count' | 'countUnique'
  // fmt: 'int' | 'pct' | 'uf1' (1 decimal) | 'uf2' (2 decimales)
];

export const PROYECTOS_METRICS = [
  { id: 'precio', label: 'Precio UF prom.', col: 'Precio UF', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
];

export const SVP = {
  xCandidates:    ['util (m', 'útil (m'],   // columna eje X
  xLabel:         'Útil (m²)',
  yOptions: [
    { value: 'precio', label: 'Precio UF', candidates: ['precio uf'],
      formatValue: v => `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF` },
  ],
  groupCandidates: ['tipología'],  // columna de grupos (vacío [] si no hay)
  projCandidates:  ['proyecto', 'edificio', 'nombre'],
};

export const DISTRIB_COLS = [
  { col: 'Precio UF', label: 'Precio UF' },
  { col: 'UF/m²',     label: 'UF/m²' },
];

export const MAP = {
  projectCandidates: ['proyecto', 'edificio', 'nombre'],
  heatOptions: [
    { value: 'ufm2', label: 'UF/m²', candidates: ['uf/m'] },
  ],
  popupFields: [
    { label: 'Proyecto', keys: ['proyecto'] },
    { label: 'UF/m²',    keys: ['uf/m'] },
  ],
};

export const COMPARATIVA = {
  projectCandidates: ['proyecto'],
  // groupByCandidates: ['tipología']  ← agregar si hay grupos (activa modo matrix)
  infoColumns: [
    { label: 'Corredor', candidates: ['corredor', 'propietario'] },
  ],
  metricColumns: [
    { label: 'Precio UF', candidates: ['precio uf'], fmt: 'uf1' },
    { label: 'UF/m²',     candidates: ['uf/m'],      fmt: 'uf2' },
  ],
};

export const CSV_FILENAME = 'oficinas';
```

### Paso 2 — Crear data.js

Copiar `js/multifamily/data.js` y adaptar solo:
- `STORAGE_KEY` (línea 1): cambiar a nombre único, ej: `'visor_mp_of_v1'`
- La función `_normalizeRows`: agregar lógica especial si los datos necesitan transformación (ej: derivar tipología de varias columnas)
- El filtro de filas válidas (`.filter(r => ...)`)

El resto del archivo es idéntico para todos los visores.

### Paso 3 — Crear miProyecto.js

Copiar `js/multifamily/miProyecto.js` y adaptar:
- `STORAGE_KEY`: nombre único
- El objeto `mp`: agregar/quitar campos de métricas según el visor
- Las llamadas `numInput(...)` para los campos nuevos
- Los campos `set(...)` en `initMpPanel` para restaurar valores guardados

### Paso 4 — Crear main.js

Copiar `js/multifamily/main.js` **sin cambios**. Solo actualizar los imports del config en las 2 primeras líneas si cambia el path.

### Paso 5 — Crear el HTML

Copiar `multifamily.html` y cambiar:
1. `<title>` — nombre del visor
2. `<h1>` — nombre del visor
3. `<nav>` — agregar el nuevo link y marcar `active` el correcto
4. `<p id="dropzoneHint">` — instrucciones de carga
5. Los `<option>` del `<select id="proyMetrica">` — métricas del visor
6. Los botones `<button class="heat-metric-btn">` — métricas del mapa de calor
7. El `<script type="module" src="...">` — apuntar a `js/oficinas/main.js`

### Paso 6 — Agregar al nav

En `index.html`, `renta.html`, `multifamily.html` y el nuevo HTML, agregar el link en el `<nav class="app-nav">`.

---

## Cómo modificar un visor existente (multifamily u otros futuros)

### Agregar un filtro nuevo
En `js/[visor]/config.js`, agregar una entrada al array `FILTERS`:
```js
{ key: 'piso', candidates: ['piso', 'floor'], label: 'Piso', type: 'multi' }
```
Nada más. El motor `js/core/filters.js` lo construye automáticamente si la columna existe en los datos.

### Agregar un KPI nuevo
En `js/[visor]/config.js`, agregar al array `KPIS`:
```js
{ label: 'Precio máx.', col: 'Precio UF', agg: 'max', fmt: 'uf1' }
```
Si el `agg` no existe en `js/core/kpis.js`, agregar el caso en el `switch`.

### Agregar una métrica al gráfico de proyectos
En `js/[visor]/config.js`, agregar al array `PROYECTOS_METRICS` y agregar el `<option>` correspondiente en el HTML.

### Agregar una opción al eje Y del SVP
En `js/[visor]/config.js`, agregar al array `SVP.yOptions`. El selector se genera automáticamente via `populateSvpSelectors`.

### Cambiar columnas de la tabla comparativa
En `js/[visor]/config.js`, modificar `COMPARATIVA.metricColumns` o `COMPARATIVA.infoColumns`.

---

## Cómo modificar los módulos core/

> Solo hacerlo si el cambio beneficia a **todos** los visores que usan core/. Si es específico de un visor, la solución va en `config.js` o en el módulo del visor.

Los módulos core reciben su configuración como parámetro — nunca tienen lógica hardcodeada de un visor específico. El patrón es siempre:
```js
renderAlgo(state, config, mp)
```

Donde:
- `state` — estado del visor (raw, filtered, columns, etc.)
- `config` — sección del config.js del visor
- `mp` — estado del panel Mi Proyecto (puede ser null)

---

## Notas importantes

### Los visores Venta y Renta NO usan core/
`js/` y `js/renta/` tienen sus propios módulos independientes. Para modificar esos visores, editar sus archivos directamente. Para migrarlos a core/ en el futuro, el patrón es el mismo que multifamily.

### Column candidates (búsqueda de columnas)
Los `candidates` en filtros, SVP, mapa, etc. son strings que se buscan de forma parcial y sin tildes en los nombres de columna del Excel. Por ejemplo, `'uf/m'` matchea `'Arriendo UF/m²'`, `'Precio UF/m2'`, etc.

### Coordenadas
Si el Excel tiene columnas `Latitud`/`Longitud`, mapearlas en `COLUMN_MAP` a `'__lat'`/`'__lng'`. El mapa las usa directamente sin geocodificar.

### Mi Proyecto para visores con tipología
Si el visor tiene tipologías (como Renta Residencial), `miProyecto.js` debe incluir el array `tipologias: []` con cards. Ver `js/renta/miProyecto.js` como referencia. La comparativa en `COMPARATIVA` debe incluir `groupByCandidates`.

### Mi Proyecto para visores flat
Si el visor es a nivel de edificio/proyecto (como Multifamily), `miProyecto.js` tiene métricas simples sin array de tipologías. Ver `js/multifamily/miProyecto.js`.

---

## Dependencias externas (CDN, sin instalación)

| Librería | Versión | Uso |
|---|---|---|
| XLSX.js | 0.18.5 | Leer archivos Excel |
| Chart.js | 4.4.1 | Todos los gráficos |
| chartjs-plugin-annotation | 3.0.1 | Líneas de referencia en gráficos |
| Leaflet | 1.9.4 | Mapas interactivos |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
