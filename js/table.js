import { $, fmt, debounce } from './utils.js';
import { state } from './data.js';

// Descripciones de cómo se calculan las métricas (para tooltips)
const METRIC_DESCRIPTIONS = {
  'Vel. Venta (un./mes)': 'Mediana de velocidad de venta por tipología. Métrica robusta que refleja el ritmo típico de ventas sin sesgos por outliers.',
  'Ticket UF': 'Precio promedio de venta.',
  'UF/m²': 'Precio por metro cuadrado útil.',
  '% Vendido': 'Porcentaje de unidades vendidas respecto al stock total.',
  'Disponibles': 'Número de unidades aún disponibles para venta.',
  'Stock Programa': 'Número total de unidades disponibles del proyecto.',
};

// ============== Tabla ==============
export function renderTable() {
  const thead = $('#dataTable thead');
  const tbody = $('#dataTable tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Header
  const tr = document.createElement('tr');
  console.log('Renderizando tabla con columnas:', state.columns.map(c => c.name));
  for (const col of state.columns) {
    const th = document.createElement('th');
    th.textContent = col.name;

    if (state.sort.col === col.name) {
      th.classList.add('sort-' + state.sort.dir);
    }
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.textContent = state.sort.col === col.name ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
    arrow.style.pointerEvents = 'none'; // No bloquear eventos
    th.appendChild(arrow);

    // Agregar tooltip si existe descripción de la métrica
    const desc = METRIC_DESCRIPTIONS[col.name];
    if (desc) {
      console.log('✓ Tooltip agregado a:', col.name);
      th.style.cursor = 'help';
      th.classList.add('has-tooltip');
      th.title = desc; // Fallback nativo

      th.addEventListener('mouseenter', (e) => {
        console.log('💬 Hover en:', col.name);
        showTableTooltip(e, desc);
      });
      th.addEventListener('mouseleave', hideTableTooltip);
    }

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

// ============== Tooltips dinámicos ==============
let globalTooltip = null;

function showTableTooltip(event, text) {
  hideTableTooltip();

  globalTooltip = document.createElement('div');
  globalTooltip.className = 'table-tooltip-global';
  globalTooltip.innerHTML = `<strong>${event.target.textContent}</strong><br>${text}`;
  document.body.appendChild(globalTooltip);

  const rect = event.target.getBoundingClientRect();
  const tooltipWidth = 320;
  let left = rect.left + rect.width / 2 - tooltipWidth / 2;
  if (left < 10) left = 10;
  if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;

  globalTooltip.style.position = 'fixed';
  globalTooltip.style.left = left + 'px';
  globalTooltip.style.top = (rect.top - 80) + 'px';
  globalTooltip.style.opacity = '1';
  globalTooltip.style.display = 'block';
}

function hideTableTooltip() {
  if (globalTooltip) {
    globalTooltip.style.opacity = '0';
    setTimeout(() => {
      if (globalTooltip) globalTooltip.remove();
      globalTooltip = null;
    }, 200);
  }
}

// ============== Búsqueda global ==============
$('#searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  import('./filters.js').then(({ applyFilters }) => applyFilters());
}, 200));