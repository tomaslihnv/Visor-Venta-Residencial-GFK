import { $, fmt } from './utils.js';
import { state } from './data.js';

// ============== KPIs ==============
export function renderKpis() {
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

// ============== Gráfico ==============
export function populateChartSelectors() {
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

export function renderChart() {
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

// ============== Distribución (curva de precios) ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
const pctColors  = ['#ef4444', '#f97316', '#a855f7', '#ec4899'];
const priceColors = ['#22c55e', '#14b8a6', '#84cc16', '#0ea5e9'];

export function populateDistribSelectors() {
  const colSel   = $('#distribCol');
  const groupSel = $('#distribGroup');
  if (!colSel) return;

  colSel.innerHTML  = '';
  groupSel.innerHTML = '<option value="">— Ninguno —</option>';

  for (const col of state.columns) {
    if (col.type === 'number') {
      const o = document.createElement('option');
      o.value = col.name; o.textContent = col.name;
      colSel.appendChild(o);
    }
    const og = document.createElement('option');
    og.value = col.name; og.textContent = col.name;
    groupSel.appendChild(og);
  }

  if (state.columns.find(c => c.name === 'Ticket UF')) colSel.value = 'Ticket UF';

  colSel.addEventListener('change', renderDistrib);
  groupSel.addEventListener('change', renderDistrib);

  if (!distribListenersReady) {
    distribListenersReady = true;

    const addPct = () => {
      const v = parseInt($('#distribPctInput').value);
      if (isNaN(v) || v < 1 || v > 99) return;
      distribMarkers.percentiles.add(v);
      $('#distribPctInput').value = '';
      refreshMarkerTags();
      renderDistrib();
    };
    $('#distribAddPct').addEventListener('click', addPct);
    $('#distribPctInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPct(); });

    const addPrice = () => {
      const v = parseFloat($('#distribPriceInput').value);
      if (isNaN(v) || v <= 0) return;
      distribMarkers.prices.add(v);
      $('#distribPriceInput').value = '';
      refreshMarkerTags();
      renderDistrib();
    };
    $('#distribAddPrice').addEventListener('click', addPrice);
    $('#distribPriceInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPrice(); });
  }
}

function refreshMarkerTags() {
  const pctContainer   = $('#distribPctTags');
  const priceContainer = $('#distribPriceTags');
  if (!pctContainer) return;

  pctContainer.innerHTML = '';
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag pct-tag';
    tag.innerHTML = `P${v} <button data-val="${v}" class="rm-pct">×</button>`;
    tag.querySelector('.rm-pct').addEventListener('click', () => {
      distribMarkers.percentiles.delete(v);
      refreshMarkerTags();
      renderDistrib();
    });
    pctContainer.appendChild(tag);
  });

  priceContainer.innerHTML = '';
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag price-tag';
    tag.innerHTML = `${v.toLocaleString('es-CL')} UF <button data-val="${v}" class="rm-price">×</button>`;
    tag.querySelector('.rm-price').addEventListener('click', () => {
      distribMarkers.prices.delete(v);
      refreshMarkerTags();
      renderDistrib();
    });
    priceContainer.appendChild(tag);
  });
}

// Curva de cuantiles: X = percentil (0–100%), Y = valor
function computeQuantileCurve(rows, col) {
  const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
  if (vals.length < 2) return [];
  vals.sort((a, b) => a - b);
  const n = vals.length;
  return vals.map((v, i) => ({ x: (i / (n - 1)) * 100, y: v }));
}

function lerpAtX(data, x) {
  if (!data.length) return null;
  if (x <= data[0].x) return data[0].y;
  if (x >= data[data.length - 1].x) return data[data.length - 1].y;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].x <= x && x <= data[i + 1].x) {
      const t = (x - data[i].x) / (data[i + 1].x - data[i].x);
      return data[i].y + t * (data[i + 1].y - data[i].y);
    }
  }
  return null;
}

function lerpAtY(data, y) {
  if (!data.length) return null;
  if (y <= data[0].y) return data[0].x;
  if (y >= data[data.length - 1].y) return data[data.length - 1].x;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].y <= y && y <= data[i + 1].y) {
      const t = (y - data[i].y) / (data[i + 1].y - data[i].y);
      return data[i].x + t * (data[i + 1].x - data[i].x);
    }
  }
  return null;
}

export function renderDistrib() {
  const colSel   = $('#distribCol');
  const groupSel = $('#distribGroup');
  if (!colSel || state.filtered.length === 0) return;

  const col      = colSel.value;
  const groupCol = groupSel.value;

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart').getContext('2d');

  let datasets;
  let refData; // primera curva, usada para calcular las anotaciones

  if (groupCol) {
    const groups = {};
    for (const r of state.filtered) {
      const g = String(r[groupCol] ?? '—');
      if (!groups[g]) groups[g] = [];
      groups[g].push(r);
    }
    datasets = Object.entries(groups).map(([g, rows], i) => ({
      label: g,
      data: computeQuantileCurve(rows, col),
      borderColor: palette[i % palette.length],
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0,
      fill: false,
    }));
    refData = datasets[0]?.data ?? [];
  } else {
    refData = computeQuantileCurve(state.filtered, col);
    datasets = [{
      label: col,
      data: refData,
      borderColor: palette[0],
      backgroundColor: 'rgba(59,130,246,0.08)',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0,
      fill: true,
    }];
  }

  // Construir anotaciones
  const annotations = {};

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach((pct, i) => {
    const color = pctColors[i % pctColors.length];
    const price = lerpAtX(refData, pct);
    if (price === null) return;
    const priceLabel = price.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `P${pct}`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: 11, weight: 'bold' } },
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${priceLabel} UF`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: 11, weight: 'bold' } },
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach((price, i) => {
    const color = priceColors[i % priceColors.length];
    const pct   = lerpAtY(refData, price);
    const pctForLabel = pct !== null ? pct : 100;
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${price.toLocaleString('es-CL')} UF`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: 11, weight: 'bold' } },
    };
    if (pct !== null) {
      annotations[`prv_${price}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `P${pct.toFixed(1)}`, display: true, position: 'start',
          color, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: 11, weight: 'bold' } },
      };
    }
  });

  distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          mode: 'nearest',
          intersect: false,
          axis: 'x',
          callbacks: {
            title: items => `P${Number(items[0]?.parsed.x).toFixed(1)}`,
            label: item => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('es-CL', { maximumFractionDigits: 0 })} UF`,
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear', min: 0, max: 100,
          title: { display: true, text: 'Percentil (%)' },
          ticks: { callback: v => v + '%' },
        },
        y: {
          title: { display: true, text: col },
          ticks: { callback: v => v.toLocaleString('es-CL') },
        },
      },
    },
  });
}