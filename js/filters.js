import { $, debounce, fmt, norm, fmtTipo } from './utils.js';
import { state } from './data.js';

// ============== Resolución de columnas ==============
function findCol(candidates) {
  return state.columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

let cols = {};

function resolveCols() {
  cols.propietario  = findCol(['propietario', 'owner']);
  cols.edificio     = findCol(['edificio', 'proyecto', 'building']);
  cols.tipologia    = findCol(['tipolog', 'dormitor']);
  cols.superficie   = findCol(['superficie', 'sup. út', 'sup út', 'sup util', 'm² út', 'promedio util', 'util prom', 'prom util', 'util (m']);
  cols.ticket       = findCol(['ticket']);
  cols.ufm2         = findCol(['uf/m', 'uf / m']);
  cols.estado       = findCol(['estado']);
  cols.fechaEntrega = findCol(['fecha entrega', 'entrega']);
}

// ============== Estado de filtros ==============
const F = {
  propietario:  new Set(),
  edificio:     new Set(),
  tipologia:    new Set(),
  supMin: null, supMax: null, supRanges: {},
  ticketMin: null, ticketMax: null,
  ufm2Min: null, ufm2Max: null,
  estado:       new Set(),
  fechaEntrega: new Set(),
};

const refs = {}; // referencias a elementos DOM para actualizaciones dinámicas

const TIPO_ORDER = ['S', '1D', '2D', '3D', '4D'];

// ============== Fecha → Trimestre ==============
function dateToQuarter(val) {
  if (val === '' || val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return `Q${Math.ceil((val.getMonth() + 1) / 3)} ${val.getFullYear()}`;
  }
  const s = String(val).trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === 'INMEDIATA' || u === 'INMEDIATO') return 'Inmediata';
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
  }
  return s;
}

function sortQuarters(a, b) {
  if (a === 'Inmediata') return -1;
  if (b === 'Inmediata') return 1;
  const parse = q => {
    const [qp, yr] = q.split(' ');
    return parseInt(yr) * 10 + parseInt(qp.slice(1));
  };
  try { return parse(a) - parse(b); } catch { return 0; }
}

// ============== Construcción de filtros ==============
export function buildFilters() {
  resolveCols();

  F.propietario.clear(); F.edificio.clear(); F.tipologia.clear();
  F.supMin = F.supMax = F.ticketMin = F.ticketMax = F.ufm2Min = F.ufm2Max = null;
  F.supRanges = {};
  F.estado.clear(); F.fechaEntrega.clear();
  Object.keys(refs).forEach(k => delete refs[k]);

  const container = $('#filtersContainer');
  container.innerHTML = '';

  if (cols.tipologia)    _buildMulti('tipologia',     cols.tipologia,    'Tipología',                                    container, fmtTipo);
  if (cols.superficie && cols.tipologia) _buildSupTipo('sup', cols.superficie, cols.tipologia, '<span class="keep-case">m</span>² útil', container);
  else if (cols.superficie) _buildSlider('sup', cols.superficie, '<span class="keep-case">m</span>² útil', container);
  if (cols.ufm2)         _buildMinMax('ufm2',         cols.ufm2,         'UF/<span class="keep-case">m</span>²',         container);
  if (cols.ticket)       _buildMinMax('ticket',       cols.ticket,       'Ticket UF',                                    container);
  if (cols.edificio)     _buildMulti('edificio',      cols.edificio,     'Edificio',                                     container, fmt, true);
  if (cols.propietario)  _buildMulti('propietario',   cols.propietario,  'Propietario',                                  container);
  if (cols.estado)       _buildMulti('estado',        cols.estado,       'Estado',                                       container);
  if (cols.fechaEntrega) _buildQuarters(container);
}

// --- Multi checkbox ---
function _buildMulti(key, colName, label, container, fmtFn = fmt, searchable = false) {
  const rawVals = [...new Set(
    state.raw.map(r => r[colName]).filter(v => v !== '' && v != null)
  )];
  if (key === 'tipologia' && !rawVals.some(v => String(fmtFn(v)) === 'S')) rawVals.push('S');
  const vals = rawVals.sort((a, b) => {
    if (key === 'tipologia') {
      const fa = String(fmtFn(a)), fb = String(fmtFn(b));
      const ia = TIPO_ORDER.indexOf(fa), ib = TIPO_ORDER.indexOf(fb);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return fa.localeCompare(fb, 'es', { numeric: true });
    }
    return String(fmtFn(a)).localeCompare(String(fmtFn(b)), 'es', { numeric: true });
  });
  if (!vals.length) return;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  if (searchable) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = 'Buscar…'; inp.className = 'filter-search';
    inp.addEventListener('input', () => {
      const q = norm(inp.value);
      for (const lab of multi.children) {
        lab.style.display = norm(lab.textContent).includes(q) ? '' : 'none';
      }
    });
    group.appendChild(inp);
  }

  const multi = document.createElement('div');
  multi.className = 'multi';
  const checkboxes = [];

  for (const v of vals) {
    const id = `f_${key}_${String(v).replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = String(v);
    cb.checked = true;
    cb._realVal = v;
    cb.addEventListener('change', () => {
      const checked = checkboxes.filter(c => c.checked).map(c => c._realVal);
      F[key].clear();
      if (checked.length < vals.length) checked.forEach(val => F[key].add(val));
      applyFilters();
    });
    lab.append(cb, document.createTextNode(' ' + fmtFn(v)));
    multi.appendChild(lab);
    checkboxes.push(cb);
  }

  if (key === 'edificio') {
    refs.edificioCbs  = checkboxes;
    refs.edificioVals = vals;
  }

  group.appendChild(multi);
  container.appendChild(group);
}

// --- Rango por tipología ---
function _buildSupTipo(key, supCol, tipoCol, label, container) {
  const tipoMap = {};
  for (const r of state.raw) {
    const tipo = fmtTipo(r[tipoCol]);
    const v = Number(r[supCol]);
    if (!tipo || isNaN(v) || v <= 0) continue;
    if (!tipoMap[tipo]) tipoMap[tipo] = [];
    tipoMap[tipo].push(v);
  }
  const tipos = Object.keys(tipoMap).sort((a, b) => {
    const ia = TIPO_ORDER.indexOf(a), ib = TIPO_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, 'es', { numeric: true });
  });
  if (!tipos.length) return;

  F.supRanges = {};
  const defaults = {};
  for (const tipo of tipos) {
    const vals = tipoMap[tipo];
    const dMin = Math.floor(Math.min(...vals));
    const dMax = Math.ceil(Math.max(...vals));
    defaults[tipo] = { dMin, dMax };
    F.supRanges[tipo] = { min: null, max: null, dMin, dMax };
  }

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const grid = document.createElement('div');
  grid.className = 'sup-tipo-grid';

  for (const tipo of tipos) {
    const { dMin, dMax } = defaults[tipo];
    const row = document.createElement('div');
    row.className = 'sup-tipo-row';

    const tipoLbl = document.createElement('span');
    tipoLbl.className = 'sup-tipo-label';
    tipoLbl.textContent = tipo;

    const minLbl = document.createElement('span');
    minLbl.className = 'sup-tipo-minmax-label';
    minLbl.textContent = 'min';

    const iMin = document.createElement('input');
    iMin.type = 'number'; iMin.className = 'sup-tipo-input';
    iMin.value = dMin; iMin.step = 1;

    const maxLbl = document.createElement('span');
    maxLbl.className = 'sup-tipo-minmax-label';
    maxLbl.textContent = 'max';

    const iMax = document.createElement('input');
    iMax.type = 'number'; iMax.className = 'sup-tipo-input';
    iMax.value = dMax; iMax.step = 1;

    row.append(tipoLbl, minLbl, iMin, maxLbl, iMax);
    grid.appendChild(row);

    const onChange = debounce(() => {
      const lo = iMin.value.trim() === '' ? null : Number(iMin.value);
      const hi = iMax.value.trim() === '' ? null : Number(iMax.value);
      F.supRanges[tipo].min = lo;
      F.supRanges[tipo].max = hi;
      applyFilters();
    }, 250);
    iMin.addEventListener('input', onChange);
    iMax.addEventListener('input', onChange);
    iMin.addEventListener('blur', () => { if (iMin.value.trim() === '') { iMin.value = dMin; F.supRanges[tipo].min = null; applyFilters(); } });
    iMax.addEventListener('blur', () => { if (iMax.value.trim() === '') { iMax.value = dMax; F.supRanges[tipo].max = null; applyFilters(); } });
    iMin.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    iMax.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  }

  group.appendChild(grid);
  container.appendChild(group);
  refs[key] = { type: 'tipo-range', colName: supCol };
}

// --- Min / Max inputs simples ---
function _buildMinMax(key, colName, label, container) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v));
  if (!nums.length) return;
  const dMin = Math.floor(Math.min(...nums));
  const dMax = Math.ceil(Math.max(...nums));

  const fmtNum = v => Math.round(v).toLocaleString('es-CL');
  const parseNum = s => { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return isNaN(n) ? null : n; };

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const row = document.createElement('div');
  row.className = 'sup-tipo-row';

  const minLbl = document.createElement('span');
  minLbl.className = 'sup-tipo-minmax-label';
  minLbl.textContent = 'min';

  const iMin = document.createElement('input');
  iMin.type = 'text'; iMin.className = 'sup-tipo-input minmax-wide';
  iMin.value = fmtNum(dMin);

  const maxLbl = document.createElement('span');
  maxLbl.className = 'sup-tipo-minmax-label';
  maxLbl.textContent = 'max';

  const iMax = document.createElement('input');
  iMax.type = 'text'; iMax.className = 'sup-tipo-input minmax-wide';
  iMax.value = fmtNum(dMax);

  row.append(minLbl, iMin, maxLbl, iMax);
  group.appendChild(row);
  container.appendChild(group);

  refs[key] = { type: 'minmax', inMin: iMin, inMax: iMax, colName, dMin, dMax, fmtNum };

  const onChange = debounce(() => {
    F[`${key}Min`] = parseNum(iMin.value);
    F[`${key}Max`] = parseNum(iMax.value);
    applyFilters();
  }, 350);
  iMin.addEventListener('input', onChange);
  iMax.addEventListener('input', onChange);
  iMin.addEventListener('blur', () => {
    const n = parseNum(iMin.value);
    if (n === null) { iMin.value = fmtNum(refs[key].dMin); F[`${key}Min`] = null; applyFilters(); }
    else iMin.value = fmtNum(n);
  });
  iMax.addEventListener('blur', () => {
    const n = parseNum(iMax.value);
    if (n === null) { iMax.value = fmtNum(refs[key].dMax); F[`${key}Max`] = null; applyFilters(); }
    else iMax.value = fmtNum(n);
  });
  iMin.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  iMax.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
}

// --- Slider dual ---
function _buildSlider(key, colName, label, container) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v));
  if (!nums.length) return;
  const dMin = Math.floor(Math.min(...nums)), dMax = Math.ceil(Math.max(...nums));

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  // Track + fill
  const wrap = document.createElement('div');
  wrap.className = 'slider-wrap';

  const trackBg = document.createElement('div');
  trackBg.className = 'slider-track-bg';

  const fill = document.createElement('div');
  fill.className = 'slider-fill';

  const sMin = document.createElement('input');
  sMin.type = 'range'; sMin.className = 'dual-range';
  sMin.min = dMin; sMin.max = dMax; sMin.value = dMin; sMin.step = 1;

  const sMax = document.createElement('input');
  sMax.type = 'range'; sMax.className = 'dual-range';
  sMax.min = dMin; sMax.max = dMax; sMax.value = dMax; sMax.step = 1;

  wrap.append(trackBg, fill, sMin, sMax);

  // Etiquetas de valor
  const lblRow = document.createElement('div');
  lblRow.className = 'slider-labels';
  const lblMin = document.createElement('span'); lblMin.textContent = fmt(dMin);
  const lblMax = document.createElement('span'); lblMax.textContent = fmt(dMax);
  lblRow.append(lblMin, lblMax);

  group.append(wrap, lblRow);
  container.appendChild(group);

  const ref = { type: 'slider', sMin, sMax, fill, lblMin, lblMax, colName, curMin: dMin, curMax: dMax };
  refs[key] = ref;

  function updateFill() {
    const range = ref.curMax - ref.curMin;
    if (range === 0) { fill.style.left = '0%'; fill.style.width = '100%'; return; }
    const lo = Math.min(+sMin.value, +sMax.value);
    const hi = Math.max(+sMin.value, +sMax.value);
    const loPct = (lo - ref.curMin) / range * 100;
    const hiPct = (hi - ref.curMin) / range * 100;
    fill.style.left  = loPct + '%';
    fill.style.width = (hiPct - loPct) + '%';
    lblMin.textContent = fmt(lo);
    lblMax.textContent = fmt(hi);
  }

  ref.updateFill = updateFill;
  updateFill();

  const apply = debounce(() => {
    const lo = Math.min(+sMin.value, +sMax.value);
    const hi = Math.max(+sMin.value, +sMax.value);
    F[`${key}Min`] = lo <= ref.curMin ? null : lo;
    F[`${key}Max`] = hi >= ref.curMax ? null : hi;
    applyFilters();
  }, 80);

  sMin.addEventListener('input', () => {
    if (+sMin.value > +sMax.value) sMax.value = sMin.value;
    updateFill(); apply();
  });
  sMax.addEventListener('input', () => {
    if (+sMax.value < +sMin.value) sMin.value = sMax.value;
    updateFill(); apply();
  });
}

// --- Fecha de entrega por trimestre ---
function _buildQuarters(container) {
  const colName = cols.fechaEntrega;
  const quarterMap = new Map();

  for (const r of state.raw) {
    const v = r[colName];
    if (v === '' || v == null) continue;
    const q = dateToQuarter(v);
    if (!q) continue;
    if (!quarterMap.has(q)) quarterMap.set(q, []);
    quarterMap.get(q).push(v);
  }
  if (!quarterMap.size) return;
  refs.quarterMap = quarterMap;

  const quarters = [...quarterMap.keys()].sort(sortQuarters);

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">Fecha de entrega</label>`;

  const multi = document.createElement('div');
  multi.className = 'multi';

  const qCheckboxes = [];
  for (const q of quarters) {
    const id = `f_fecha_${q.replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = q;
    cb.checked = true;
    cb.addEventListener('change', () => {
      const checked = qCheckboxes.filter(c => c.checked).map(c => c.value);
      F.fechaEntrega.clear();
      if (checked.length < quarters.length) checked.forEach(val => F.fechaEntrega.add(val));
      applyFilters();
    });
    lab.append(cb, document.createTextNode(' ' + q));
    multi.appendChild(lab);
    qCheckboxes.push(cb);
  }

  group.appendChild(multi);
  container.appendChild(group);
}

// ============== Aplicar filtros ==============
export function applyFilters() {
  state.filtered = state.raw.filter(row => {
    if (state.search) {
      const hay = Object.values(row).map(v => String(v).toLowerCase()).join(' ');
      if (!hay.includes(state.search)) return false;
    }
    if (F.propietario.size  && cols.propietario  && !F.propietario.has(row[cols.propietario]))   return false;
    if (F.edificio.size     && cols.edificio     && !F.edificio.has(row[cols.edificio]))         return false;
    if (F.tipologia.size && cols.tipologia) {
      const rawTipo = row[cols.tipologia];
      if (!F.tipologia.has(rawTipo) && !(F.tipologia.has('S') && fmtTipo(rawTipo) === '1D')) return false;
    }
    if (cols.superficie) {
      if (Object.keys(F.supRanges).length) {
        const tipo = cols.tipologia ? fmtTipo(row[cols.tipologia]) : null;
        const range = tipo ? F.supRanges[tipo] : null;
        if (range) {
          const v = Number(row[cols.superficie]);
          if (range.min !== null && (isNaN(v) || v < range.min)) return false;
          if (range.max !== null && (isNaN(v) || v > range.max)) return false;
        }
      } else {
        const v = Number(row[cols.superficie]);
        if (F.supMin !== null && (isNaN(v) || v < F.supMin)) return false;
        if (F.supMax !== null && (isNaN(v) || v > F.supMax)) return false;
      }
    }
    if (cols.ticket) {
      const v = Number(row[cols.ticket]);
      if (F.ticketMin !== null && (isNaN(v) || v < F.ticketMin)) return false;
      if (F.ticketMax !== null && (isNaN(v) || v > F.ticketMax)) return false;
    }
    if (cols.ufm2) {
      const v = Number(row[cols.ufm2]);
      if (F.ufm2Min !== null && (isNaN(v) || v < F.ufm2Min)) return false;
      if (F.ufm2Max !== null && (isNaN(v) || v > F.ufm2Max)) return false;
    }
    if (F.estado.size && cols.estado && !F.estado.has(row[cols.estado])) return false;
    if (F.fechaEntrega.size && cols.fechaEntrega) {
      const q = dateToQuarter(row[cols.fechaEntrega]);
      if (!F.fechaEntrega.has(q)) return false;
    }
    return true;
  });

  state.page = 1;
  $('#filterCount').textContent = `${state.filtered.length} / ${state.raw.length}`;

  _updateRangeLimits();

  import('./table.js').then(({ renderTable }) => renderTable());
  import('./chart.js').then(({ renderKpis, renderDistrib, renderSupVsPrecio, renderProyectos }) => {
    renderKpis();
    const tab = $('.tab.active')?.dataset.tab;
    if (tab === 'distribucion') renderDistrib();
    if (tab === 'svp')          renderSupVsPrecio();
    if (tab === 'proyectos')    renderProyectos();
  });
  const activeTab = $('.tab.active')?.dataset.tab;
  if (activeTab === 'comparativa') {
    import('./comparativa.js').then(({ renderComparativa }) => renderComparativa());
  }
  import('./map.js').then(({ renderMap, updateFilterWidget }) => {
    updateFilterWidget?.();
    if (activeTab === 'mapa') renderMap();
  });
}

// Actualiza los límites dinámicamente al cambiar otros filtros
function _updateRangeLimits() {
  for (const key of ['sup', 'ticket', 'ufm2']) {
    const ref = refs[key];
    if (!ref) continue;

    const nums = state.filtered.map(r => Number(r[ref.colName])).filter(v => !isNaN(v));
    if (!nums.length) continue;
    const newMin = Math.floor(Math.min(...nums));
    const newMax = Math.ceil(Math.max(...nums));

    if (ref.type === 'tipo-range') continue;
    if (ref.type === 'slider') {
      const noUserFilter = F[`${key}Min`] === null && F[`${key}Max`] === null;
      if (noUserFilter) {
        ref.curMin = newMin; ref.curMax = newMax;
        ref.sMin.min = newMin; ref.sMin.max = newMax; ref.sMin.value = newMin;
        ref.sMax.min = newMin; ref.sMax.max = newMax; ref.sMax.value = newMax;
        ref.updateFill();
      }
    } else if (ref.type === 'minmax') {
      if (F[`${key}Min`] === null) { ref.inMin.value = ref.fmtNum(newMin); ref.dMin = newMin; }
      if (F[`${key}Max`] === null) { ref.inMax.value = ref.fmtNum(newMax); ref.dMax = newMax; }
    } else {
      if (!ref.inMin.value) ref.inMin.placeholder = String(newMin);
      if (!ref.inMax.value) ref.inMax.placeholder = String(newMax);
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

// ============== Manipulación programática del filtro Edificio ==============
const _edificioHistory = [];

function _saveEdificioSnapshot() {
  if (!refs.edificioCbs) return;
  _edificioHistory.push(refs.edificioCbs.map(cb => cb.checked));
}

function _syncEdificioFilter() {
  const cbs  = refs.edificioCbs;
  const vals = refs.edificioVals ?? [];
  if (!cbs) return;
  const checked = cbs.filter(c => c.checked).map(c => c._realVal);
  F.edificio.clear();
  if (checked.length < vals.length) checked.forEach(v => F.edificio.add(v));
  applyFilters();
}

export function excludeEdificios(names) {
  const cbs = refs.edificioCbs;
  if (!cbs) return;
  _saveEdificioSnapshot();
  const toExclude = new Set(names.map(String));
  for (const cb of cbs) {
    if (toExclude.has(String(cb._realVal))) cb.checked = false;
  }
  _syncEdificioFilter();
}

export function keepOnlyEdificios(names) {
  const cbs = refs.edificioCbs;
  if (!cbs) return;
  _saveEdificioSnapshot();
  const toKeep = new Set(names.map(String));
  for (const cb of cbs) {
    cb.checked = toKeep.has(String(cb._realVal));
  }
  _syncEdificioFilter();
}

export function undoEdificioFilter() {
  if (!_edificioHistory.length || !refs.edificioCbs) return false;
  const prev = _edificioHistory.pop();
  refs.edificioCbs.forEach((cb, i) => { cb.checked = prev[i]; });
  _syncEdificioFilter();
  return _edificioHistory.length > 0;
}

export function hasEdificioHistory() {
  return _edificioHistory.length > 0;
}

// Devuelve el Set de valores crudos seleccionados en el filtro de tipología (vacío = sin filtro activo)
export function getActiveTipoFilter() {
  return F.tipologia;
}

// ============== Export / Import de filtros ==============

export function getFilterState() {
  return {
    multi: {
      tipologia:    [...F.tipologia],
      propietario:  [...F.propietario],
      edificio:     [...F.edificio],
      estado:       [...F.estado],
      fechaEntrega: [...F.fechaEntrega],
    },
    ranges: {
      sup:    { min: F.supMin,    max: F.supMax },
      ticket: { min: F.ticketMin, max: F.ticketMax },
      ufm2:   { min: F.ufm2Min,  max: F.ufm2Max },
    },
    supRanges: Object.fromEntries(
      Object.entries(F.supRanges).map(([k, v]) => [k, { min: v.min, max: v.max }])
    ),
  };
}

export function applyFilterState(data) {
  if (!data) return;

  for (const [key, values] of Object.entries(data.multi ?? {})) {
    if (!(key in F) || !(F[key] instanceof Set)) continue;
    const cbs = [...document.querySelectorAll(`input[type="checkbox"][id^="f_${key}_"]`)];
    if (!cbs.length) continue;
    const valueSet = new Set(values.map(String));
    F[key].clear();
    for (const cb of cbs) {
      cb.checked = valueSet.size === 0 || valueSet.has(cb.value);
      if (cb.checked && valueSet.size > 0) F[key].add(cb._realVal ?? cb.value);
    }
  }

  for (const [key, range] of Object.entries(data.ranges ?? {})) {
    F[`${key}Min`] = range.min ?? null;
    F[`${key}Max`] = range.max ?? null;
    const ref = refs[key];
    if (!ref) continue;
    if (ref.type === 'slider') {
      if (range.min != null) { ref.sMin.value = range.min; }
      if (range.max != null) { ref.sMax.value = range.max; }
      ref.updateFill?.();
    } else if (ref.type === 'minmax') {
      if (range.min != null) ref.inMin.value = ref.fmtNum(range.min);
      else ref.inMin.value = ref.fmtNum(ref.dMin);
      if (range.max != null) ref.inMax.value = ref.fmtNum(range.max);
      else ref.inMax.value = ref.fmtNum(ref.dMax);
    }
  }

  for (const [tipo, range] of Object.entries(data.supRanges ?? {})) {
    if (!F.supRanges[tipo]) continue;
    F.supRanges[tipo].min = range.min ?? null;
    F.supRanges[tipo].max = range.max ?? null;
    const rows = document.querySelectorAll('.sup-tipo-row');
    for (const row of rows) {
      const lbl = row.querySelector('.sup-tipo-label');
      if (!lbl || lbl.textContent.trim() !== tipo) continue;
      const [iMin, iMax] = row.querySelectorAll('.sup-tipo-input');
      if (iMin && range.min != null) iMin.value = range.min;
      if (iMax && range.max != null) iMax.value = range.max;
    }
  }

  applyFilters();
}

export function getActiveFiltersSummary() {
  const items = [];

  if (F.tipologia.size > 0)
    items.push({ label: 'Tipología', value: [...F.tipologia].map(fmtTipo).join(', ') });

  if (Object.keys(F.supRanges).length) {
    for (const [tipo, range] of Object.entries(F.supRanges)) {
      if (range.min !== null || range.max !== null) {
        const lo = range.min ?? range.dMin;
        const hi = range.max ?? range.dMax;
        items.push({ label: `m² ${tipo}`, value: `${lo} – ${hi}` });
      }
    }
  } else if (F.supMin !== null || F.supMax !== null) {
    const ref = refs.sup;
    const lo  = ref ? ref.lblMin.textContent : String(F.supMin ?? '—');
    const hi  = ref ? ref.lblMax.textContent : String(F.supMax ?? '—');
    items.push({ label: 'm² útil', value: `${lo} – ${hi}` });
  }

  const sliders = [
    { key: 'ufm2',   label: 'UF/m²',     minKey: 'ufm2Min',   maxKey: 'ufm2Max'   },
    { key: 'ticket', label: 'Ticket UF', minKey: 'ticketMin', maxKey: 'ticketMax' },
  ];
  for (const s of sliders) {
    if (F[s.minKey] !== null || F[s.maxKey] !== null) {
      const ref = refs[s.key];
      let lo, hi;
      if (ref?.type === 'minmax') {
        lo = ref.fmtNum(F[s.minKey] ?? ref.dMin);
        hi = ref.fmtNum(F[s.maxKey] ?? ref.dMax);
      } else {
        lo = ref ? ref.lblMin.textContent : String(F[s.minKey] ?? '—');
        hi = ref ? ref.lblMax.textContent : String(F[s.maxKey] ?? '—');
      }
      items.push({ label: s.label, value: `${lo} – ${hi}` });
    }
  }
  return items;
}
