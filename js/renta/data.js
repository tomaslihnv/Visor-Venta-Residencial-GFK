import { $, detectColType } from './utils.js';

// ============== Estado global ==============
export const state = {
  raw: [],
  filtered: [],
  columns: [],
  filters: {},
  sort: { col: null, dir: 'asc' },
  search: '',
  page: 1,
  pageSize: 50,
  chart: null,
  source: 'inciti',
};

// ============== Normalización Inciti Renta ==============
const INCITI_RENTA_MAP = {
  'Nombre':               'Proyecto',
  'Tipo de Propiedad':    'Tipo',
  'Operación':            'Operación',
  'Precio (UF)':          'Renta UF',
  'Precio por m² (UF)':   'UF/m²',
  'Metros Útiles':        'Útil (m²)',
  'Metros Totales':       'Total (m²)',
  'Metros Terraza':       'Terraza (m²)',
  'Gastos Comunes':       'Gastos Comunes (CLP)',
  'Link Publicación':     'Link',
};

const _normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
const INCITI_NORM_MAP = Object.fromEntries(
  Object.entries(INCITI_RENTA_MAP).map(([k, v]) => [_normStr(k), v])
);

function normalizeInciti(rows) {
  return rows
    .filter(r => {
      const precio = r['Precio (UF)'];
      return precio !== '' && precio != null && !isNaN(Number(precio)) && Number(precio) > 0;
    })
    .map(row => {
      const out = {};
      for (const [key, val] of Object.entries(row)) {
        const mapped = INCITI_RENTA_MAP[key] ?? INCITI_NORM_MAP[_normStr(key)] ?? key;
        out[mapped] = val;
      }

      // Coordenadas directas
      const lat = Number(row['Latitud']);
      const lng = Number(row['Longitud']);
      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        out['__lat'] = lat;
        out['__lng'] = lng;
      }

      // Tipología derivada de Dormitorios y Baños
      const dorm = row['Dormitorios'];
      const banos = row['Baños'] ?? row['Banos'] ?? row['Baño']; // Cubrimos variaciones con o sin tilde

      if (dorm !== '' && dorm != null) {
        const strDorm = String(dorm).trim();
        const nDorm = parseInt(strDorm);
        
        let tipo = '';
        
        // Si es un número válido (ej: 1, 2, 3), le ponemos la 'D'. Si es 0, asumimos 'Studio'
        if (!isNaN(nDorm) && nDorm >= 0 && nDorm <= 10) {
          tipo = nDorm === 0 ? 'Studio' : `${nDorm}D`;
        } else {
          tipo = strDorm; // Por si en el excel dice literalmente "Studio" o "Loft"
        }

        // Si detectamos baños y la tipología termina en 'D' (ej: 1D, 2D) agregamos el baño (ej: 1D1B)
        if (banos !== '' && banos != null && tipo.endsWith('D')) {
          const nBano = parseInt(banos);
          if (!isNaN(nBano) && nBano > 0 && nBano <= 10) {
            tipo += `${nBano}B`;
          }
        }
        
        // console.log(`Debug - Fila Excel | Dormitorios leídos: "${dorm}" | Baños leídos: "${banos}" ---> Tipología final calculada: "${tipo}"`);
        out['Tipología'] = tipo;
      } else {
        // console.log("Debug - No se encontró la columna Dormitorios en esta fila. La fila completa es:", row)
      }

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
  return document.querySelector('input[name="source"]:checked')?.value ?? 'inciti';
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
        // Intentar "Datos", luego primera hoja disponible
        const sheetName = wb.SheetNames.includes('Datos') ? 'Datos' : wb.SheetNames[0];
        if (!sheetName) { alert('El archivo no tiene hojas.'); return; }
        const ws = wb.Sheets[sheetName];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        if (raw.length === 0) { alert(`La hoja "${sheetName}" está vacía.`); return; }
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
  state.raw = rows;
  state.filtered = rows.slice();

  const colNames = Object.keys(rows[0]);
  state.columns = colNames.map(name => {
    const values = rows.map(r => r[name]);
    return { name, type: detectColType(values) };
  });

  $('#dropzone').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');

  import('./miProyecto.js').then(({ initMpPanel }) => initMpPanel());
  import('./filters.js').then(({ buildFilters }) => buildFilters());
  import('./chart.js').then(({ populateDistribSelectors, populateSvpSelectors, populateProyectosSelectors }) => {
    populateDistribSelectors();
    populateSvpSelectors();
    populateProyectosSelectors();
  });
  import('./filters.js').then(({ applyFilters }) => applyFilters());

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