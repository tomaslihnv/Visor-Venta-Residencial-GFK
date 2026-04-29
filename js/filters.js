import { $, uniqueValues, debounce, isNumeric, fmt } from './utils.js';
import { state } from './data.js';

// ============== Filtros dinámicos ==============
export function buildFilters() {
  const container = $('#filtersContainer');
  container.innerHTML = '';
  state.filters = {};

  for (const col of state.columns) {
    const group = document.createElement('div');
    group.className = 'filter-group';
    const lbl = document.createElement('label');
    lbl.className = 'title';
    lbl.textContent = col.name;
    group.appendChild(lbl);

    if (col.type === 'number') {
      // Rango min/max
      const nums = state.raw.map(r => Number(r[col.name])).filter(v => !isNaN(v));
      if (nums.length === 0) continue;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const row = document.createElement('div');
      row.className = 'range-row';
      const inMin = document.createElement('input');
      inMin.type = 'number'; inMin.placeholder = `min (${fmt(min)})`;
      const inMax = document.createElement('input');
      inMax.type = 'number'; inMax.placeholder = `max (${fmt(max)})`;
      row.appendChild(inMin);
      row.appendChild(document.createTextNode(' – '));
      row.appendChild(inMax);
      group.appendChild(row);

      state.filters[col.name] = { type: 'range', min: null, max: null, _min: min, _max: max };
      const onChange = debounce(() => {
        state.filters[col.name].min = inMin.value === '' ? null : Number(inMin.value);
        state.filters[col.name].max = inMax.value === '' ? null : Number(inMax.value);
        applyFilters();
      }, 250);
      inMin.addEventListener('input', onChange);
      inMax.addEventListener('input', onChange);
    } else {
      // Multi-select de valores únicos
      const vals = uniqueValues(state.raw, col.name);
      if (vals.length === 0) continue;

      // Si son demasiados valores, usar buscador en lugar de checkboxes
      if (vals.length > 30) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = `Filtrar ${col.name.toLowerCase()}...`;
        group.appendChild(inp);
        state.filters[col.name] = { type: 'text', value: '' };
        inp.addEventListener('input', debounce(() => {
          state.filters[col.name].value = inp.value.trim().toLowerCase();
          applyFilters();
        }, 200));
      } else {
        const multi = document.createElement('div');
        multi.className = 'multi';
        const selected = new Set();
        for (const v of vals) {
          const id = `f_${col.name}_${v}`.replace(/\W+/g, '_');
          const lab = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.value = String(v); cb.id = id;
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(v); else selected.delete(v);
            state.filters[col.name].selected = selected;
            applyFilters();
          });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(' ' + fmt(v)));
          multi.appendChild(lab);
        }
        group.appendChild(multi);
        state.filters[col.name] = { type: 'multi', selected };
      }
    }
    container.appendChild(group);
  }
}

export function applyFilters() {
  const search = state.search.toLowerCase();
  state.filtered = state.raw.filter(row => {
    // Búsqueda global
    if (search) {
      const hay = Object.values(row).map(v => String(v).toLowerCase()).join(' ');
      if (!hay.includes(search)) return false;
    }
    // Filtros por columna
    for (const [col, f] of Object.entries(state.filters)) {
      const v = row[col];
      if (f.type === 'range') {
        const n = Number(v);
        if (f.min !== null && (isNaN(n) || n < f.min)) return false;
        if (f.max !== null && (isNaN(n) || n > f.max)) return false;
      } else if (f.type === 'multi') {
        if (f.selected && f.selected.size > 0 && !f.selected.has(v)) return false;
      } else if (f.type === 'text') {
        if (f.value && !String(v).toLowerCase().includes(f.value)) return false;
      }
    }
    return true;
  });

  state.page = 1;
  $('#filterCount').textContent = `${state.filtered.length} / ${state.raw.length}`;

  // Llamar a render de otros módulos
  import('./table.js').then(({ renderTable }) => renderTable());
  import('./chart.js').then(({ renderKpis, renderChart }) => {
    renderKpis();
    renderChart();
  });

  // Renderizar mapa si la tab está activa
  if ($('.tab.active')?.dataset.tab === 'mapa') {
    import('./map.js').then(({ renderMap }) => renderMap());
  }
}

export function resetFilters() {
  if (state.raw.length === 0) return;
  buildFilters();
  $('#searchInput').value = '';
  state.search = '';
  applyFilters();
}