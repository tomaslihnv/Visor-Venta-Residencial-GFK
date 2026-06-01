import { $, debounce } from '../utils.js';
import { state } from './data.js';

// ============== Resolución de columnas ==============
function findCol(candidates) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return state.columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

let cols = {};

function resolveCols() {
  cols.tipologia   = findCol(['tipología', 'tipologia']);
  cols.corredor    = findCol(['corredor', 'inmobiliaria', 'propietario']);
  cols.tipo        = findCol(['tipo de prop', 'tipo prop', 'tipo']);
  cols.comuna      = findCol(['comuna']);
  cols.superficie  = findCol(['util (m', 'metros util', 'sup. út', 'sup util']);
  cols.ufm2        = findCol(['uf/m', 'uf / m']);
  cols.renta       = findCol(['renta uf', 'precio (uf', 'precio uf', 'renta']);
  cols.gastos      = findCol(['gastos comunes', 'ggcc']);
  cols.proyecto    = findCol(['proyecto', 'edificio', 'nombre', 'building']);
}

const TIPO_ORDER = ['S', '1D', '2D', '3D', '4D'];

// ============== Estado de filtros ==============
const F = {
  tipologia:   new Set(),
  corredor:    new Set(),
  tipo:        new Set(),
  comuna:      new Set(),
  supMin: null, supMax: null,
  ufm2Min: null, ufm2Max: null,
  rentaMin: null, rentaMax: null,
  gastosMin: null, gastosMax: null,
  excludedProyectos: new Set(),
};

const refs = {};
let _proyHistory = [];

// ============== Construcción de filtros ==============
export function buildFilters() {
  resolveCols();

  F.tipologia.clear(); F.corredor.clear(); F.tipo.clear(); F.comuna.clear();
  F.supMin = F.supMax = F.ufm2Min = F.ufm2Max = F.rentaMin = F.rentaMax = F.gastosMin = F.gastosMax = null;
  F.excludedProyectos.clear();
  _proyHistory = [];
  Object.keys(refs).forEach(k => delete refs[k]);

  const container = $('#filtersContainer');
  container.innerHTML = '';

  if (cols.tipologia)  _buildMulti('tipologia', cols.tipologia, 'Tipología', container);

  if (cols.superficie) _buildSlider('sup',    cols.superficie, 'm² útil',             container, 1);
  if (cols.renta)      _buildSlider('renta',  cols.renta,      'Renta UF',            container, 1);
  if (cols.ufm2)       _buildSlider('ufm2',   cols.ufm2,       'UF/m²',               container, 0.01);
  if (cols.gastos)     _buildSlider('gastos', cols.gastos,     'Gastos Comunes (CLP)', container, 1000);
  if (cols.corredor)   _buildMulti('corredor', cols.corredor,  'Corredor',            container);
  if (cols.tipo)       _buildMulti('tipo',     cols.tipo,      'Tipo de propiedad',   container);
  if (cols.comuna)     _buildMulti('comuna',   cols.comuna,    'Comuna',              container);
}

// --- Multi checkbox genérico ---
function _buildMulti(key, colName, label, container) {
  const rawVals = [...new Set(
    state.raw.map(r => r[colName]).filter(v => v !== '' && v != null)
  )];
  if (key === 'tipologia' && !rawVals.some(v => String(v) === 'S')) rawVals.push('S');
  const vals = rawVals.sort((a, b) => {
    if (key === 'tipologia') {
      const ia = TIPO_ORDER.indexOf(String(a)), ib = TIPO_ORDER.indexOf(String(b));
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
    }
    return String(a).localeCompare(String(b), 'es', { numeric: true });
  });
  if (!vals.length) return;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const multi = document.createElement('div');
  multi.className = 'multi';

  for (const v of vals) {
    const id = `f_${key}_${String(v).replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb  = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = String(v);
    cb.addEventListener('change', () => {
      if (cb.checked) F[key].add(v); else F[key].delete(v);
      applyFilters();
    });
    lab.append(cb, document.createTextNode(' ' + String(v)));
    multi.appendChild(lab);
  }

  group.appendChild(multi);
  container.appendChild(group);
}

// --- Slider dual con inputs editables en los extremos ---
function _buildSlider(key, colName, label, container, step = 1) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v) && v > 0);
  if (!nums.length) return;

  const inv  = 1 / step;
  const dMin = Math.floor(Math.min(...nums) * inv) / inv;
  const dMax = Math.ceil(Math.max(...nums) * inv) / inv;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const wrap = document.createElement('div');
  wrap.className = 'slider-wrap';
  const trackBg = document.createElement('div'); trackBg.className = 'slider-track-bg';
  const fill    = document.createElement('div'); fill.className    = 'slider-fill';

  const sMin = document.createElement('input');
  sMin.type = 'range'; sMin.className = 'dual-range';
  sMin.min = dMin; sMin.max = dMax; sMin.value = dMin; sMin.step = step;

  const sMax = document.createElement('input');
  sMax.type = 'range'; sMax.className = 'dual-range';
  sMax.min = dMin; sMax.max = dMax; sMax.value = dMax; sMax.step = step;

  wrap.append(trackBg, fill, sMin, sMax);

  // Inputs que reemplazan las etiquetas, pegados a los extremos del slider
  const lblRow = document.createElement('div');
  lblRow.className = 'slider-labels';

  const iMin = document.createElement('input');
  iMin.type = 'number'; iMin.className = 'slider-lbl-input';
  iMin.value = dMin; iMin.step = step; iMin.title = 'Mínimo';

  const iMax = document.createElement('input');
  iMax.type = 'number'; iMax.className = 'slider-lbl-input';
  iMax.value = dMax; iMax.step = step; iMax.title = 'Máximo';

  lblRow.append(iMin, iMax);
  group.append(wrap, lblRow);
  container.appendChild(group);

  const ref = { type: 'slider', sMin, sMax, fill, iMin, iMax, colName, curMin: dMin, curMax: dMax, step };
  refs[key] = ref;

  function updateFill() {
    const range = ref.curMax - ref.curMin;
    if (range <= 0) { fill.style.left = '0%'; fill.style.width = '100%'; return; }
    const lo = Math.min(+sMin.value, +sMax.value);
    const hi = Math.max(+sMin.value, +sMax.value);
    fill.style.left  = ((lo - ref.curMin) / range * 100) + '%';
    fill.style.width = ((hi - lo) / range * 100) + '%';
  }
  ref.updateFill = updateFill;
  updateFill();

  const applySlider = debounce(() => {
    const lo = Math.min(+sMin.value, +sMax.value);
    const hi = Math.max(+sMin.value, +sMax.value);
    F[`${key}Min`] = lo <= ref.curMin ? null : lo;
    F[`${key}Max`] = hi >= ref.curMax ? null : hi;
    applyFilters();
  }, 80);

  sMin.addEventListener('input', () => {
    if (+sMin.value > +sMax.value) sMax.value = sMin.value;
    iMin.value = +sMin.value;
    updateFill(); applySlider();
  });
  sMax.addEventListener('input', () => {
    if (+sMax.value < +sMin.value) sMin.value = sMax.value;
    iMax.value = +sMax.value;
    updateFill(); applySlider();
  });

  function commitInput() {
    let lo = iMin.value.trim() === '' ? ref.curMin : Math.max(ref.curMin, Math.min(Number(iMin.value), ref.curMax));
    let hi = iMax.value.trim() === '' ? ref.curMax : Math.max(ref.curMin, Math.min(Number(iMax.value), ref.curMax));
    if (isNaN(lo)) lo = ref.curMin;
    if (isNaN(hi)) hi = ref.curMax;
    if (lo > hi) [lo, hi] = [hi, lo];
    sMin.value = lo; iMin.value = lo;
    sMax.value = hi; iMax.value = hi;
    F[`${key}Min`] = lo <= ref.curMin ? null : lo;
    F[`${key}Max`] = hi >= ref.curMax ? null : hi;
    updateFill();
    applyFilters();
  }

  iMin.addEventListener('blur',    commitInput);
  iMax.addEventListener('blur',    commitInput);
  iMin.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  iMax.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
}

// ============== Aplicar filtros ==============
export function applyFilters() {
  state.filtered = state.raw.filter(row => {
    if (state.search) {
      const hay = Object.values(row).map(v => String(v).toLowerCase()).join(' ');
      if (!hay.includes(state.search)) return false;
    }

    if (F.excludedProyectos.size && cols.proyecto && F.excludedProyectos.has(String(row[cols.proyecto] ?? '').trim())) return false;
    if (F.tipologia.size && cols.tipologia) {
      const rawTipo = row[cols.tipologia];
      if (!F.tipologia.has(rawTipo) && !(F.tipologia.has('S') && String(rawTipo) === '1D')) return false;
    }
    if (F.corredor.size  && cols.corredor  && !F.corredor.has(row[cols.corredor]))  return false;
    if (F.tipo.size        && cols.tipo        && !F.tipo.has(row[cols.tipo]))                       return false;
    if (F.comuna.size      && cols.comuna      && !F.comuna.has(row[cols.comuna]))                   return false;

    if (cols.superficie) {
      const v = Number(row[cols.superficie]);
      if (F.supMin !== null && (isNaN(v) || v < F.supMin)) return false;
      if (F.supMax !== null && (isNaN(v) || v > F.supMax)) return false;
    }
    if (cols.ufm2) {
      const v = Number(row[cols.ufm2]);
      if (F.ufm2Min !== null && (isNaN(v) || v < F.ufm2Min)) return false;
      if (F.ufm2Max !== null && (isNaN(v) || v > F.ufm2Max)) return false;
    }
    if (cols.renta) {
      const v = Number(row[cols.renta]);
      if (F.rentaMin !== null && (isNaN(v) || v < F.rentaMin)) return false;
      if (F.rentaMax !== null && (isNaN(v) || v > F.rentaMax)) return false;
    }
    if (cols.gastos) {
      const v = Number(row[cols.gastos]);
      if (F.gastosMin !== null && (isNaN(v) || v < F.gastosMin)) return false;
      if (F.gastosMax !== null && (isNaN(v) || v > F.gastosMax)) return false;
    }
    return true;
  });

  state.page = 1;
  $('#filterCount').textContent = `${state.filtered.length} / ${state.raw.length}`;

  _updateSliderLimits();

  import('./table.js').then(({ renderTable }) => renderTable()).catch(() => {});
  import('./chart.js').then(({ renderKpis, renderDistrib, renderSupVsRenta, renderProyectos }) => {
    renderKpis();
    const tab = $('.tab.active')?.dataset.tab;
    if (tab === 'distribucion') renderDistrib();
    if (tab === 'svp')          renderSupVsRenta();
    if (tab === 'proyectos')    renderProyectos();
  }).catch(() => {});

  const activeTab = $('.tab.active')?.dataset.tab;
  if (activeTab === 'comparativa') {
    import('./comparativa.js').then(({ renderComparativa }) => renderComparativa()).catch(() => {});
  }
  import('./map.js').then(({ renderMap, updateFilterWidget }) => {
    updateFilterWidget?.();
    if (activeTab === 'mapa') renderMap();
  }).catch(() => {});
}

function _updateSliderLimits() {
  for (const key of ['sup', 'ufm2', 'renta', 'gastos']) {
    const ref = refs[key];
    if (!ref || ref.type !== 'slider') continue;
    const nums = state.filtered.map(r => Number(r[ref.colName])).filter(v => !isNaN(v) && v > 0);
    if (!nums.length) continue;

    const inv    = 1 / ref.step;
    const newMin = Math.floor(Math.min(...nums) * inv) / inv;
    const newMax = Math.ceil(Math.max(...nums) * inv) / inv;

    const noUserFilter = F[`${key}Min`] === null && F[`${key}Max`] === null;
    if (noUserFilter) {
      ref.curMin = newMin; ref.curMax = newMax;
      ref.sMin.min = newMin; ref.sMin.max = newMax; ref.sMin.value = newMin;
      ref.sMax.min = newMin; ref.sMax.max = newMax; ref.sMax.value = newMax;
      if (ref.iMin) ref.iMin.value = newMin;
      if (ref.iMax) ref.iMax.value = newMax;
      ref.updateFill();
    }
  }
}

export function resetFilters() {
  if (state.raw.length === 0) return;
  buildFilters();
  const s = $('#searchInput');
  if (s) { s.value = ''; state.search = ''; }
  applyFilters();
}

// ============== Selección por polígono — exclusión de proyectos ==============

function _saveProySnapshot() {
  _proyHistory.push(new Set(F.excludedProyectos));
}

export function excludeProyectos(names) {
  _saveProySnapshot();
  for (const n of names) F.excludedProyectos.add(n);
  applyFilters();
}

export function keepOnlyProyectos(names) {
  _saveProySnapshot();
  const keepSet = new Set(names.map(String));
  F.excludedProyectos.clear();
  const allProyectos = [...new Set(
    state.raw.map(r => cols.proyecto ? String(r[cols.proyecto] ?? '').trim() : '').filter(Boolean)
  )];
  for (const n of allProyectos) {
    if (!keepSet.has(n)) F.excludedProyectos.add(n);
  }
  applyFilters();
}

export function undoProyectoFilter() {
  if (!_proyHistory.length) return false;
  F.excludedProyectos = _proyHistory.pop();
  applyFilters();
  return _proyHistory.length > 0;
}

export function hasProyectoHistory() {
  return _proyHistory.length > 0;
}

export function getActiveFiltersSummary() {
  const items = [];
  if (F.tipologia.size > 0) {
    items.push({ label: 'Tipología', value: [...F.tipologia].join(', ') });
  }
  for (const { key, label } of [
    { key: 'sup',   label: 'm² útil' },
    { key: 'ufm2',  label: 'UF/m²' },
    { key: 'renta', label: 'Renta UF' },
  ]) {
    const ref = refs[key];
    if (!ref) continue;
    const hasMin = F[`${key}Min`] !== null;
    const hasMax = F[`${key}Max`] !== null;
    if (!hasMin && !hasMax) continue;
    const lo = hasMin ? ref.iMin.value : '—';
    const hi = hasMax ? ref.iMax.value : '—';
    items.push({ label, value: `${lo} – ${hi}` });
  }
  return items;
}
