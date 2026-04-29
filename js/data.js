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
};

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

function loadFile(file) {
  $('#fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      if (!wb.SheetNames.includes('Datos')) {
        alert('No encontré la hoja "Datos" en el archivo. Hojas disponibles: ' + wb.SheetNames.join(', '));
        return;
      }
      const ws = wb.Sheets['Datos'];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (rows.length === 0) {
        alert('La hoja "Datos" está vacía.');
        return;
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

  // Detectar columnas y tipos
  const colNames = Object.keys(rows[0]);
  state.columns = colNames.map(name => {
    const values = rows.map(r => r[name]);
    return { name, type: detectColType(values) };
  });

  // Mostrar dashboard
  $('#dropzone').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');

  // Importar y llamar funciones de otros módulos
  import('./filters.js').then(({ buildFilters }) => buildFilters());
  import('./chart.js').then(({ populateChartSelectors, populateDistribSelectors }) => {
    populateChartSelectors();
    populateDistribSelectors();
  });
  import('./filters.js').then(({ applyFilters }) => applyFilters());

  // Geocodificar direcciones si hay columna
  import('./map.js').then(({ geocodeData }) => {
    geocodeData().then(() => {
      // Renderizar mapa si la tab está activa
      if ($('.tab.active')?.dataset.tab === 'mapa') {
        import('./map.js').then(({ renderMap }) => renderMap());
      }
    });
  });
}

export { loadFile, onDataLoaded };