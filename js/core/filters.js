import { norm, debounce } from './utils.js';

function _findCol(candidates, columns) {
  return columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

// ── Build UI ───────────────────────────────────────────────────────────────

export function buildFilters(filterDefs, state, container, onChange) {
  // Store on state so event handlers can access without extra closure
  state._filterDefs = filterDefs;
  state._onChange   = onChange;
  state.filterValues = {};
  state.filterRefs   = {};
  state.filterCols   = {};

  container.innerHTML = '';

  for (const def of filterDefs) {
    const colName = _findCol(def.candidates, state.columns);
    if (!colName) continue;
    state.filterCols[def.key] = colName;

    if (def.type === 'multi') {
      state.filterValues[def.key] = new Set();
      _buildMulti(def, colName, state, container);
    } else if (def.type === 'slider') {
      state.filterValues[def.key + 'Min'] = null;
      state.filterValues[def.key + 'Max'] = null;
      _buildSlider(def, colName, state, container);
    }
  }
}

function _buildMulti(def, colName, state, container) {
  const vals = [...new Set(
    state.raw.map(r => r[colName]).filter(v => v !== '' && v != null)
  )].sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
  if (!vals.length) return;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${def.label}</label>`;

  const multi = document.createElement('div');
  multi.className = 'multi';

  for (const v of vals) {
    const id  = `f_${def.key}_${String(v).replace(/\W+/g, '_')}`;
    const lab = document.createElement('label');
    const cb  = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = String(v);
    cb.addEventListener('change', () => {
      if (cb.checked) state.filterValues[def.key].add(v);
      else            state.filterValues[def.key].delete(v);
      _applyAndNotify(state);
    });
    lab.append(cb, document.createTextNode(' ' + String(v)));
    multi.appendChild(lab);
  }

  group.appendChild(multi);
  container.appendChild(group);
}

function _buildSlider(def, colName, state, container) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v) && v > 0);
  if (!nums.length) return;

  const step = def.step ?? 1;
  const inv  = 1 / step;
  const dMin = Math.floor(Math.min(...nums) * inv) / inv;
  const dMax = Math.ceil(Math.max(...nums)  * inv) / inv;

  const group = document.createElement('div');
  group.className = 'filter-group';
  group.innerHTML = `<label class="title">${def.label}</label>`;

  const wrap    = document.createElement('div'); wrap.className = 'slider-wrap';
  const trackBg = document.createElement('div'); trackBg.className = 'slider-track-bg';
  const fill    = document.createElement('div'); fill.className    = 'slider-fill';

  const sMin = document.createElement('input');
  sMin.type = 'range'; sMin.className = 'dual-range';
  sMin.min = dMin; sMin.max = dMax; sMin.value = dMin; sMin.step = step;

  const sMax = document.createElement('input');
  sMax.type = 'range'; sMax.className = 'dual-range';
  sMax.min = dMin; sMax.max = dMax; sMax.value = dMax; sMax.step = step;

  wrap.append(trackBg, fill, sMin, sMax);

  const lblRow = document.createElement('div'); lblRow.className = 'slider-labels';
  const iMin   = document.createElement('input');
  iMin.type = 'number'; iMin.className = 'slider-lbl-input'; iMin.value = dMin; iMin.step = step; iMin.title = 'Mínimo';
  const iMax   = document.createElement('input');
  iMax.type = 'number'; iMax.className = 'slider-lbl-input'; iMax.value = dMax; iMax.step = step; iMax.title = 'Máximo';
  lblRow.append(iMin, iMax);

  group.append(wrap, lblRow);
  container.appendChild(group);

  const ref = { type: 'slider', sMin, sMax, fill, iMin, iMax, colName, curMin: dMin, curMax: dMax, step };
  state.filterRefs[def.key] = ref;

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
    state.filterValues[def.key + 'Min'] = lo <= ref.curMin ? null : lo;
    state.filterValues[def.key + 'Max'] = hi >= ref.curMax ? null : hi;
    _applyAndNotify(state);
  }, 80);

  sMin.addEventListener('input', () => {
    if (+sMin.value > +sMax.value) sMax.value = sMin.value;
    iMin.value = +sMin.value; updateFill(); applySlider();
  });
  sMax.addEventListener('input', () => {
    if (+sMax.value < +sMin.value) sMin.value = sMax.value;
    iMax.value = +sMax.value; updateFill(); applySlider();
  });

  function commitInput() {
    let lo = iMin.value.trim() === '' ? ref.curMin : Math.max(ref.curMin, Math.min(Number(iMin.value), ref.curMax));
    let hi = iMax.value.trim() === '' ? ref.curMax : Math.max(ref.curMin, Math.min(Number(iMax.value), ref.curMax));
    if (isNaN(lo)) lo = ref.curMin;
    if (isNaN(hi)) hi = ref.curMax;
    if (lo > hi) [lo, hi] = [hi, lo];
    sMin.value = lo; iMin.value = lo;
    sMax.value = hi; iMax.value = hi;
    state.filterValues[def.key + 'Min'] = lo <= ref.curMin ? null : lo;
    state.filterValues[def.key + 'Max'] = hi >= ref.curMax ? null : hi;
    updateFill();
    _applyAndNotify(state);
  }
  iMin.addEventListener('blur',    commitInput);
  iMax.addEventListener('blur',    commitInput);
  iMin.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  iMax.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
}

// ── Apply ──────────────────────────────────────────────────────────────────

function _applyAndNotify(state) {
  _applyRaw(state);
  state._onChange?.(state);
}

function _applyRaw(state) {
  const defs = state._filterDefs ?? [];
  state.filtered = state.raw.filter(row => {
    if (state.search) {
      const hay = Object.values(row).map(v => String(v).toLowerCase()).join(' ');
      if (!hay.includes(state.search)) return false;
    }
    if (state.excludedProjects?.size && state._projCol) {
      if (state.excludedProjects.has(String(row[state._projCol] ?? '').trim())) return false;
    }
    for (const def of defs) {
      const colName = state.filterCols[def.key];
      if (!colName) continue;
      if (def.type === 'multi') {
        const set = state.filterValues[def.key];
        if (set?.size && !set.has(row[colName])) return false;
      } else if (def.type === 'slider') {
        const v   = Number(row[colName]);
        const min = state.filterValues[def.key + 'Min'];
        const max = state.filterValues[def.key + 'Max'];
        if (min !== null && (isNaN(v) || v < min)) return false;
        if (max !== null && (isNaN(v) || v > max)) return false;
      }
    }
    return true;
  });
  state.page = 1;
  const el = document.getElementById('filterCount');
  if (el) el.textContent = `${state.filtered.length} / ${state.raw.length}`;
  _updateSliderLimits(state);
}

export function applyFilters(filterDefs, state, onChange) {
  state._filterDefs = filterDefs;
  if (onChange) state._onChange = onChange;
  _applyAndNotify(state);
}

export function reapplyFilters(state) {
  _applyAndNotify(state);
}

export function getFilterState(state) {
  const multi  = {};
  const slider = {};
  for (const def of (state._filterDefs ?? [])) {
    if (def.type === 'multi') {
      multi[def.key] = [...(state.filterValues[def.key] ?? [])];
    } else if (def.type === 'slider') {
      slider[def.key] = {
        min: state.filterValues[def.key + 'Min'] ?? null,
        max: state.filterValues[def.key + 'Max'] ?? null,
      };
    }
  }
  const excludedProyectos = state.excludedProjects?.size > 0
    ? [...state.excludedProjects]
    : null;
  return { multi, slider, excludedProyectos };
}

export function applyFilterState(data, state) {
  if (!data) return;

  for (const [key, values] of Object.entries(data.multi ?? {})) {
    const set = state.filterValues[key];
    if (!(set instanceof Set)) continue;
    const cbs = [...document.querySelectorAll(`input[type="checkbox"][id^="f_${key}_"]`)];
    if (!cbs.length) continue;
    const valueSet = new Set(values.map(String));
    set.clear();
    for (const cb of cbs) {
      cb.checked = valueSet.size === 0 || valueSet.has(cb.value);
      if (cb.checked && valueSet.size > 0) set.add(cb.value);
    }
  }

  for (const [key, range] of Object.entries(data.slider ?? {})) {
    const ref = state.filterRefs?.[key];
    state.filterValues[key + 'Min'] = range.min ?? null;
    state.filterValues[key + 'Max'] = range.max ?? null;
    if (!ref || ref.type !== 'slider') continue;
    const lo = range.min ?? ref.curMin;
    const hi = range.max ?? ref.curMax;
    ref.sMin.value = lo; if (ref.iMin) ref.iMin.value = lo;
    ref.sMax.value = hi; if (ref.iMax) ref.iMax.value = hi;
    ref.updateFill?.();
  }

  if (Array.isArray(data.excludedProyectos) && data.excludedProyectos.length > 0) {
    state.excludedProjects = new Set(data.excludedProyectos.map(String));
  } else if (data.excludedProyectos === null) {
    state.excludedProjects = new Set();
  }

  _applyAndNotify(state);
}

export function resetFilters(filterDefs, state, container, onChange) {
  if (!state.raw.length) return;
  buildFilters(filterDefs, state, container, onChange);
  const s = document.getElementById('searchInput');
  if (s) { s.value = ''; state.search = ''; }
  _applyAndNotify(state);
}

// ── Slider limit update ────────────────────────────────────────────────────

function _updateSliderLimits(state) {
  for (const [key, ref] of Object.entries(state.filterRefs ?? {})) {
    if (ref.type !== 'slider') continue;
    const nums = state.filtered.map(r => Number(r[ref.colName])).filter(v => !isNaN(v) && v > 0);
    if (!nums.length) continue;

    const inv    = 1 / ref.step;
    const newMin = Math.floor(Math.min(...nums) * inv) / inv;
    const newMax = Math.ceil(Math.max(...nums)  * inv) / inv;

    const noUserFilter = state.filterValues[key + 'Min'] === null && state.filterValues[key + 'Max'] === null;
    if (noUserFilter) {
      ref.curMin = newMin; ref.curMax = newMax;
      ref.sMin.min = newMin; ref.sMin.max = newMax; ref.sMin.value = newMin;
      ref.sMax.min = newMin; ref.sMax.max = newMax; ref.sMax.value = newMax;
      if (ref.iMin) ref.iMin.value = newMin;
      if (ref.iMax) ref.iMax.value = newMax;
      ref.updateFill?.();
    }
  }
}
