/* ============================================================
   Visor Venta Residencial GFK
   v1 — Tabla, filtros, gráfico y exportación
   ============================================================ */

// ============== Estado global ==============
const state = {
  raw: [],            // todas las filas
  filtered: [],       // filas filtradas
  columns: [],        // [{name, type: 'number'|'string'|'date', values}]
  filters: {},        // {colName: {type, ...}}
  sort: { col: null, dir: 'asc' },
  search: '',
  page: 1,
  pageSize: 50,
  chart: null,
};

// ============== Utilidades ==============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('es-CL');
    return v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  }
  return String(v);
};

const isNumeric = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

function detectColType(values) {
  let nums = 0, total = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    total++;
    if (typeof v === 'number' || isNumeric(v)) nums++;
  }
  if (total === 0) return 'string';
  if (nums / total >= 0.8) return 'number';
  return 'string';
}

function uniqueValues(rows, col) {
  const set = new Set();
  for (const r of rows) {
    const v = r[col];
    if (v !== null && v !== undefined && v !== '') set.add(v);
  }
  return Array.from(set).sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'es');
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ============== Carga de archivo ==============
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  $('#fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      if (!wb.SheetNames.includes('Datos')) {
        alert('No encontré la hoja "Datos" en el archivo. Hojas disponibles: ' + wb.SheetNames.join(', '));
        return;
      }
      const ws = wb.Sheets['Datos'];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (rows.length === 0) {
        alert('La hoja "Datos" está vacía.');
        return;
      }
      onDataLoaded(rows);
    } catch (err) {
      console.error(err);
      alert('Error leyendo el archivo: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============== Procesado al cargar ==============
function onDataLoaded(rows) {
  state.raw = rows;
  state.filtered = rows.slice();

  // Detectar columnas y tipos
  const colNames = Object.keys(rows[0]);
  state.columns = colNames.map(name => {
    const values = rows.map(r => r[name]);
    return { name, type: detectColType(values) };
  });

  // Mostrar dashboard
  $('#dropzone').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');

  buildFilters();
  populateChartSelectors();
  applyFilters();
}

// ============== Filtros dinámicos ==============
function buildFilters() {
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

function applyFilters() {
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
  renderTable();
  renderKpis();
  renderChart();
}

$('#resetBtn').addEventListener('click', () => {
  if (state.raw.length === 0) return;
  buildFilters();
  $('#searchInput').value = '';
  state.search = '';
  applyFilters();
});

// ============== Búsqueda global ==============
$('#searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  applyFilters();
}, 200));

// ============== Tabla ==============
function renderTable() {
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

// ============== KPIs ==============
function renderKpis() {
  const rows = state.filtered;
  const cont = $('#kpis');
  cont.innerHTML = '';

  const sum = (col) => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0);
  const avg = (col) => {
    const nums = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  };

  const kpis = [
    { label: 'Registros', value: rows.length.toLocaleString('es-CL'), sub: `de ${state.raw.length.toLocaleString('es-CL')}` },
  ];

  if (state.columns.find(c => c.name === 'Edificio')) {
    const edificios = new Set(rows.map(r => r['Edificio']).filter(Boolean));
    kpis.push({ label: 'Edificios únicos', value: edificios.size.toLocaleString('es-CL') });
  }
  if (state.columns.find(c => c.name === 'Disponibles')) {
    kpis.push({ label: 'Disponibles', value: fmt(sum('Disponibles')), sub: 'unidades' });
  }
  if (state.columns.find(c => c.name === 'UF/m²')) {
    kpis.push({ label: 'UF/m² promedio', value: fmt(avg('UF/m²')) });
  }
  if (state.columns.find(c => c.name === 'Ticket UF')) {
    kpis.push({ label: 'Ticket UF promedio', value: fmt(avg('Ticket UF')) });
  }
  if (state.columns.find(c => c.name === '% Vendido')) {
    const a = avg('% Vendido');
    const display = a > 1 ? fmt(a) + '%' : (a * 100).toFixed(1) + '%';
    kpis.push({ label: '% Vendido promedio', value: display });
  }
  if (state.columns.find(c => c.name === 'Vel. Venta (un./mes)')) {
    kpis.push({ label: 'Vel. Venta promedio', value: fmt(avg('Vel. Venta (un./mes)')), sub: 'un./mes' });
  }

  for (const k of kpis) {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `<div class="label">${k.label}</div><div class="value">${k.value}</div>${k.sub ? `<div class="sub">${k.sub}</div>` : ''}`;
    cont.appendChild(card);
  }
}

// ============== Tabs ==============
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    if (tab.dataset.tab === 'grafico') renderChart();
  });
});

// ============== Gráfico ==============
function populateChartSelectors() {
  const xSel = $('#chartX');
  const ySel = $('#chartY');
  const gSel = $('#chartGroup');
  xSel.innerHTML = '';
  ySel.innerHTML = '';
  gSel.innerHTML = '<option value="">— Ninguno —</option>';

  for (const col of state.columns) {
    const o1 = document.createElement('option');
    o1.value = col.name; o1.textContent = col.name;
    xSel.appendChild(o1);
    const o3 = document.createElement('option');
    o3.value = col.name; o3.textContent = col.name;
    gSel.appendChild(o3);
    if (col.type === 'number') {
      const o2 = document.createElement('option');
      o2.value = col.name; o2.textContent = col.name;
      ySel.appendChild(o2);
    }
  }

  // Defaults razonables
  if (state.columns.find(c => c.name === 'Edificio')) xSel.value = 'Edificio';
  if (state.columns.find(c => c.name === 'UF/m²')) ySel.value = 'UF/m²';

  ['#chartType', '#chartX', '#chartY', '#chartAgg', '#chartGroup', '#chartSort'].forEach(sel => {
    $(sel).addEventListener('change', renderChart);
  });
}

function aggregate(values, mode) {
  const nums = values.filter(v => !isNaN(v) && v !== null);
  if (nums.length === 0) return mode === 'count' ? values.length : 0;
  switch (mode) {
    case 'count': return values.length;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'median': {
      const s = nums.slice().sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
  }
  return 0;
}

const palette = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7'
];

function renderChart() {
  if (state.filtered.length === 0) return;
  const type = $('#chartType').value;
  const xCol = $('#chartX').value;
  const yCol = $('#chartY').value;
  const agg = $('#chartAgg').value;
  const groupCol = $('#chartGroup').value;
  const sortMode = $('#chartSort').value;

  if (state.chart) state.chart.destroy();
  const ctx = $('#mainChart').getContext('2d');

  let chartConfig;

  if (type === 'scatter') {
    // Dispersión: necesita X numérico también. Si no, agrupamos por X y usamos índice.
    const xType = state.columns.find(c => c.name === xCol)?.type;
    if (xType === 'number' && yCol) {
      const datasets = [];
      if (groupCol) {
        const groups = {};
        for (const r of state.filtered) {
          const g = r[groupCol] ?? '—';
          if (!groups[g]) groups[g] = [];
          const x = Number(r[xCol]); const y = Number(r[yCol]);
          if (!isNaN(x) && !isNaN(y)) groups[g].push({ x, y });
        }
        Object.entries(groups).forEach(([g, pts], i) => {
          datasets.push({ label: String(g), data: pts, backgroundColor: palette[i % palette.length] });
        });
      } else {
        const pts = state.filtered.map(r => ({ x: Number(r[xCol]), y: Number(r[yCol]) }))
          .filter(p => !isNaN(p.x) && !isNaN(p.y));
        datasets.push({ label: yCol, data: pts, backgroundColor: palette[0] });
      }
      chartConfig = {
        type: 'scatter',
        data: { datasets },
        options: chartBaseOptions({ xTitle: xCol, yTitle: yCol })
      };
    } else {
      alert('Para dispersión, el eje X debe ser numérico.');
      return;
    }
  } else if (type === 'pie') {
    // Pie: agrupar por X, valor agregado
    const groups = {};
    for (const r of state.filtered) {
      const k = r[xCol] ?? '—';
      if (!groups[k]) groups[k] = [];
      groups[k].push(yCol && agg !== 'count' ? Number(r[yCol]) : 1);
    }
    let entries = Object.entries(groups).map(([k, vals]) => [k, aggregate(vals, agg)]);
    entries = sortEntries(entries, sortMode);
    chartConfig = {
      type: 'pie',
      data: {
        labels: entries.map(([k]) => String(k)),
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => palette[i % palette.length]) }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    };
  } else {
    // Bar / Line: agrupar por X, opcionalmente split por groupCol
    if (groupCol && groupCol !== xCol) {
      // matriz: x -> group -> [vals]
      const xKeys = new Set();
      const gKeys = new Set();
      const matrix = {};
      for (const r of state.filtered) {
        const x = r[xCol] ?? '—';
        const g = r[groupCol] ?? '—';
        xKeys.add(x); gKeys.add(g);
        const key = x + '||' + g;
        if (!matrix[key]) matrix[key] = [];
        matrix[key].push(yCol && agg !== 'count' ? Number(r[yCol]) : 1);
      }
      let labels = Array.from(xKeys);
      const xType = state.columns.find(c => c.name === xCol)?.type;
      labels.sort((a, b) => xType === 'number' ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'es'));
      const groupVals = Array.from(gKeys);
      const datasets = groupVals.map((g, i) => ({
        label: String(g),
        data: labels.map(x => aggregate(matrix[x + '||' + g] || [], agg)),
        backgroundColor: palette[i % palette.length],
        borderColor: palette[i % palette.length],
        fill: false,
        tension: 0.2,
      }));
      chartConfig = {
        type,
        data: { labels: labels.map(String), datasets },
        options: chartBaseOptions({ xTitle: xCol, yTitle: yCol || 'Conteo' })
      };
    } else {
      const groups = {};
      for (const r of state.filtered) {
        const k = r[xCol] ?? '—';
        if (!groups[k]) groups[k] = [];
        groups[k].push(yCol && agg !== 'count' ? Number(r[yCol]) : 1);
      }
      let entries = Object.entries(groups).map(([k, vals]) => [k, aggregate(vals, agg)]);
      entries = sortEntries(entries, sortMode);
      chartConfig = {
        type,
        data: {
          labels: entries.map(([k]) => String(k)),
          datasets: [{
            label: agg === 'count' ? 'Conteo' : `${agg.toUpperCase()} ${yCol}`,
            data: entries.map(([, v]) => v),
            backgroundColor: type === 'line' ? 'rgba(59,130,246,0.2)' : palette[0],
            borderColor: palette[0],
            borderWidth: 2,
            fill: type === 'line',
            tension: 0.2,
          }]
        },
        options: chartBaseOptions({ xTitle: xCol, yTitle: yCol || 'Conteo' })
      };
    }
  }

  state.chart = new Chart(ctx, chartConfig);
}

function chartBaseOptions({ xTitle, yTitle }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { title: { display: true, text: xTitle } },
      y: { title: { display: true, text: yTitle }, beginAtZero: true },
    }
  };
}

function sortEntries(entries, mode) {
  const e = entries.slice();
  switch (mode) {
    case 'value-desc': return e.sort((a, b) => b[1] - a[1]);
    case 'value-asc': return e.sort((a, b) => a[1] - b[1]);
    case 'label-asc': return e.sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es', { numeric: true }));
    case 'label-desc': return e.sort((a, b) => String(b[0]).localeCompare(String(a[0]), 'es', { numeric: true }));
  }
  return e;
}

// ============== Exportar ==============
$('#exportCsvBtn').addEventListener('click', () => {
  if (state.filtered.length === 0) return;
  const cols = state.columns.map(c => c.name);
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of state.filtered) {
    lines.push(cols.map(c => escape(r[c])).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `datos_filtrados_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#exportPngBtn').addEventListener('click', () => {
  if (!state.chart) return;
  const a = document.createElement('a');
  a.href = state.chart.toBase64Image('image/png', 1);
  a.download = `grafico_${Date.now()}.png`;
  a.click();
});
