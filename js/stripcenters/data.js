import { detectColType } from '../core/utils.js';
import {
  COLUMN_MAP, FILTERS, KPIS, MAP,
  PROYECTOS_METRICS, SVP, DISTRIB_COLS, COMPARATIVA, CSV_FILENAME,
} from './config.js';
import { mp } from './miProyecto.js';

export const state = {
  raw:          [],
  filtered:     [],
  columns:      [],
  filterValues: {},
  filterRefs:   {},
  filterCols:   {},
  sort:         { col: null, dir: 'asc' },
  search:       '',
  page:         1,
  pageSize:     50,
  chart:        null,
};

const _normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
const NORM_MAP  = Object.fromEntries(
  Object.entries(COLUMN_MAP).map(([k, v]) => [_normStr(k), v])
);

function _normalizeRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const mapped = COLUMN_MAP[key] ?? NORM_MAP[_normStr(key)] ?? key;
    out[mapped] = val;
  }
  const lat = Number(out['__lat'] ?? row['Latitud'] ?? row['latitud']);
  const lng = Number(out['__lng'] ?? row['Longitud'] ?? row['longitud']);
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    out['__lat'] = lat; out['__lng'] = lng;
  }
  return out;
}

function _normalizeRows(rows) {
  return rows
    .map(_normalizeRow)
    .filter(r => r['__lat'] != null && r['__lng'] != null);
}

const fileInput = document.getElementById('fileInput');
const dropzone  = document.getElementById('dropzone');

fileInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach(ev => {
  dropzone?.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  dropzone?.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});
dropzone?.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  const fileNameEl = document.getElementById('fileName');
  if (fileNameEl) fileNameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb   = XLSX.read(data, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) { alert('El archivo no tiene hojas.'); return; }
      const ws  = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (!raw.length) { alert(`La hoja "${sheetName}" está vacía.`); return; }
      onDataLoaded(_normalizeRows(raw));
    } catch (err) {
      console.error(err);
      alert('Error leyendo el archivo: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

export function onDataLoaded(rows) {
  if (!rows.length) {
    alert('No se encontraron datos válidos. Revisa la consola para más detalles.');
    return;
  }
  state.raw      = rows;
  state.filtered = rows.slice();

  const colNames = Object.keys(rows[0] ?? {});
  state.columns  = colNames.map(name => ({
    name,
    type: detectColType(rows.map(r => r[name])),
  }));

  document.getElementById('dropzone')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');

  Promise.all([
    import('../core/filters.js'),
    import('../core/kpis.js'),
    import('../core/table.js'),
    import('../core/map.js'),
    import('../core/chart-proyectos.js'),
    import('../core/chart-svp.js'),
    import('../core/chart-distrib.js'),
    import('../core/comparativa.js'),
  ]).then(([
    { buildFilters, applyFilters },
    { renderKpis },
    { initTableListeners, renderTable },
    { resetMapOnLoad, geocodeData, renderMap, updateFilterWidget },
    { initProyectosListeners, renderProyectos },
    { initSvpListeners, renderSvp, populateSvpSelectors },
    { initDistribListeners, renderDistrib, populateDistribSelectors },
    { renderComparativa, copyComparativaHtml },
  ]) => {
    const container = document.getElementById('filtersContainer');
    const activeTab = () => document.querySelector('.tab.active')?.dataset.tab;

    const onChange = _state => {
      renderKpis(_state.filtered, _state.raw.length, KPIS);
      renderTable(_state, { hiddenCols: ['__lat', '__lng'] });
      updateFilterWidget?.(_state, FILTERS);
      const tab = activeTab();
      if (tab === 'mapa')         renderMap(_state, MAP, mp);
      if (tab === 'proyectos')    renderProyectos(_state, PROYECTOS_METRICS, null, { projectCandidates: ['comuna'] });
      if (tab === 'svp')          renderSvp(_state, SVP, mp);
      if (tab === 'distribucion') renderDistrib(_state, DISTRIB_COLS, mp);
      if (tab === 'comparativa')  renderComparativa(_state, COMPARATIVA, null);
    };

    buildFilters(FILTERS, state, container, onChange);
    applyFilters(FILTERS, state, onChange);
    initTableListeners(state, onChange);

    resetMapOnLoad();
    geocodeData(state, MAP, () => renderMap(state, MAP, mp));

    populateSvpSelectors(state, SVP);
    populateDistribSelectors(state, DISTRIB_COLS);

    initProyectosListeners(state, PROYECTOS_METRICS, null, { projectCandidates: ['comuna'] });
    initSvpListeners(state, SVP, mp);
    initDistribListeners(state, DISTRIB_COLS, mp);

    document.getElementById('exportCompBtn')?.addEventListener('click', () => copyComparativaHtml());

    renderKpis(state.filtered, state.raw.length, KPIS);
    renderTable(state, { hiddenCols: ['__lat', '__lng'] });

    window._sc = { renderMap, renderProyectos, renderSvp, renderDistrib, renderComparativa, state, onChange };
  });
}

export { COLUMN_MAP, FILTERS, KPIS, MAP, PROYECTOS_METRICS, SVP, DISTRIB_COLS, COMPARATIVA, CSV_FILENAME };
