// ============================================================
// CONFIG Oficinas
// ============================================================

export const COLUMN_MAP = {
  'Link Publicación':    'Link',
  'Nombre':               'Nombre',
  'Tipo de Propiedad':    'Tipo',
  'Operación':            'Operación',
  'Precio (UF)':          'Precio UF',
  'Precio por m² (UF)':   'UF/m²',
  'Dirección':            'Dirección',
  'Comuna':               'Comuna',
  'Región':               'Región',
  'Metros Útiles':        'Útil (m²)',
  'Metros Totales':       'Totales (m²)',
  'Metros Terraza':       'Terraza (m²)',
  'Dormitorios':          'Dormitorios',
  'Baños':                'Baños',
  'Estacionamientos':     'Estacionamientos',
  'Bodegas':              'Bodegas',
  'Orientación':          'Orientación',
  'Gastos Comunes':       'Gastos Comunes',
  'Corredor':             'Corredor',
  'Fecha Publicación':    'Fecha Publicación',
  'Latitud':              '__lat',
  'Longitud':             '__lng',
  'Piso':                 'Piso',
};

// ── Filtros ────────────────────────────────────────────────────────────────
export const FILTERS = [
  { key: 'comuna',       candidates: ['comuna'],                  label: 'Comuna',              type: 'multi' },
  { key: 'tipo',         candidates: ['tipo'],                    label: 'Tipo',                 type: 'multi' },
  { key: 'submercado',   candidates: ['submercado'],              label: 'Submercado',          type: 'multi' },
  { key: 'propietario',  candidates: ['propietario'],             label: 'Propietario',         type: 'multi' },
  { key: 'clase',        candidates: ['clase'],                   label: 'Clase',                type: 'multi' },
  { key: 'precio',       candidates: ['precio uf', 'precio (uf'], label: 'Precio UF',            type: 'slider', step: 1 },
  { key: 'ufm2',         candidates: ['uf/m', 'precio por m'],    label: 'UF/m²',                type: 'slider', step: 0.01 },
  { key: 'util',         candidates: ['util (m', 'útil (m'],      label: 'Útil (m²)',            type: 'slider', step: 1 },
  { key: 'pisos',        candidates: ['pisos'],                   label: 'Pisos',                type: 'slider', step: 1 },
  { key: 'antiguedad',   candidates: ['antiguedad'],              label: 'Antigüedad (años)',   type: 'slider', step: 1 },
  { key: 'leed',         candidates: ['certificacion leed', 'leed'], label: 'Certificación LEED', type: 'multi' },
  { key: 'multiprop',    candidates: ['multipropietario'],        label: 'Multipropietario',    type: 'multi' },
  { key: 'corporativo',  candidates: ['corporativo'],             label: 'Corporativo',         type: 'multi' },
];

// ── KPIs ───────────────────────────────────────────────────────────────────
export const KPIS = [
  { label: 'Ofertas',          col: 'Nombre',    agg: 'count',  fmt: 'int' },
  { label: 'Precio UF prom.',  col: 'Precio UF', agg: 'avg',    fmt: 'uf1' },
  { label: 'UF/m² prom.',      col: 'UF/m²',     agg: 'avg',    fmt: 'uf2' },
  { label: 'Útil (m²) prom.', col: 'Útil (m²)', agg: 'avg',    fmt: 'uf1' },
];

// ── Gráfico Proyectos (agrupable por submercado / propietario / edificio) ──
export const PROYECTOS_METRICS = [
  {
    id: 'precio', label: 'Precio UF prom.', col: 'Precio UF', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  {
    id: 'ufm2', label: 'UF/m² prom.', col: 'UF/m²', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    id: 'util', label: 'Útil (m²) prom.', col: 'Útil (m²)', agg: 'avg',
    fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }),
  },
  {
    id: 'count', label: 'Ofertas', col: null, agg: 'count',
    fmt: v => String(Math.round(v)),
  },
];

// ── Dispersión (SVP) ───────────────────────────────────────────────────────
export const SVP = {
  xOptions: [
    {
      value:       'util',
      label:       'Útil (m²)',
      candidates:  ['util (m', 'útil (m'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
    },
    {
      value:       'precio',
      label:       'Precio UF',
      candidates:  ['precio uf', 'precio (uf'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
    },
    {
      value:       'totales',
      label:       'Totales (m²)',
      candidates:  ['totales (m', 'metros totales'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
    },
  ],
  yOptions: [
    {
      value:       'ufm2',
      label:       'UF/m²',
      candidates:  ['uf/m', 'precio por m'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`,
    },
    {
      value:       'precio',
      label:       'Precio UF',
      candidates:  ['precio uf', 'precio (uf'],
      formatValue: v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF`,
    },
    {
      value:       'util',
      label:       'Útil (m²)',
      candidates:  ['util (m', 'útil (m'],
      formatValue: v => `${v.toLocaleString('es-CL')} m²`,
      formatAvg:   v => `Prom.: ${v.toLocaleString('es-CL')} m²`,
    },
  ],
  groupCandidates: ['tipo', 'submercado'],
  projCandidates:  ['nombre'],
  getMpY: (t, mode) => {
    if (mode === 'ufm2')   return t.ufm2  ?? null;
    if (mode === 'precio')  return t.renta ?? null;
    if (mode === 'util')    return t.sup   ?? null;
    return null;
  },
  summaryFields: [
    { label: 'Ofertas',          candidates: ['nombre'],                   agg: 'count' },
    { label: 'Precio UF prom.',  candidates: ['precio uf', 'precio (uf'], agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { label: 'UF/m² prom.',      candidates: ['uf/m', 'precio por m'],    agg: 'avg',
      fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  ],
};

// ── Distribución ───────────────────────────────────────────────────────────
export const DISTRIB_COLS = [
  { col: 'Precio UF', label: 'Precio UF',  unit: 'UF' },
  { col: 'UF/m²',     label: 'UF/m²',      unit: 'UF/m²' },
  { col: 'Útil (m²)', label: 'Útil (m²)', unit: 'm²' },
];

// ── Mapa ───────────────────────────────────────────────────────────────────
export const MAP = {
  projectCandidates: ['nombre'],
  heatOptions: [
    { value: 'ufm2',   label: 'UF/m²',     candidates: ['uf/m', 'precio por m'] },
    { value: 'precio', label: 'Precio UF', candidates: ['precio uf', 'precio (uf'] },
  ],
  popupFields: [
    { label: 'Nombre',       keys: ['nombre'] },
    { label: 'Comuna',       keys: ['comuna'] },
    { label: 'Tipo',         keys: ['tipo'] },
    { label: 'Precio UF',    keys: ['precio uf'] },
    { label: 'UF/m²',        keys: ['uf/m'] },
    { label: 'Útil (m²)',    keys: ['util'] },
    { label: 'Piso',         keys: ['piso'] },
    { label: 'Submercado',   keys: ['submercado'] },
    { label: 'Propietario',  keys: ['propietario'] },
  ],
};

// ── Tabla Comparativa (por Submercado) ──────────────────────────────────────
export const COMPARATIVA = {
  projectCandidates: ['submercado'],
  infoColumns: [],
  metricColumns: [
    { label: 'Ofertas',     candidates: ['nombre'],                   fmt: 'int', agg: 'count' },
    { label: 'Precio UF',   candidates: ['precio uf', 'precio (uf'], fmt: 'uf1' },
    { label: 'UF/m²',       candidates: ['uf/m', 'precio por m'],    fmt: 'uf2' },
    { label: 'Útil (m²)',  candidates: ['util (m', 'útil (m'],      fmt: 'uf1' },
  ],
};

export const CSV_FILENAME = 'oficinas';
