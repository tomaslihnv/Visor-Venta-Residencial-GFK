export const COLUMN_MAP = {
  'Nombre':          'Nombre',
  'Corredor':        'Corredor',
  'Estado':          'Estado',
  'Dirección':       'Dirección',
  'Comuna':          'Comuna',
  'Región':          'Región',
  'GLA (m²)':        'GLA (m²)',
  'Área Total (m²)': 'GLA (m²)',
  'UF/m² Total':     'UF/m² Total',
  'UF/m² Piso 1':    'UF/m² Piso 1',
  'Precio UF/m²':    'UF/m² Total',
  'Vacancia (%)':    'Vacancia (%)',
  'Tenant Mix':      'Tenant Mix',
  'Latitud':         '__lat',
  'Longitud':        '__lng',
};

export const FILTERS = [
  { key: 'estado',   candidates: ['estado'],           label: 'Estado',      type: 'multi'  },
  { key: 'comuna',   candidates: ['comuna'],           label: 'Comuna',      type: 'multi'  },
  { key: 'ufm2',     candidates: ['uf/m² total', 'uf/m²'], label: 'UF/m² Total', type: 'slider', step: 0.01 },
  { key: 'ufm2p1',   candidates: ['uf/m² piso'],       label: 'UF/m² Piso 1', type: 'slider', step: 0.01 },
  { key: 'gla',      candidates: ['gla (m'],           label: 'GLA (m²)',    type: 'slider', step: 100  },
  { key: 'vacancia', candidates: ['vacancia (%)'],     label: 'Vacancia %',  type: 'slider', step: 0.1  },
];

export const KPIS = [
  { label: 'Strip Centers',    col: 'Nombre',       agg: 'count', fmt: 'int' },
  { label: 'UF/m² Total prom.', col: 'UF/m² Total', agg: 'avg',  fmt: 'uf2' },
  { label: 'UF/m² Piso 1 prom.', col: 'UF/m² Piso 1', agg: 'avg', fmt: 'uf2' },
  { label: 'Vacancia prom.',   col: 'Vacancia (%)', agg: 'avg',  fmt: 'pct' },
];

export const PROYECTOS_METRICS = [
  {
    id: 'ufm2', label: 'UF/m² Total prom.', col: 'UF/m² Total', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'ufm2p1', label: 'UF/m² Piso 1 prom.', col: 'UF/m² Piso 1', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'vacancia', label: 'Vacancia % prom.', col: 'Vacancia (%)', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  },
  {
    id: 'gla', label: 'GLA total (m²)', col: 'GLA (m²)', agg: 'sum',
    fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 }),
  },
  {
    id: 'count', label: 'Strip Centers', col: null, agg: 'count',
    fmt: v => String(Math.round(v)),
  },
];

export const SVP = {
  xOptions: [
    {
      value:       'gla',
      label:       'GLA (m²)',
      candidates:  ['gla (m'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
    },
  ],
  yOptions: [
    {
      value:       'ufm2',
      label:       'UF/m² Total',
      candidates:  ['uf/m² total', 'uf/m²'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'ufm2p1',
      label:       'UF/m² Piso 1',
      candidates:  ['uf/m² piso'],
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
  groupCandidates: ['estado', 'comuna', 'corredor'],
  projCandidates:  ['nombre'],
  getMpY: (t, mode) => {
    if (mode === 'ufm2')     return t.ufm2 ?? null;
    if (mode === 'ufm2p1')   return null;
    if (mode === 'vacancia') return null;
    return null;
  },
  summaryFields: [
    { label: 'Strip Centers',   candidates: ['nombre'],       agg: 'count' },
    { label: 'UF/m² prom.',    candidates: ['uf/m² total'],  agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { label: 'Vacancia %',     candidates: ['vacancia (%)'], agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' },
  ],
};

export const DISTRIB_COLS = [
  { col: 'UF/m² Total',    label: 'UF/m² Total',   unit: 'UF/m²' },
  { col: 'UF/m² Piso 1',   label: 'UF/m² Piso 1',  unit: 'UF/m²' },
  { col: 'GLA (m²)',        label: 'GLA (m²)',       unit: 'm²'    },
  { col: 'Vacancia (%)',    label: 'Vacancia (%)',   unit: '%'     },
];

export const MAP = {
  projectCandidates: ['nombre'],
  heatOptions: [
    { value: 'ufm2',     label: 'UF/m² Total',   candidates: ['uf/m² total', 'uf/m²'] },
    { value: 'vacancia', label: 'Vacancia (%)',   candidates: ['vacancia (%)'] },
  ],
  popupFields: [
    { label: 'Nombre',        keys: ['nombre'] },
    { label: 'Corredor',      keys: ['corredor'] },
    { label: 'Estado',        keys: ['estado'] },
    { label: 'Comuna',        keys: ['comuna'] },
    { label: 'UF/m² Total',   keys: ['uf/m² total', 'uf/m'] },
    { label: 'UF/m² Piso 1',  keys: ['uf/m² piso'] },
    { label: 'GLA (m²)',      keys: ['gla'] },
    { label: 'Vacancia (%)', keys: ['vacancia'] },
  ],
};

export const COMPARATIVA = {
  projectCandidates: ['comuna'],
  infoColumns: [],
  metricColumns: [
    { label: 'Strip Centers', candidates: ['nombre'],           fmt: 'int',  agg: 'count' },
    { label: 'UF/m² Total',   candidates: ['uf/m² total', 'uf/m²'], fmt: 'uf2' },
    { label: 'UF/m² Piso 1',  candidates: ['uf/m² piso'],      fmt: 'uf2'  },
    { label: 'GLA total',     candidates: ['gla (m'],           fmt: 'int',  agg: 'sum'  },
    { label: 'Vacancia %',   candidates: ['vacancia (%)'],     fmt: 'uf1'  },
  ],
};

export const CSV_FILENAME = 'stripcenters';
