import { $, detectColType } from './utils.js';

// ============== Estado global ==============
export const state = {
  raw: [],            // todas las filas
  filtered: [],       // filas filtradas
  columns: [],        // [{name, type: 'number'|'string'|'date', values}]
  filters: {},        // {colName: {type, ...}}
  sort: { col: null, dir: 'asc' },
  search: '',
  page: 1,
  pageSize: 50,
  chart: null,
  source: 'gfk',     // 'gfk' | 'inciti'
};

// ============== Normalización Inciti → GFK ==============
const _normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();

const INCITI_TO_GFK = {
  'Proyecto':                  'Edificio',
  'Inmobiliaria':              'Propietario',
  'Programa':                  'Tipología',
  'Oferta Programa':           'Disponibles',
  'Precio UF':                 'Ticket UF',
  'UF/m2':                     'UF/m²',
  'M2 Útil':                   'Interior (m²)',
  'M2 Terraza':                'Terraza (m²)',
  'm2 Vendible':               'Útil (m²)',
  'Fecha Inicio Construcción': 'Fecha inicio',
  'Fecha Est. Entrega':        'Fecha entrega',
};
// Lookup insensible a tildes como fallback
const INCITI_NORM_MAP = Object.fromEntries(
  Object.entries(INCITI_TO_GFK).map(([k, v]) => [_normStr(k), v])
);

// ── Helpers de fechas en español para cálculo de velocidad ──
const _ES_MON = {
  'ene':0,'feb':1,'mar':2,'abr':3,'may':4,'jun':5,
  'jul':6,'ago':7,'sep':8,'sept':8,'oct':9,'nov':10,'dic':11,
};
function _parseEsDate(s) {
  if (!s) return null;
  const parts = String(s).trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const mon = _ES_MON[parts[0]];
  const yr  = parseInt(parts[1]);
  if (mon === undefined || isNaN(yr)) return null;
  return new Date(yr, mon, 1);
}
function _monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// Transformaciones de valor por columna Inciti (antes del renombre)
const INCITI_TRANSFORMS = {
  // '3D2B' → '3D'  (equiparar al formato GFK que solo muestra dormitorios)
  'Programa': v => {
    const s = String(v ?? '').trim();
    const m = s.match(/^(\d+D)\d+B$/i);
    return m ? m[1] : s;
  },
};

function normalizeInciti(rows) {
  // Eliminar tipologías sin disponibilidad ni precio (ya vendidas / sin datos)
  const active = rows.filter(r => {
    const oferta = Number(r['Oferta Programa']);
    const precio  = r['Precio UF'];
    return !(oferta === 0 && (precio === '' || precio == null));
  });

  // ── Pre-pase: velocidad de venta a nivel proyecto (sobre TODAS las filas, no solo active) ──
  const _proyStats = new Map();
  for (const r of rows) {
    const proj = String(r['Proyecto'] ?? '').trim();
    if (!proj) continue;
    if (!_proyStats.has(proj)) {
      _proyStats.set(proj, {
        stock: 0, oferta: 0,
        periodo: r['Periodo'],
        inicioVentas: r['Fecha Inicio Ventas'],
      });
    }
    const s = _proyStats.get(proj);
    s.stock  += Number(r['Stock Programa'])  || 0;
    s.oferta += Number(r['Oferta Programa']) || 0;
  }
  const _proyVel = new Map();
  for (const [proj, s] of _proyStats) {
    const fechaCorte = _parseEsDate(s.periodo);
    const fechaInicio = _parseEsDate(s.inicioVentas);
    if (!fechaCorte || !fechaInicio) continue;
    const meses = Math.max(1, _monthsBetween(fechaInicio, fechaCorte));
    const vendidas = s.stock - s.oferta;
    if (vendidas > 0) _proyVel.set(proj, +(vendidas / meses).toFixed(2));
  }

  return active.map(row => {
    const out = {};
    for (const [key, val] of Object.entries(row)) {
      const mapped    = INCITI_TO_GFK[key] ?? INCITI_NORM_MAP[_normStr(key)] ?? key;
      const transform = INCITI_TRANSFORMS[key];
      out[mapped] = transform ? transform(val) : val;
    }
    // Coordenadas directas para el mapa (sin geocodificación)
    const lat = Number(row['Latitud']);
    const lng = Number(row['Longitud']);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      out['__lat'] = lat;
      out['__lng'] = lng;
    }
    // % Vendido calculado (Stock - Disponibles) / Stock
    const stock  = Number(row['Stock Programa']);
    const oferta = Number(row['Oferta Programa']);
    if (!isNaN(stock) && stock > 0 && !isNaN(oferta)) {
      out['% Vendido'] = (stock - oferta) / stock;
    }
    // Velocidad de venta a nivel proyecto
    const vel = _proyVel.get(String(row['Proyecto'] ?? '').trim());
    if (vel !== undefined) out['Vel. Venta (un./mes)'] = vel;
    return out;
  });
}

// ============== Carga de archivo ==============
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function getSelectedSource() {
  return document.querySelector('input[name="source"]:checked')?.value ?? 'gfk';
}

function loadFile(file) {
  $('#fileName').textContent = file.name;
  const source = getSelectedSource();
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });

      let rows;
      if (source === 'inciti') {
        if (!wb.SheetNames.includes('Proyectos')) {
          alert('No encontré la hoja "Proyectos" en el archivo. Hojas disponibles: ' + wb.SheetNames.join(', '));
          return;
        }
        const ws = wb.Sheets['Proyectos'];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        if (raw.length === 0) { alert('La hoja "Proyectos" está vacía.'); return; }
        rows = normalizeInciti(raw);
        state.source = 'inciti';
      } else {
        if (!wb.SheetNames.includes('Datos')) {
          alert('No encontré la hoja "Datos" en el archivo. Hojas disponibles: ' + wb.SheetNames.join(', '));
          return;
        }
        const ws = wb.Sheets['Datos'];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        if (rows.length === 0) { alert('La hoja "Datos" está vacía.'); return; }
        state.source = 'gfk';
      }
      onDataLoaded(rows);
    } catch (err) {
      console.error(err);
      alert('Error leyendo el archivo: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============== Procesado al cargar ==============
function onDataLoaded(rows) {
  if (!rows.length) {
    alert('No se encontraron datos para cargar. Revisa la consola para más detalles.');
    return;
  }
  state.raw = rows;
  state.filtered = rows.slice();

  // Detectar columnas y tipos
  const colNames = Object.keys(rows[0] ?? {});
  state.columns = colNames.map(name => {
    const values = rows.map(r => r[name]);
    return { name, type: detectColType(values) };
  });

  // Mostrar dashboard
  $('#dropzone').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');

  // Importar y llamar funciones de otros módulos
  import('./miProyecto.js').then(({ initMpPanel }) => initMpPanel());
  import('./filters.js').then(({ buildFilters }) => buildFilters());
  import('./chart.js').then(({ populateDistribSelectors, populateSvpSelectors, populateProyectosSelectors }) => {
    populateDistribSelectors();
    populateSvpSelectors();
    populateProyectosSelectors();
  });
  import('./filters.js').then(({ applyFilters }) => applyFilters());

  // Resetear estado de mapa y geocodificar/usar coords directas
  import('./map.js').then(({ resetMapOnLoad, geocodeData }) => {
    resetMapOnLoad();
    geocodeData().then(() => {
      if ($('.tab.active')?.dataset.tab === 'mapa') {
        import('./map.js').then(({ renderMap }) => renderMap());
      }
    });
  });
}

export { loadFile, onDataLoaded };