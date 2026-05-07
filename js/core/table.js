import { fmt, debounce } from './utils.js';

let _tableListenersReady = false;

export function initTableListeners(state, onChange) {
  if (_tableListenersReady) return;
  _tableListenersReady = true;

  document.getElementById('prevPage')?.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1); renderTable(state);
  });
  document.getElementById('nextPage')?.addEventListener('click', () => {
    state.page++; renderTable(state);
  });
  document.getElementById('pageSize')?.addEventListener('change', e => {
    state.pageSize = Number(e.target.value); state.page = 1; renderTable(state);
  });
  document.getElementById('searchInput')?.addEventListener('input', debounce(e => {
    state.search = e.target.value.toLowerCase();
    onChange(state);
  }, 200));
}

// options.hiddenCols: string[] — column names to hide
// options.linkCols:   string[] — column names to render as <a>
export function renderTable(state, options = {}) {
  const thead = document.querySelector('#dataTable thead');
  const tbody = document.querySelector('#dataTable tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const hidden = new Set(options.hiddenCols ?? []);
  const links  = new Set(options.linkCols  ?? ['Link']);

  const visibleCols = state.columns.filter(c => !c.name.startsWith('__') && !hidden.has(c.name));

  // Header
  const tr = document.createElement('tr');
  for (const col of visibleCols) {
    const th = document.createElement('th');
    th.textContent = col.name;
    if (state.sort.col === col.name) th.classList.add('sort-' + state.sort.dir);
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.textContent = state.sort.col === col.name ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
    th.appendChild(arrow);
    th.addEventListener('click', () => {
      if (state.sort.col === col.name) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.col = col.name; state.sort.dir = 'asc'; }
      renderTable(state, options);
    });
    tr.appendChild(th);
  }
  thead.appendChild(tr);

  // Rows
  let rows = state.filtered.slice();
  if (state.sort.col) {
    const col = state.columns.find(c => c.name === state.sort.col);
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av = a[state.sort.col], bv = b[state.sort.col];
      if (av === '' || av == null) return 1;
      if (bv === '' || bv == null) return -1;
      if (col?.type === 'number') return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), 'es', { numeric: true }) * dir;
    });
  }

  const start    = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  for (const row of pageRows) {
    const tr = document.createElement('tr');
    for (const col of visibleCols) {
      const td = document.createElement('td');
      const v  = row[col.name];
      if (links.has(col.name) && v && String(v).startsWith('http')) {
        td.innerHTML = `<a href="${String(v)}" target="_blank" rel="noopener" class="table-link">Ver</a>`;
      } else {
        td.textContent = fmt(v);
        if (col.type === 'number') td.classList.add('num');
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const pi = document.getElementById('pageInfo');
  if (pi) pi.textContent = `Página ${state.page} de ${totalPages}`;
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= totalPages;
  const rc = document.getElementById('rowCount');
  if (rc) rc.textContent = `${rows.length} fila${rows.length === 1 ? '' : 's'}`;
}
