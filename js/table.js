import { $, fmt, debounce } from './utils.js';
import { state } from './data.js';

// ============== Tabla ==============
export function renderTable() {
  const thead = $('#dataTable thead');
  const tbody = $('#dataTable tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Header
  const tr = document.createElement('tr');
  for (const col of state.columns) {
    const th = document.createElement('th');
    th.textContent = col.name;
    if (state.sort.col === col.name) {
      th.classList.add('sort-' + state.sort.dir);
    }
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.textContent = state.sort.col === col.name ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
    th.appendChild(arrow);
    th.addEventListener('click', () => {
      if (state.sort.col === col.name) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.col = col.name;
        state.sort.dir = 'asc';
      }
      renderTable();
    });
    tr.appendChild(th);
  }
  thead.appendChild(tr);

  // Sort
  let rows = state.filtered.slice();
  if (state.sort.col) {
    const col = state.columns.find(c => c.name === state.sort.col);
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av = a[state.sort.col], bv = b[state.sort.col];
      if (av === '' || av === null || av === undefined) return 1;
      if (bv === '' || bv === null || bv === undefined) return -1;
      if (col && col.type === 'number') {
        return (Number(av) - Number(bv)) * dir;
      }
      return String(av).localeCompare(String(bv), 'es', { numeric: true }) * dir;
    });
  }

  // Pagination
  const start = (state.page - 1) * state.pageSize;
  const end = start + state.pageSize;
  const pageRows = rows.slice(start, end);

  for (const row of pageRows) {
    const tr = document.createElement('tr');
    for (const col of state.columns) {
      const td = document.createElement('td');
      const v = row[col.name];
      td.textContent = fmt(v);
      if (col.type === 'number') td.classList.add('num');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // Pagination info
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  $('#pageInfo').textContent = `Página ${state.page} de ${totalPages}`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= totalPages;
  $('#rowCount').textContent = `${rows.length} fila${rows.length === 1 ? '' : 's'}`;
}

$('#prevPage').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); renderTable(); });
$('#nextPage').addEventListener('click', () => { state.page++; renderTable(); });
$('#pageSize').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderTable(); });

// ============== Búsqueda global ==============
$('#searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  import('./filters.js').then(({ applyFilters }) => applyFilters());
}, 200));