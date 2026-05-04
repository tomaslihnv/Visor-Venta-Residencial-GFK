import { $, debounce, fmt } from './utils.js';
import { state } from './data.js';

// ============== Resolución de columnas ==============
function findCol(candidates) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
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
  supMin: null, supMax: null,
  ticketMin: null, ticketMax: null,
  ufm2Min: null, ufm2Max: null,
  estado:       new Set(),
  fechaEntrega: new Set(),
};

const refs = {}; // referencias a elementos DOM para actualizaciones dinámicas

// ============== Helpers de formato ==============
function fmtTipo(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10) return `${v}D`;
  const s = String(v).trim();
  if (/^\d+$/.test(s) && +s > 0 && +s <= 10) return `${s}D`;
  return s;
}

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
  F.estado.clear(); F.fechaEntrega.clear();
  Object.keys(refs).forEach(k => delete refs[k]);

  const container = $('#filtersContainer');
  container.innerHTML = '';

  if (cols.tipologia)    _buildMulti('tipologia',     cols.tipologia,    'Tipología',                                    container, fmtTipo);
  if (cols.superficie)   _buildSlider('sup',          cols.superficie,   '<span class="keep-case">m</span>² útil',       container);
  if (cols.ufm2)         _buildSlider('ufm2',         cols.ufm2,         'UF/<span class="keep-case">m</span>²',         container);
  if (cols.ticket)       _buildSlider('ticket',       cols.ticket,       'Ticket UF',                                    container);
  if (cols.propietario)  _buildMulti('propietario',   cols.propietario,  'Propietario',                                  container);
  if (cols.edificio)     _buildMulti('edificio',      cols.edificio,     'Edificio',                                     container);
  if (cols.estado)       _buildMulti('estado',        cols.estado,       'Estado',                                       container);
  if (cols.fechaEntrega) _buildQuarters(container);
}

// --- Multi checkbox ---
function _buildMulti(key, colName, label, container, fmtFn = fmt) {
  const vals = [...new Set(
    state.raw.map(r => r[colName]).filter(v => v !== '' && v != null)
  )].sort((a, b) => String(fmtFn(a)).localeCompare(String(fmtFn(b)), 'es', { numeric: true }));
  if (!vals.length) return;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const multi = document.createElement('div');
  multi.className = 'multi';

  for (const v of vals) {
    const id = `f_${key}_${String(v).replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = String(v);
    cb.addEventListener('change', () => {
      if (cb.checked) F[key].add(v); else F[key].delete(v);
      applyFilters();
    });
    lab.append(cb, document.createTextNode(' ' + fmtFn(v)));
    multi.appendChild(lab);
  }

  group.appendChild(multi);
  container.appendChild(group);
}

// --- Rango simple (siempre visible) ---
function _buildRange(key, colName, label, unit, container) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v));
  if (!nums.length) return;
  const dMin = Math.floor(Math.min(...nums)), dMax = Math.ceil(Math.max(...nums));

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${label}</label>`;

  const row = document.createElement('div');
  row.className = 'range-row';

  const inMin = document.createElement('input');
  inMin.type = 'number'; inMin.placeholder = String(dMin);
  const inMax = document.createElement('input');
  inMax.type = 'number'; inMax.placeholder = String(dMax);

  const sep = document.createElement('span'); sep.textContent = '—';
  row.append(inMin, sep, inMax);
  if (unit) {
    const u = document.createElement('span'); u.className = 'range-unit'; u.textContent = unit;
    row.append(u);
  }
  group.appendChild(row);
  container.appendChild(group);

  refs[key] = { type: 'range', inMin, inMax, colName };

  const onChange = debounce(() => {
    F[`${key}Min`] = inMin.value === '' ? null : Number(inMin.value);
    F[`${key}Max`] = inMax.value === '' ? null : Number(inMax.value);
    applyFilters();
  }, 250);
  inMin.addEventListener('input', onChange);
  inMax.addEventListener('input', onChange);
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

  for (const q of quarters) {
    const id = `f_fecha_${q.replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = q;
    cb.addEventListener('change', () => {
      if (cb.checked) F.fechaEntrega.add(q); else F.fechaEntrega.delete(q);
      applyFilters();
    });
    lab.append(cb, document.createTextNode(' ' + q));
    multi.appendChild(lab);
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
    if (F.tipologia.size    && cols.tipologia    && !F.tipologia.has(row[cols.tipologia]))       return false;
    if (cols.superficie) {
      const v = Number(row[cols.superficie]);
      if (F.supMin !== null && (isNaN(v) || v < F.supMin)) return false;
      if (F.supMax !== null && (isNaN(v) || v > F.supMax)) return false;
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
  import('./chart.js').then(({ renderKpis, renderChart, renderDistrib }) => {
    renderKpis();
    const tab = $('.tab.active')?.dataset.tab;
    if (tab === 'grafico')      renderChart();
    if (tab === 'distribucion') renderDistrib();
  });
  if ($('.tab.active')?.dataset.tab === 'mapa') {
    import('./map.js').then(({ renderMap }) => renderMap());
  }
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

    if (ref.type === 'slider') {
      const noUserFilter = F[`${key}Min`] === null && F[`${key}Max`] === null;
      if (noUserFilter) {
        ref.curMin = newMin; ref.curMax = newMax;
        ref.sMin.min = newMin; ref.sMin.max = newMax; ref.sMin.value = newMin;
        ref.sMax.min = newMin; ref.sMax.max = newMax; ref.sMax.value = newMax;
        ref.updateFill();
      }
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
