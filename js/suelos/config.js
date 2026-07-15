export const COLUMN_MAP = {
  'Nombre':              'Nombre',
  'Propietario':         'Propietario',
  'Estado':              'Estado',
  'Dirección':           'Dirección',
  'Comuna':              'Comuna',
  'Región':              'Región',
  'Zonificación':        'Zonificación',
  'Superficie (m²)':     'Superficie (m²)',
  'Área (m²)':           'Superficie (m²)',
  'UF/m²':               'UF/m²',
  'Precio UF/m²':        'UF/m²',
  'Precio Total (UF)':   'Precio Total (UF)',
  'Precio Total':        'Precio Total (UF)',
  'Latitud':             '__lat',
  'Longitud':            '__lng',
};

export const FILTERS = [
  { key: 'estado',      candidates: ['estado'],              label: 'Estado',         type: 'multi'  },
  { key: 'comuna',      candidates: ['comuna'],              label: 'Comuna',         type: 'multi'  },
  { key: 'zonificacion', candidates: ['zonific'],            label: 'Zonificación',   type: 'multi'  },
  { key: 'ufm2',        candidates: ['uf/m'],                label: 'UF/m²',          type: 'slider', step: 0.01 },
  { key: 'sup',         candidates: ['superficie (m', 'área (m'], label: 'Superficie (m²)', type: 'slider', step: 100  },
  { key: 'total',       candidates: ['precio total'],        label: 'Precio Total UF', type: 'slider', step: 10   },
];

export const KPIS = [
  { label: 'Suelos',           col: 'Nombre',           agg: 'count', fmt: 'int' },
  { label: 'UF/m² prom.',      col: 'UF/m²',            agg: 'avg',   fmt: 'uf2' },
  { label: 'Precio Total prom.', col: 'Precio Total (UF)', agg: 'avg', fmt: 'uf1' },
  { label: 'Superficie prom.', col: 'Superficie (m²)',  agg: 'avg',   fmt: 'int' },
];

export const PROYECTOS_METRICS = [
  {
    id: 'ufm2', label: 'UF/m² prom.', col: 'UF/m²', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'total', label: 'Precio Total prom.', col: 'Precio Total (UF)', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  {
    id: 'sup', label: 'Superficie total (m²)', col: 'Superficie (m²)', agg: 'sum',
    fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 }),
  },
  {
    id: 'count', label: 'Suelos', col: null, agg: 'count',
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
      value:       'ufm2',
      label:       'UF/m²',
      candidates:  ['uf/m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'total',
      label:       'Precio Total (UF)',
      candidates:  ['precio total'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
    },
  ],
  groupCandidates: ['estado', 'comuna', 'zonificacion'],
  projCandidates:  ['nombre'],
  getMpY: (t, mode) => {
    if (mode === 'ufm2')  return t.ufm2  ?? null;
    if (mode === 'total') return null;
    return null;
  },
  summaryFields: [
    { label: 'Suelos',      candidates: ['nombre'],          agg: 'count' },
    { label: 'UF/m² prom.', candidates: ['uf/m'],            agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { label: 'Sup. total',  candidates: ['superficie (m', 'área (m'], agg: 'sum',
      fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' m²' },
  ],
};

export const DISTRIB_COLS = [
  { col: 'UF/m²',             label: 'UF/m²',              unit: 'UF/m²' },
  { col: 'Precio Total (UF)', label: 'Precio Total (UF)',  unit: 'UF'    },
  { col: 'Superficie (m²)',   label: 'Superficie (m²)',    unit: 'm²'    },
];

export const MAP = {
  projectCandidates: ['nombre'],
  heatOptions: [
    { value: 'ufm2',  label: 'UF/m²',             candidates: ['uf/m'] },
    { value: 'total', label: 'Precio Total (UF)', candidates: ['precio total'] },
  ],
  popupFields: [
    { label: 'Nombre',          keys: ['nombre'] },
    { label: 'Estado',          keys: ['estado'] },
    { label: 'Comuna',          keys: ['comuna'] },
    { label: 'Zonificación',    keys: ['zonific'] },
    { label: 'UF/m²',           keys: ['uf/m'] },
    { label: 'Precio Total UF', keys: ['precio total'] },
    { label: 'Superficie (m²)', keys: ['superficie', 'área'] },
  ],
};

export const COMPARATIVA = {
  projectCandidates: ['comuna'],
  infoColumns: [],
  metricColumns: [
    { label: 'Suelos',      candidates: ['nombre'],           fmt: 'int',  agg: 'count' },
    { label: 'UF/m²',       candidates: ['uf/m'],             fmt: 'uf2'  },
    { label: 'Total UF',    candidates: ['precio total'],     fmt: 'uf1'  },
    { label: 'Sup. total',  candidates: ['superficie (m', 'área (m'], fmt: 'int', agg: 'sum' },
  ],
};

export const CSV_FILENAME = 'suelos';
