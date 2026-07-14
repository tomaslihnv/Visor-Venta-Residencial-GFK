export const COLUMN_MAP = {
  'Nombre':              'Nombre',
  'Propietario':         'Propietario',
  'Estado':              'Estado',
  'Dirección':           'Dirección',
  'Comuna':              'Comuna',
  'Región':              'Región',
  'Superficie (m²)':     'Superficie (m²)',
  'Área Total (m²)':     'Superficie (m²)',
  'Precio USD/m²':       'USD/m²',
  'Precio Final (USD)':  'Precio Final (USD)',
  'Precio UF/m²':        'UF/m²',
  'Lotes':               'Lotes',
  'Vacancia (%)':        'Vacancia (%)',
  'Latitud':             '__lat',
  'Longitud':            '__lng',
};

export const FILTERS = [
  { key: 'estado',   candidates: ['estado'],              label: 'Estado',       type: 'multi'  },
  { key: 'comuna',   candidates: ['comuna'],              label: 'Comuna',       type: 'multi'  },
  { key: 'usdm2',    candidates: ['usd/m'],               label: 'USD/m²',       type: 'slider', step: 0.01 },
  { key: 'ufm2',     candidates: ['uf/m'],                label: 'UF/m²',        type: 'slider', step: 0.01 },
  { key: 'sup',      candidates: ['superficie (m', 'área (m'], label: 'Superficie (m²)', type: 'slider', step: 100 },
  { key: 'vacancia', candidates: ['vacancia (%)'],        label: 'Vacancia %',   type: 'slider', step: 0.1  },
];

export const KPIS = [
  { label: 'Parques',          col: 'Nombre',           agg: 'count',  fmt: 'int' },
  { label: 'USD/m² prom.',     col: 'USD/m²',           agg: 'avg',    fmt: 'uf2' },
  { label: 'UF/m² prom.',      col: 'UF/m²',            agg: 'avg',    fmt: 'uf2' },
  { label: 'Vacancia prom.',   col: 'Vacancia (%)',     agg: 'avg',    fmt: 'pct' },
];

export const PROYECTOS_METRICS = [
  {
    id: 'usdm2', label: 'USD/m² prom.', col: 'USD/m²', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'ufm2', label: 'UF/m² prom.', col: 'UF/m²', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'vacancia', label: 'Vacancia % prom.', col: 'Vacancia (%)', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  },
  {
    id: 'sup', label: 'Superficie total (m²)', col: 'Superficie (m²)', agg: 'sum',
    fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 }),
  },
  {
    id: 'count', label: 'Parques', col: null, agg: 'count',
    fmt: v => String(Math.round(v)),
  },
];

export const SVP = {
  xOptions: [
    {
      value:       'sup',
      label:       'Superficie (m²)',
      candidates:  ['superficie (m', 'área (m'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
    },
  ],
  yOptions: [
    {
      value:       'usdm2',
      label:       'USD/m²',
      candidates:  ['usd/m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD/m²`,
    },
    {
      value:       'ufm2',
      label:       'UF/m²',
      candidates:  ['uf/m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'vacancia',
      label:       'Vacancia (%)',
      candidates:  ['vacancia (%)'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
    },
  ],
  groupCandidates: ['estado', 'comuna'],
  projCandidates:  ['nombre'],
  getMpY: (t, mode) => {
    if (mode === 'usdm2')    return null;
    if (mode === 'ufm2')     return t.ufm2 ?? null;
    if (mode === 'vacancia') return null;
    return null;
  },
  summaryFields: [
    { label: 'Parques',      candidates: ['nombre'],     agg: 'count' },
    { label: 'USD/m² prom.', candidates: ['usd/m'],      agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { label: 'Vacancia %',   candidates: ['vacancia (%)'], agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' },
  ],
};

export const DISTRIB_COLS = [
  { col: 'USD/m²',          label: 'USD/m²',           unit: 'USD/m²' },
  { col: 'UF/m²',           label: 'UF/m²',            unit: 'UF/m²'  },
  { col: 'Superficie (m²)', label: 'Superficie (m²)',  unit: 'm²'     },
  { col: 'Vacancia (%)',    label: 'Vacancia (%)',     unit: '%'      },
];

export const MAP = {
  projectCandidates: ['nombre'],
  heatOptions: [
    { value: 'usdm2',    label: 'USD/m²',        candidates: ['usd/m'] },
    { value: 'vacancia', label: 'Vacancia (%)',  candidates: ['vacancia (%)'] },
  ],
  popupFields: [
    { label: 'Nombre',          keys: ['nombre'] },
    { label: 'Estado',          keys: ['estado'] },
    { label: 'Comuna',          keys: ['comuna'] },
    { label: 'USD/m²',          keys: ['usd/m'] },
    { label: 'UF/m²',           keys: ['uf/m'] },
    { label: 'Superficie (m²)', keys: ['superficie', 'área'] },
    { label: 'Vacancia (%)',    keys: ['vacancia'] },
  ],
};

export const COMPARATIVA = {
  projectCandidates: ['comuna'],
  infoColumns: [],
  metricColumns: [
    { label: 'Parques',     candidates: ['nombre'],            fmt: 'int',  agg: 'count' },
    { label: 'USD/m²',      candidates: ['usd/m'],             fmt: 'uf2'  },
    { label: 'UF/m²',       candidates: ['uf/m'],              fmt: 'uf2'  },
    { label: 'Sup. total',  candidates: ['superficie (m', 'área (m'], fmt: 'int', agg: 'sum' },
    { label: 'Vacancia %', candidates: ['vacancia (%)'],       fmt: 'uf1'  },
  ],
};

export const CSV_FILENAME = 'parquesindustriales';
