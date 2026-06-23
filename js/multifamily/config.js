// ============================================================
// CONFIG Multifamily
// Para agregar un nuevo visor: duplicar este archivo y
// adaptar COLUMN_MAP, FILTERS, KPIS, PROYECTOS_METRICS,
// SVP, DISTRIB_COLS, MAP y COMPARATIVA.
// ============================================================

// Datasets pre-cargados (data/multifamily/*.json) seleccionables desde el
// dropzone, sin tener que arrastrar el Excel cada vez. Para agregar uno:
// 1. Cargar el Excel normalmente y usar el botón "Guardar JSON".
// 2. Mover el archivo descargado a data/multifamily/.
// 3. Agregar una entrada acá con su label y el path del archivo.
export const SAVED_DATASETS = [
  { label: 'Multifamily', file: 'data/multifamily/multifamily.json' },
];

export const COLUMN_MAP = {
  'Proyecto':              'Proyecto',
  'Propietario':           'Propietario',
  'Administrador':         'Administrador',
  'Comuna':                'Comuna',
  'Período':               'Período',
  'Vacancia Edificio (%)': 'Vacancia (%)',
  'Programa':              'Programa',
  'Stock':                 'Stock',
  'Disponibilidad':        'Disponibilidad',
  'm² Útil':               'Útil (m²)',
  'Arriendo UF':           'Arriendo UF',
  'Arriendo UF/m²':        'UF/m²',
  'Estado':                'Estado',
  'Ocupación':             'Ocupación (%)',
  'Reporta':               'Reporta',
  'Latitud':               '__lat',
  'Longitud':              '__lng',
};

// ── Filtros ────────────────────────────────────────────────────────────────
export const FILTERS = [
  { key: 'programa',      candidates: ['programa'],            label: 'Programa',       type: 'multi' },
  { key: 'estado',        candidates: ['estado'],              label: 'Estado',         type: 'multi' },
  { key: 'propietario',   candidates: ['propietario'],         label: 'Propietario',    type: 'multi' },
  { key: 'administrador', candidates: ['administrador'],       label: 'Administrador',  type: 'multi' },
  { key: 'comuna',        candidates: ['comuna'],              label: 'Comuna',         type: 'multi' },
  { key: 'vacancia',      candidates: ['vacancia'],            label: 'Vacancia (%)',   type: 'slider', step: 0.1 },
  { key: 'arriendo',      candidates: ['arriendo uf', 'arriendo'], label: 'Arriendo UF', type: 'slider', step: 1 },
  { key: 'ufm2',          candidates: ['uf/m', 'uf / m'],     label: 'UF/m²',          type: 'slider', step: 0.01 },
  { key: 'stock',         candidates: ['stock'],               label: 'Stock',          type: 'slider', step: 1 },
  { key: 'sup',           candidates: ['util (m', 'útil (m', 'm² util'], label: 'm² útil', type: 'slider', step: 1 },
  { key: 'reporta',       candidates: ['reporta'],             label: 'Reporta',        type: 'multi' },
  { key: 'ocupacion',     candidates: ['ocupacion'],           label: 'Ocupación (%)', type: 'slider', step: 1 },
  { key: 'rating',        candidates: ['rating'],              label: 'Rating Google',  type: 'slider', step: 0.1 },
];

// ── KPIs ───────────────────────────────────────────────────────────────────
export const KPIS = [
  { label: 'Proyectos',         col: 'Proyecto',     agg: 'countUnique', fmt: 'int' },
  { label: 'Stock total',       col: 'Stock',        agg: 'sum',         fmt: 'int' },
  { label: 'Disponibilidad',    col: 'Disponibilidad', agg: 'sum',       fmt: 'int' },
  { label: 'Vacancia prom.',    col: 'Vacancia (%)', agg: 'avg',         fmt: 'pct', sub: '%' },
  { label: 'Arriendo UF prom.', col: 'Arriendo UF',  agg: 'avg',        fmt: 'uf1', sub: 'UF/mes' },
  { label: 'UF/m² prom.',       col: 'UF/m²',        agg: 'avg',        fmt: 'uf2' },
  { label: 'Rating Google prom.', col: 'Rating',     agg: 'avg',        fmt: 'uf2' },
];

// ── Gráfico Proyectos ──────────────────────────────────────────────────────
export const PROYECTOS_METRICS = [
  {
    id: 'vacancia',  label: 'Vacancia (%)',        col: 'Vacancia (%)',
    agg: 'avg',  fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%',
  },
  {
    id: 'arriendo',  label: 'Arriendo UF prom.',   col: 'Arriendo UF',
    agg: 'avg',  fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  {
    id: 'ufm2',      label: 'UF/m²',               col: 'UF/m²',
    agg: 'avg',  fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'stock',     label: 'Stock',               col: 'Stock',
    agg: 'avg',  fmt: v => String(Math.round(v)),
  },
  {
    id: 'disponib',  label: 'Disponibilidad',      col: 'Disponibilidad',
    agg: 'avg',  fmt: v => String(Math.round(v)),
  },
];

// ── Sup. vs Arriendo (SVP) ─────────────────────────────────────────────────
export const SVP = {
  xOptions: [
    {
      value:       'util',
      label:       'Útil (m²)',
      candidates:  ['util (m', 'útil (m', 'm² util'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
    },
    {
      value:       'arriendo',
      label:       'Arriendo UF',
      candidates:  ['arriendo uf', 'arriendo'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
    },
    {
      value:       'ufm2',
      label:       'UF/m²',
      candidates:  ['uf/m', 'uf / m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'vacancia',
      label:       'Vacancia (%)',
      candidates:  ['vacancia'],
      formatValue: v => `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
    },
    {
      value:       'ocupacion',
      label:       'Ocupación (%)',
      candidates:  ['ocupacion'],
      formatValue: v => `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
    },
    {
      value:       'stock',
      label:       'Stock',
      candidates:  ['stock'],
      formatValue: v => v.toLocaleString('es-CL'),
    },
    {
      value:       'disponib',
      label:       'Disponibilidad',
      candidates:  ['disponibilidad'],
      formatValue: v => v.toLocaleString('es-CL'),
    },
    {
      value:       'rating',
      label:       'Rating Google',
      candidates:  ['rating'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ★`,
    },
  ],
  yOptions: [
    {
      value:       'arriendo',
      label:       'Arriendo UF',
      candidates:  ['arriendo uf', 'arriendo'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
    },
    {
      value:       'ufm2',
      label:       'UF/m²',
      candidates:  ['uf/m', 'uf / m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'vacancia',
      label:       'Vacancia (%)',
      candidates:  ['vacancia'],
      formatValue: v => `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
    },
    {
      value:       'ocupacion',
      label:       'Ocupación (%)',
      candidates:  ['ocupacion'],
      formatValue: v => `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`,
    },
    {
      value:       'stock',
      label:       'Stock',
      candidates:  ['stock'],
      formatValue: v => v.toLocaleString('es-CL'),
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL')}`,
    },
    {
      value:       'disponib',
      label:       'Disponibilidad',
      candidates:  ['disponibilidad'],
      formatValue: v => v.toLocaleString('es-CL'),
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL')}`,
    },
    {
      value:       'rating',
      label:       'Rating Google',
      candidates:  ['rating'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ★`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ★`,
    },
  ],
  // No group column for multifamily (building-level, no tipología)
  groupCandidates: [],
  projCandidates:  ['proyecto', 'edificio', 'nombre'],
  // Cuadrito de resumen dentro del gráfico
  summaryFields: [
    { label: 'Proyectos',         candidates: ['proyecto', 'edificio', 'nombre'], agg: 'countUnique' },
    { label: 'Stock',             candidates: ['stock'],          agg: 'sum',
      fmt: v => v.toLocaleString('es-CL') },
    { label: 'UF/m² prom.',       candidates: ['uf/m', 'uf / m'], agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { label: 'Arriendo UF prom.', candidates: ['arriendo uf', 'arriendo'], agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  ],
};

// ── Gráfico de Cruz (Sup. vs UF/m², color/forma/tamaño/reporte) ─────────────
export const CRUZ = {
  xCandidates:       ['util (m', 'útil (m', 'm² util'],
  xLabel:            'Útil (m²)',
  yCandidates:       ['uf/m', 'uf / m'],
  yLabel:            'UF/m²',
  colorCandidates:   ['administrador'],
  colorLabel:        'Operador',
  shapeCandidates:   ['programa'],
  shapeLabel:        'Tipología',
  sizeCandidates:    ['ocupacion'],
  reportaCandidates: ['reporta'],
  stockCandidates:   ['stock'],
  dispoCandidates:   ['disponibilidad'],
  projCandidates:    ['proyecto', 'edificio', 'nombre'],
};

// ── Distribución ───────────────────────────────────────────────────────────
export const DISTRIB_COLS = [
  { col: 'Arriendo UF',  label: 'Arriendo UF' },
  { col: 'UF/m²',        label: 'UF/m²' },
  { col: 'Vacancia (%)', label: 'Vacancia (%)' },
  { col: 'Útil (m²)',    label: 'm² útil' },
  { col: 'Stock',        label: 'Stock' },
];

// ── Mapa ───────────────────────────────────────────────────────────────────
export const MAP = {
  projectCandidates: ['proyecto', 'edificio', 'nombre', 'building'],
  heatOptions: [
    { value: 'ufm2',     label: 'UF/m²',        candidates: ['uf/m', 'uf / m'] },
    { value: 'arriendo', label: 'Arriendo UF',   candidates: ['arriendo uf', 'arriendo'] },
    { value: 'vacancia', label: 'Vacancia (%)',   candidates: ['vacancia'] },
  ],
  popupFields: [
    { label: 'Proyecto',      keys: ['proyecto', 'nombre'] },
    { label: 'Propietario',   keys: ['propietario'] },
    { label: 'Administrador', keys: ['administrador'] },
    { label: 'Programa',      keys: ['programa'] },
    { label: 'Estado',        keys: ['estado'] },
    { label: 'Período',       keys: ['período', 'periodo'] },
    { label: 'Stock',         keys: ['stock'], agg: 'sum' },
    { label: 'Disponib.',     keys: ['disponibilidad'], agg: 'sum' },
    { label: 'Vacancia (%)',  keys: ['vacancia'] },
    { label: 'Arriendo UF',   keys: ['arriendo uf', 'arriendo'] },
    { label: 'UF/m²',         keys: ['uf/m', 'uf / m'], agg: 'avg' },
  ],
};

// ── Tabla Comparativa ──────────────────────────────────────────────────────
export const COMPARATIVA = {
  projectCandidates: ['proyecto', 'edificio', 'nombre'],
  // No groupByCandidates → flat mode (no tipología matrix)
  infoColumns: [
    { label: 'Propietario',   candidates: ['propietario'] },
    { label: 'Administrador', candidates: ['administrador'] },
    { label: 'Estado',        candidates: ['estado'] },
  ],
  metricColumns: [
    { label: 'Stock',       candidates: ['stock'],         fmt: 'int' },
    { label: 'Disponib.',   candidates: ['disponibilidad'], fmt: 'int' },
    { label: 'Vacancia %',  candidates: ['vacancia'],      fmt: 'pct' },
    { label: 'Arriendo UF', candidates: ['arriendo uf', 'arriendo'], fmt: 'uf1' },
    { label: 'UF/m²',       candidates: ['uf/m', 'uf / m'], fmt: 'uf2' },
    { label: 'Rating',      candidates: ['rating'],         fmt: 'uf2' },
    { label: 'Reseñas',     candidates: ['resenas total', 'reseñas total'], fmt: 'int' },
  ],
};

export const CSV_FILENAME = 'multifamily';
