import { detectColType } from '../core/utils.js';
import { COLUMN_MAP, FILTERS, KPIS, PROYECTOS_METRICS, SVP, CRUZ, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME, SAVED_DATASETS } from './config.js';

// ── Estado global del visor ────────────────────────────────────────────────
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
  chart:        null,   // SVP chart instance
};

// ── Normalización ──────────────────────────────────────────────────────────
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

  // Coordenadas directas: mapear desde los campos __lat/__lng ya renombrados
  const lat = Number(out['__lat'] ?? row['Latitud'] ?? row['latitud']);
  const lng = Number(out['__lng'] ?? row['Longitud'] ?? row['longitud']);
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    out['__lat'] = lat;
    out['__lng'] = lng;
  }

  return out;
}

function _normalizeRows(rows) {
  return rows
    .map(_normalizeRow)
    .filter(r => {
      // Filtrar filas sin datos de arriendo
      const v = r['Arriendo UF'] ?? r['Arriendo'];
      return v !== '' && v != null && !isNaN(Number(v)) && Number(v) > 0;
    });
}

// ── Carga de archivo ───────────────────────────────────────────────────────
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
      // Inciti: intenta hoja "Datos", luego primera hoja
      const sheetName = wb.SheetNames.includes('Datos') ? 'Datos' : wb.SheetNames[0];
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

// ── Datasets guardados (JSON pre-cargados) ─────────────────────────────────
function loadSavedDataset(entry) {
  const fileNameEl = document.getElementById('fileName');
  fetch(entry.file)
    .then(r => {
      if (!r.ok) throw new Error(`No se encontró ${entry.file}`);
      return r.json();
    })
    .then(rows => {
      if (fileNameEl) fileNameEl.textContent = entry.label;
      onDataLoaded(rows);
    })
    .catch(err => {
      console.error(err);
      alert('Error cargando dataset guardado: ' + err.message);
    });
}

function _renderSavedDatasetsList() {
  const cont = document.getElementById('savedDatasetsList');
  if (!cont) return;
  if (!SAVED_DATASETS.length) {
    cont.innerHTML = '<p class="hint">Sin datasets guardados todavía.</p>';
    return;
  }
  cont.innerHTML = SAVED_DATASETS
    .map((entry, i) => `<button type="button" class="saved-dataset-btn" data-idx="${i}">${entry.label}</button>`)
    .join('');
  cont.querySelectorAll('.saved-dataset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cont.querySelectorAll('.saved-dataset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSavedDataset(SAVED_DATASETS[+btn.dataset.idx]);
    });
  });
}
_renderSavedDatasetsList();

// ── onDataLoaded ───────────────────────────────────────────────────────────
export function onDataLoaded(rows) {
  state.raw      = rows;
  state.filtered = rows.slice();
  state.excludedProjects = new Set();

  const colNames  = Object.keys(rows[0] ?? {});
  state.columns   = colNames.map(name => ({
    name,
    type: detectColType(rows.map(r => r[name])),
  }));

  document.getElementById('dropzone')?.classList.add('hidden');
  document.getElementById('dashboard')?.classList.remove('hidden');

  // Lazy-load todos los módulos
  Promise.all([
    import('./miProyecto.js'),
    import('../core/filters.js'),
    import('../core/kpis.js'),
    import('../core/table.js'),
    import('../core/chart-distrib.js'),
    import('../core/chart-svp.js'),
    import('../core/chart-cruz.js'),
    import('../core/chart-proyectos.js'),
    import('../core/map.js'),
  ]).then(([
    { initMpPanel },
    { buildFilters, applyFilters },
    { renderKpis },
    { initTableListeners, renderTable },
    { populateDistribSelectors, initDistribListeners, renderDistrib },
    { populateSvpSelectors, initSvpListeners, renderSvp },
    { initCruzListeners, renderCruz },
    { initProyectosListeners, renderProyectos },
    { resetMapOnLoad, geocodeData, renderMap },
  ]) => {
    import('./miProyecto.js').then(({ mp }) => {
      initMpPanel();

      const container = document.getElementById('filtersContainer');

      const onChange = _state => {
        renderKpis(_state.filtered, _state.raw.length, KPIS);
        renderTable(_state, { hiddenCols: [] });

        const tab = document.querySelector('.tab.active')?.dataset.tab;
        import('./miProyecto.js').then(({ mp: mpCurrent }) => {
          if (tab === 'distribucion') renderDistrib(_state, DISTRIB_COLS, mpCurrent);
          if (tab === 'svp')          renderSvp(_state, SVP, mpCurrent);
          if (tab === 'cruz')         renderCruz(_state, CRUZ, mpCurrent);
          if (tab === 'proyectos')    renderProyectos(_state, PROYECTOS_METRICS, mpCurrent, { projectCandidates: MAP.projectCandidates });
          if (tab === 'comparativa')  import('../core/comparativa.js').then(({ renderComparativa }) => renderComparativa(_state, COMPARATIVA, mpCurrent));
          if (tab === 'mapa')         renderMap(_state, MAP, mpCurrent);
        });
        import('../core/map.js').then(({ updateFilterWidget }) => updateFilterWidget(_state, FILTERS)).catch(() => {});
      };

      // Helpers para re-render lazy (usados en main.js)
      window._mf = {
        renderDistrib:  (_s, _mp) => import('../core/chart-distrib.js').then(({ renderDistrib })  => renderDistrib(_s, DISTRIB_COLS, _mp)),
        renderSvp:      (_s, _mp) => import('../core/chart-svp.js').then(({ renderSvp })          => renderSvp(_s, SVP, _mp)),
        renderCruz:     (_s, _mp) => import('../core/chart-cruz.js').then(({ renderCruz })        => renderCruz(_s, CRUZ, _mp)),
        renderProyectos:(_s, _mp) => import('../core/chart-proyectos.js').then(({ renderProyectos }) => renderProyectos(_s, PROYECTOS_METRICS, _mp, { projectCandidates: MAP.projectCandidates })),
        renderMap:      (_s, _mp) => renderMap(_s, MAP, _mp),
        renderComparativa: (_s, _mp) => import('../core/comparativa.js').then(({ renderComparativa }) => renderComparativa(_s, COMPARATIVA, _mp)),
        state, onChange,
        FILTERS, KPIS, PROYECTOS_METRICS, SVP, CRUZ, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME,
      };

      buildFilters(FILTERS, state, container, onChange);
      applyFilters(FILTERS, state, onChange);

      populateDistribSelectors(state, DISTRIB_COLS);
      initDistribListeners(state, DISTRIB_COLS, mp);
      populateSvpSelectors(state, SVP);
      initSvpListeners(state, SVP, mp);
      initCruzListeners(state, CRUZ, mp);
      initProyectosListeners(state, PROYECTOS_METRICS, mp, {
        projectCandidates: MAP.projectCandidates,
        getMpValue: (metricId, mp) => {
          if (metricId === 'arriendo') return mp.arriendo ?? null;
          if (metricId === 'ufm2')     return mp.ufm2 ?? null;
          if (metricId === 'stock')    return mp.stock ?? null;
          if (metricId === 'vacancia') return mp.vacancia ?? null;
          return null;
        },
      });
      initTableListeners(state, onChange);

      resetMapOnLoad();
      geocodeData(state, MAP, () => {
        if (document.querySelector('.tab.active')?.dataset.tab === 'mapa') {
          renderMap(state, MAP, mp);
        }
      });

      // Initial render
      renderKpis(state.filtered, state.raw.length, KPIS);
      renderTable(state, { hiddenCols: [] });
    });
  });
}

export { COLUMN_MAP, FILTERS, KPIS, PROYECTOS_METRICS, SVP, CRUZ, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME };
