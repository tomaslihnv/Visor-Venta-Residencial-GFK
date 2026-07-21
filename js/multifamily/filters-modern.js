// ── Panel de filtros moderno (Multifamily) ──────────────────────────────────
// Mismo motor de filtrado que js/core/filters.js (misma firma de funciones,
// mismas estructuras state.filterValues/state.filterRefs, mismo algoritmo de
// _applyRaw) — solo cambia CÓMO se dibujan los controles: Shoelace (sl-select
// multi con búsqueda, sl-details colapsables, sl-tag para chips) + noUiSlider
// para los rangos, en vez de checkboxes/<input type="range"> nativos.
//
// Aislado del resto de los visores a propósito: js/core/filters.js (usado
// por oficinas, suelos, stripcenters, parquesindustriales, bodegas) queda
// sin tocar. Si este patrón resulta, se puede promover a core/ más adelante.

import { norm, debounce } from '../core/utils.js';

function _findCol(candidates, columns) {
  return columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

// ── Build UI ───────────────────────────────────────────────────────────────

export function buildFilters(filterDefs, state, container, onChange) {
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

  _renderActiveChips(state);
}

function _buildMulti(def, colName, state, container) {
  const vals = [...new Set(
    state.raw.map(r => r[colName]).filter(v => v !== '' && v != null)
  )].sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
  if (!vals.length) return;

  const details = document.createElement('sl-details');
  details.className = 'filter-group-modern';
  details.setAttribute('summary', def.label);
  details.open = true;

  // Shoelace arma el summary por slot si no se usa el atributo summary con
  // texto simple queremos poder mostrar el badge de "seleccionados" al lado.
  const summarySlot = document.createElement('div');
  summarySlot.slot = 'summary';
  summarySlot.className = 'filter-group-summary';
  summarySlot.innerHTML = `<span>${def.label}</span>`;
  const countBadge = document.createElement('sl-badge');
  countBadge.setAttribute('variant', 'neutral');
  countBadge.setAttribute('pill', '');
  countBadge.className = 'filter-group-count hidden';
  summarySlot.appendChild(countBadge);
  details.removeAttribute('summary');
  details.appendChild(summarySlot);

  const search = document.createElement('sl-input');
  search.setAttribute('placeholder', 'Buscar…');
  search.setAttribute('size', 'small');
  search.setAttribute('clearable', '');
  search.className = 'filter-search';

  // Lista de checkboxes siempre visible (no un dropdown que hay que abrir
  // para ver/cambiar cada valor) — igual que el panel anterior, solo que
  // con sl-checkbox en vez de <input type="checkbox"> nativo. El valor real
  // se guarda como propiedad JS (cb._realVal), no como atributo value, así
  // que no hay que lidiar con la normalización de espacios de sl-option.
  const list = document.createElement('div');
  list.className = 'multi-checkbox-list';

  const checkboxes = [];
  for (const v of vals) {
    const cb = document.createElement('sl-checkbox');
    cb.size = 'small';
    cb.className = 'multi-checkbox-row';
    cb._realVal = v;
    cb.textContent = String(v);
    list.appendChild(cb);
    checkboxes.push(cb);

    cb.addEventListener('sl-change', () => {
      const set = state.filterValues[def.key];
      set.clear();
      checkboxes.filter(c => c.checked).forEach(c => set.add(c._realVal));
      countBadge.textContent = String(set.size);
      countBadge.classList.toggle('hidden', set.size === 0);
      _applyAndNotify(state);
    });
  }

  search.addEventListener('sl-input', () => {
    const q = norm(search.value ?? '');
    checkboxes.forEach(cb => {
      cb.style.display = !q || norm(cb.textContent).includes(q) ? '' : 'none';
    });
  });

  details.append(search, list);
  container.appendChild(details);

  state.filterRefs[def.key] = { type: 'multi', checkboxes, countBadge, label: def.label };
}

function _buildSlider(def, colName, state, container) {
  const nums = state.raw.map(r => Number(r[colName])).filter(v => !isNaN(v) && v > 0);
  if (!nums.length) return;

  const step = def.step ?? 1;
  const inv  = 1 / step;
  const dMin = Math.floor(Math.min(...nums) * inv) / inv;
  const dMax = Math.ceil(Math.max(...nums)  * inv) / inv;

  const details = document.createElement('sl-details');
  details.className = 'filter-group-modern';
  details.open = true;
  const summarySlot = document.createElement('div');
  summarySlot.slot = 'summary';
  summarySlot.className = 'filter-group-summary';
  summarySlot.innerHTML = `<span>${def.label}</span>`;
  const countBadge = document.createElement('sl-badge');
  countBadge.setAttribute('variant', 'neutral');
  countBadge.setAttribute('pill', '');
  countBadge.className = 'filter-group-count hidden';
  summarySlot.appendChild(countBadge);
  details.appendChild(summarySlot);

  const sliderEl = document.createElement('div');
  sliderEl.className = 'noui-slider-wrap';

  const lblRow = document.createElement('div');
  lblRow.className = 'slider-labels';
  const iMin = document.createElement('sl-input');
  iMin.setAttribute('type', 'number'); iMin.setAttribute('size', 'small');
  iMin.setAttribute('value', String(dMin)); iMin.className = 'slider-lbl-input';
  const iMax = document.createElement('sl-input');
  iMax.setAttribute('type', 'number'); iMax.setAttribute('size', 'small');
  iMax.setAttribute('value', String(dMax)); iMax.className = 'slider-lbl-input';
  lblRow.append(iMin, iMax);

  details.append(sliderEl, lblRow);
  container.appendChild(details);

  const noUi = window.noUiSlider.create(sliderEl, {
    start: [dMin, dMax],
    connect: true,
    range: { min: dMin, max: dMax },
    step,
  });

  const ref = { type: 'slider', noUi, iMin, iMax, colName, curMin: dMin, curMax: dMax, step, countBadge, label: def.label };
  state.filterRefs[def.key] = ref;

  const commit = debounce(([lo, hi]) => {
    lo = Number(lo); hi = Number(hi);
    state.filterValues[def.key + 'Min'] = lo <= ref.curMin ? null : lo;
    state.filterValues[def.key + 'Max'] = hi >= ref.curMax ? null : hi;
    const active = state.filterValues[def.key + 'Min'] !== null || state.filterValues[def.key + 'Max'] !== null;
    countBadge.classList.toggle('hidden', !active);
    countBadge.textContent = '1';
    _applyAndNotify(state);
  }, 80);

  noUi.on('update', values => {
    iMin.value = Math.round(Number(values[0]) * 100) / 100;
    iMax.value = Math.round(Number(values[1]) * 100) / 100;
  });
  noUi.on('change', commit);

  const commitFromInputs = () => {
    let lo = iMin.value === '' ? ref.curMin : Math.max(ref.curMin, Math.min(Number(iMin.value), ref.curMax));
    let hi = iMax.value === '' ? ref.curMax : Math.max(ref.curMin, Math.min(Number(iMax.value), ref.curMax));
    if (isNaN(lo)) lo = ref.curMin;
    if (isNaN(hi)) hi = ref.curMax;
    if (lo > hi) [lo, hi] = [hi, lo];
    noUi.set([lo, hi]);
  };
  iMin.addEventListener('sl-change', commitFromInputs);
  iMax.addEventListener('sl-change', commitFromInputs);
}

// ── Chips de filtros activos ────────────────────────────────────────────────

function _renderActiveChips(state) {
  const bar   = document.getElementById('activeFiltersBar');
  const chips = document.getElementById('activeFiltersChips');
  if (!bar || !chips) return;

  const items = [];
  for (const [key, ref] of Object.entries(state.filterRefs ?? {})) {
    if (ref.type === 'multi') {
      const set = state.filterValues[key];
      if (set?.size) items.push({ key, text: `${ref.label} (${set.size})`, onClear: () => {
        set.clear();
        ref.checkboxes.forEach(cb => { cb.checked = false; });
        ref.countBadge.classList.add('hidden');
        _applyAndNotify(state);
        _renderActiveChips(state);
      }});
    } else if (ref.type === 'slider') {
      const lo = state.filterValues[key + 'Min'];
      const hi = state.filterValues[key + 'Max'];
      if (lo !== null || hi !== null) {
        const loTxt = lo ?? ref.curMin, hiTxt = hi ?? ref.curMax;
        items.push({ key, text: `${ref.label}: ${loTxt} – ${hiTxt}`, onClear: () => {
          ref.noUi.set([ref.curMin, ref.curMax]);
          state.filterValues[key + 'Min'] = null;
          state.filterValues[key + 'Max'] = null;
          ref.countBadge.classList.add('hidden');
          _applyAndNotify(state);
          _renderActiveChips(state);
        }});
      }
    }
  }

  bar.classList.toggle('hidden', items.length === 0);
  chips.innerHTML = '';
  items.forEach(item => {
    const tag = document.createElement('sl-tag');
    tag.setAttribute('size', 'small');
    tag.setAttribute('removable', '');
    tag.setAttribute('variant', 'primary');
    tag.textContent = item.text;
    tag.addEventListener('sl-remove', item.onClear);
    chips.appendChild(tag);
  });

  const badge = document.getElementById('mobileFiltersBadge');
  if (badge) {
    badge.textContent = String(items.length);
    badge.classList.toggle('hidden', items.length === 0);
  }
}

function _clearAllFilters(state) {
  for (const [key, ref] of Object.entries(state.filterRefs ?? {})) {
    if (ref.type === 'multi') {
      state.filterValues[key].clear();
      ref.checkboxes.forEach(cb => { cb.checked = false; });
      ref.countBadge.classList.add('hidden');
    } else if (ref.type === 'slider') {
      ref.noUi.set([ref.curMin, ref.curMax]);
      state.filterValues[key + 'Min'] = null;
      state.filterValues[key + 'Max'] = null;
      ref.countBadge.classList.add('hidden');
    }
  }
  _applyAndNotify(state);
}

document.getElementById('clearAllFiltersBtn')?.addEventListener('click', () => {
  window._mf?.state && _clearAllFilters(window._mf.state);
});

// ── Apply (idéntico a core/filters.js) ─────────────────────────────────────

function _applyAndNotify(state) {
  _applyRaw(state);
  state._onChange?.(state);
  _renderActiveChips(state);
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
    const ref = state.filterRefs?.[key];
    if (!(set instanceof Set) || !ref || ref.type !== 'multi') continue;
    const valueSet = new Set(values.map(String));
    set.clear();
    ref.checkboxes.forEach(cb => {
      const isIn = valueSet.size > 0 && valueSet.has(String(cb._realVal));
      cb.checked = isIn;
      if (isIn) set.add(cb._realVal);
    });
    ref.countBadge.textContent = String(set.size);
    ref.countBadge.classList.toggle('hidden', set.size === 0);
  }

  for (const [key, range] of Object.entries(data.slider ?? {})) {
    const ref = state.filterRefs?.[key];
    state.filterValues[key + 'Min'] = range.min ?? null;
    state.filterValues[key + 'Max'] = range.max ?? null;
    if (!ref || ref.type !== 'slider') continue;
    const lo = range.min ?? ref.curMin;
    const hi = range.max ?? ref.curMax;
    ref.noUi.set([lo, hi]);
    const active = range.min != null || range.max != null;
    ref.countBadge.classList.toggle('hidden', !active);
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

// ── Slider limit update (idéntico a core/filters.js, adaptado a noUiSlider) ─

function _updateSliderLimits(state) {
  for (const [key, ref] of Object.entries(state.filterRefs ?? {})) {
    if (ref.type !== 'slider') continue;
    const nums = state.filtered.map(r => Number(r[ref.colName])).filter(v => !isNaN(v) && v > 0);
    if (!nums.length) continue;

    const inv    = 1 / ref.step;
    const newMin = Math.floor(Math.min(...nums) * inv) / inv;
    const newMax = Math.ceil(Math.max(...nums)  * inv) / inv;

    const noUserFilter = state.filterValues[key + 'Min'] === null && state.filterValues[key + 'Max'] === null;
    if (noUserFilter && (newMin !== ref.curMin || newMax !== ref.curMax)) {
      ref.curMin = newMin; ref.curMax = newMax;
      ref.noUi.updateOptions({ range: { min: newMin, max: newMax } }, false);
      ref.noUi.set([newMin, newMax]);
    }
  }
}
