import { $, fmt } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

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
    const v = avg('UF/m²');
    kpis.push({
      label: 'UF/<span class="keep-case">m²</span> promedio',
      value: v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    });
  }
  if (state.columns.find(c => c.name === 'Ticket UF')) {
    const v = avg('Ticket UF');
    kpis.push({
      label: 'Ticket UF promedio',
      value: Math.round(v).toLocaleString('es-CL'),
    });
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

// ============== Proyectos (barras por edificio) ==============
let proyChart = null;
let proyListenersReady = false;

const PROY_METRICS = [
  { id: 'ticket', label: 'Ticket UF',            keys: ['ticket'],                      agg: 'avg', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'ufm2',   label: 'UF/m²',               keys: ['uf/m', 'uf / m'],              agg: 'avg', fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { id: 'util',   label: 'Útil (m²)',            keys: ['útil', 'util', 'vendible'],    agg: 'avg', fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) },
  { id: 'disp',   label: 'Disponibles',          keys: ['disponib'],                    agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'vel',    label: 'Vel. Venta (un./mes)', keys: ['vel. venta', 'vel venta'],     agg: 'avg', fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) },
  { id: 'oferta', label: 'Oferta total proyecto',keys: ['oferta total', 'oferta'],      agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'pct',    label: '% Vendido',            keys: ['% vendido', 'pct vendido', 'vendido'], agg: 'avg', fmt: v => {
    const pct = Math.abs(v) <= 1.05 ? v * 100 : v;
    return pct.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%';
  }},
];

export function populateProyectosSelectors() {
  const sel = $('#proyMetrica');
  if (!sel || proyListenersReady) return;
  proyListenersReady = true;
  sel.addEventListener('change', renderProyectos);
  $('#proyExportPngBtn')?.addEventListener('click', () => {
    if (!proyChart) return;
    const a = document.createElement('a');
    a.href = proyChart.toBase64Image('image/png', 1);
    a.download = `proyectos_${Date.now()}.png`;
    a.click();
  });
}

export function renderProyectos() {
  if (state.filtered.length === 0) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  const metricId = $('#proyMetrica')?.value ?? 'ticket';
  const metric   = PROY_METRICS.find(m => m.id === metricId) ?? PROY_METRICS[0];

  const edifCol   = state.columns.find(c =>
    ['edificio', 'proyecto', 'building'].some(k => normStr(c.name).includes(k))
  )?.name;
  const metricCol = state.columns.find(c =>
    c.type === 'number' && metric.keys.some(k => normStr(c.name).includes(normStr(k)))
  )?.name;

  if (!edifCol || !metricCol) return;

  if (proyChart) { proyChart.destroy(); proyChart = null; }
  const ctx = $('#proyChart').getContext('2d');

  const byEdif = {};
  for (const r of state.filtered) {
    const edif = String(r[edifCol] ?? '').trim();
    if (!edif) continue;
    const val = Number(r[metricCol]);
    if (isNaN(val)) continue;
    if (!byEdif[edif]) byEdif[edif] = [];
    byEdif[edif].push(val);
  }

  const aggFn = metric.agg === 'sum'
    ? arr => arr.reduce((a, b) => a + b, 0)
    : arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  let entries = Object.entries(byEdif)
    .map(([edif, vals]) => [edif, aggFn(vals)]);

  // Mi Proyecto — respeta el filtro de tipología activo
  let mpName = null;
  if (mp.inProy && mp.edificio && mp.tipologias.length > 0) {
    const fmtTipo = v => {
      const s = String(v ?? '').trim();
      return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
    };
    const tipoCol = state.columns.find(c =>
      ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
    );
    const activeTipos = tipoCol
      ? new Set(state.filtered.map(r => fmtTipo(r[tipoCol.name])).filter(Boolean))
      : null;

    const tipos = mp.tipologias.filter(t =>
      t.nombre && (activeTipos ? activeTipos.has(fmtTipo(t.nombre)) : true)
    );

    let mpVal = null;
    if (metricId === 'ticket') {
      const vals = tipos.filter(t => t.sup != null && t.ufm2 != null).map(t => t.sup * t.ufm2);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    } else if (metricId === 'ufm2') {
      const vals = tipos.filter(t => t.ufm2 != null).map(t => t.ufm2);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    } else if (metricId === 'util') {
      const vals = tipos.filter(t => t.sup != null).map(t => t.sup);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    if (mpVal !== null) {
      mpName = mp.edificio || mp.propietario || 'Mi Proyecto';
      entries.push([mpName, mpVal]);
    }
  }

  entries = entries.sort((a, b) => b[1] - a[1]);

  const MP_COLOR  = '#f59e0b';
  const BAR_COLOR = '#1e3a5f';

  // Plugin inline para etiquetas permanentes sobre cada barra
  const barLabelsPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c, scales } = chart;
      const meta = chart.getDatasetMeta(0);
      c.save();
      c.font = 'bold 10px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const value = entries[i]?.[1];
        if (value == null) return;
        const isMP = entries[i]?.[0] === mpName;
        c.fillStyle = isMP ? '#d97706' : '#374151';
        c.fillText(metric.fmt(value), bar.x, bar.y - 3);
      });
      c.restore();
    },
  };

  proyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(([e]) => e),
      datasets: [{
        label: metric.label,
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([e]) => (e === mpName ? MP_COLOR : BAR_COLOR) + 'CC'),
        borderColor:     entries.map(([e]) =>  e === mpName ? '#d97706' : BAR_COLOR),
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: item => ` ${metric.fmt(item.raw)}` },
        },
      },
      scales: {
        x: {
          ticks: { maxRotation: 45, minRotation: 30, font: { size: 11 } },
        },
        y: {
          title: { display: true, text: metric.label },
          ticks: { callback: v => metric.fmt(v) },
          beginAtZero: false,
        },
      },
    },
    plugins: [barLabelsPlugin],
  });
}

// ============== Sup. vs Precio ==============
let svpListenersReady = false;

export function populateSvpSelectors() {
  const tipoSel = $('#svpTipoFilter');
  if (!tipoSel) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const tipoCol = state.columns.find(c => ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k)));

  tipoSel.innerHTML = '<option value="">Todas</option>';
  if (tipoCol) {
    const tipos = [...new Set(state.raw.map(r => r[tipoCol.name]).filter(Boolean))].sort();
    for (const t of tipos) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      tipoSel.appendChild(o);
    }
  }

  if (!svpListenersReady) {
    svpListenersReady = true;
    tipoSel.addEventListener('change', renderSupVsPrecio);
    $('#svpTrendToggle')?.addEventListener('change', renderSupVsPrecio);
    $('#svpExportPngBtn')?.addEventListener('click', () => {
      if (!state.chart) return;
      const a = document.createElement('a');
      a.href = state.chart.toBase64Image('image/png', 1);
      a.download = `sup_vs_precio_${Date.now()}.png`;
      a.click();
    });
  }
}

function linearRegression(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const sx  = pts.reduce((s, p) => s + p.x, 0);
  const sy  = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const den = n * sx2 - sx * sx;
  if (den === 0) return null;
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  const yMean = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.y - (m * p.x + b)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { m, b, r2 };
}

function _avgByEdif(rows, supCol, ufm2Col, edifCol) {
  const byEdif = {};
  for (const r of rows) {
    const sup  = Number(r[supCol.name]);
    const ufm2 = Number(r[ufm2Col.name]);
    if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
    const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
    if (!byEdif[edif]) byEdif[edif] = { sups: [], ufm2s: [] };
    byEdif[edif].sups.push(sup);
    byEdif[edif].ufm2s.push(ufm2);
  }
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  return Object.entries(byEdif).map(([edif, { sups, ufm2s }]) => ({
    x: avg(sups),
    y: avg(ufm2s),
    label: edif,
  }));
}

export function renderSupVsPrecio() {
  if (state.filtered.length === 0) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const supCol = state.columns.find(c =>
    c.type === 'number' &&
    ['útil', 'util', 'vendible', 'sup. út', 'sup út'].some(k => normStr(c.name).includes(normStr(k)))
  );
  const ufm2Col = state.columns.find(c =>
    normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m')
  );
  const tipoCol = state.columns.find(c =>
    ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
  );
  const edifCol = state.columns.find(c =>
    ['edificio', 'proyecto', 'building'].some(k => normStr(c.name).includes(k))
  );

  if (!supCol || !ufm2Col) return;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = $('#svpChart').getContext('2d');

  const tipoFilter = $('#svpTipoFilter')?.value ?? '';

  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  let rows = state.filtered;
  if (tipoFilter) {
    rows = rows.filter(r => tipoCol && String(r[tipoCol.name] ?? '') === tipoFilter);
  }

  // Mi Proyecto dataset (se construye primero para que aparezca primero en la leyenda)
  const mpDatasets = [];
  if (mp.inSvp && mp.tipologias.length > 0) {
    const mpColor = '#1e293b';
    const mpName  = mp.edificio || mp.propietario || 'Mi Proyecto';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.ufm2 != null);
    const mpFiltered = tipoFilter
      ? mpTipos.filter(t => fmtTipo(t.nombre) === fmtTipo(tipoFilter))
      : mpTipos;

    if (mpFiltered.length > 0) {
      mpDatasets.push({
        label: mpName,
        data: mpFiltered.map(t => ({ x: t.sup, y: t.ufm2, label: `${mpName} ${fmtTipo(t.nombre)}` })),
        backgroundColor: mpColor,
        borderColor: mpColor,
        borderWidth: 2,
        pointRadius: 7,
        pointHoverRadius: 9,
      });
    }
  }

  // Comparables: un punto por fila (sin promediar sub-tipologías)
  const compDatasets = [];
  if (tipoCol && !tipoFilter) {
    const tipoGroups = {};
    for (const r of rows) {
      const sup  = Number(r[supCol.name]);
      const ufm2 = Number(r[ufm2Col.name]);
      if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
      const tipo = fmtTipo(r[tipoCol.name]) || '—';
      const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
      if (!tipoGroups[tipo]) tipoGroups[tipo] = [];
      tipoGroups[tipo].push({ x: sup, y: ufm2, label: edif });
    }
    Object.keys(tipoGroups).sort().forEach((tipo, i) => {
      const hex = palette[i % palette.length];
      compDatasets.push({
        label: `Comparables ${tipo}`,
        data: tipoGroups[tipo],
        backgroundColor: hex + 'AA',
        borderColor: hex,
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    });
  } else {
    const pts = [];
    for (const r of rows) {
      const sup  = Number(r[supCol.name]);
      const ufm2 = Number(r[ufm2Col.name]);
      if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
      const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
      pts.push({ x: sup, y: ufm2, label: edif });
    }
    const tipo = tipoFilter ? fmtTipo(tipoFilter) : '';
    compDatasets.push({
      label: tipo ? `Comparables ${tipo}` : 'Comparables',
      data: pts,
      backgroundColor: palette[0] + 'AA',
      borderColor: palette[0],
      borderWidth: 1,
      pointRadius: 5,
      pointHoverRadius: 7,
    });
  }

  const datasets = [...mpDatasets, ...compDatasets];

  // ── Regresión lineal sobre todos los puntos comparables ──
  const allCompPts = compDatasets.flatMap(ds => ds.data);
  let reg = null;
  const showTrend = $('#svpTrendToggle')?.checked ?? true;
  if (showTrend && allCompPts.length >= 3) {
    reg = linearRegression(allCompPts);
    if (reg) {
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      datasets.push({
        label: `Tendencia  (R² = ${reg.r2.toFixed(2)})`,
        data: [
          { x: xMin, y: reg.m * xMin + reg.b },
          { x: xMax, y: reg.m * xMax + reg.b },
        ],
        showLine: true,
        borderColor: 'rgba(30,58,95,0.75)',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [7, 4],
        pointRadius: 0,
        fill: false,
        order: 0,
      });
    }
  }

  // Plugin inline: caja R² en esquina superior derecha del área del gráfico
  const svpR2Plugin = {
    id: 'svpR2',
    afterDraw(chart) {
      if (!reg) return;
      const { ctx: c, chartArea: { right, top } } = chart;
      const text = `R² = ${reg.r2.toFixed(3)}`;
      c.save();
      c.font = 'bold 12px system-ui, sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      const w = c.measureText(text).width;
      const pad = 6, h = 22, rx = right - w - pad * 2 - 2, ry = top + 6;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(rx, ry, w + pad * 2, h);
      c.strokeStyle = '#cbd5e1';
      c.lineWidth = 1;
      c.strokeRect(rx, ry, w + pad * 2, h);
      c.fillStyle = '#1e3a5f';
      c.fillText(text, right - pad, ry + h / 2);
      c.restore();
    },
  };

  state.chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    plugins: [svpR2Plugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: item => {
              if (item.dataset.showLine) return null; // ocultar tooltip en la línea
              const d = item.raw;
              const name = d.label ? `${d.label}: ` : '';
              return `${name}${Number(d.x).toLocaleString('es-CL')} m² · ${Number(d.y).toLocaleString('es-CL')} UF/m²`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Útil (m²)' },
          ticks: { callback: v => v.toLocaleString('es-CL') },
        },
        y: {
          title: { display: true, text: 'UF/m²' },
          ticks: { callback: v => v.toLocaleString('es-CL') },
        },
      },
    },
  });
}

// ============== Distribución (curva de precios) ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
let distribUnit = 'UF'; // unidad activa, se actualiza al renderizar

export function populateDistribSelectors() {
  const colSel = $('#distribCol');
  if (!colSel) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const ticketCol = state.columns.find(c => normStr(c.name).includes('ticket'));
  const ufm2Col   = state.columns.find(c => normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m'));

  colSel.innerHTML = '';
  if (ticketCol) {
    const o = document.createElement('option');
    o.value = ticketCol.name; o.textContent = 'Ticket UF';
    colSel.appendChild(o);
  }
  if (ufm2Col) {
    const o = document.createElement('option');
    o.value = ufm2Col.name; o.textContent = 'UF/m²';
    colSel.appendChild(o);
  }
  if (!colSel.options.length) {
    for (const col of state.columns) {
      if (col.type === 'number') {
        const o = document.createElement('option');
        o.value = col.name; o.textContent = col.name;
        colSel.appendChild(o);
        break;
      }
    }
  }

  colSel.addEventListener('change', renderDistrib);

  if (!distribListenersReady) {
    distribListenersReady = true;

    document.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const fontSlider = $('#distribFontSize');
    const fontVal    = $('#distribFontSizeVal');
    if (fontSlider) {
      fontSlider.addEventListener('input', () => {
        fontVal.textContent = fontSlider.value + 'px';
        renderDistrib();
      });
    }

    $('#distribExportPngBtn')?.addEventListener('click', async () => {
      if (!distribChart) return;
      const btn = $('#distribExportPngBtn');
      const scale = 4;
      const pad = 32;
      const wrap = $('#distribWrap');
      const ratio = document.querySelector('.ratio-btn.active')?.dataset.ratio ?? 'auto';

      const origDPR = distribChart.options.devicePixelRatio ?? window.devicePixelRatio;
      const exportW = wrap.clientWidth - pad;
      const exportH = ratio === 'auto'
        ? distribChart.height
        : Math.round(exportW / parseFloat(ratio));

      distribChart.options.devicePixelRatio = scale;
      distribChart.resize(exportW, exportH);
      const url = distribChart.toBase64Image('image/png', 1);

      distribChart.options.devicePixelRatio = origDPR;
      distribChart.resize();

      const res  = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);

      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    });

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
    tag.innerHTML = `${v.toLocaleString('es-CL')} ${distribUnit} <button data-val="${v}" class="rm-price">×</button>`;
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
  const colSel = $('#distribCol');
  if (!colSel || state.filtered.length === 0) return;

  const col = colSel.value;
  const _nc = col.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²' : 'UF';
  const fs = parseInt($('#distribFontSize')?.value ?? '11');

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart').getContext('2d');

  const refData = computeQuantileCurve(state.filtered, col);
  const datasets = [{
    label: col,
    data: refData,
    borderColor: palette[0],
    backgroundColor: 'rgba(59,130,246,0.08)',
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.4,
    fill: true,
  }];

  // Construir anotaciones
  const annotations = {};
  const pctColor   = '#ef4444';
  const priceColor = '#ef4444';

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const color = pctColor;
    const price = lerpAtX(refData, pct);
    if (price === null) return;
    const priceLabel = price.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `P${pct}`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${priceLabel} ${distribUnit}`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const color = priceColor;
    const pct   = lerpAtY(refData, price);
    const pctForLabel = pct !== null ? pct : 100;
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
      borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${price.toLocaleString('es-CL')} ${distribUnit}`, display: true, position: 'start',
        color, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
    if (pct !== null) {
      annotations[`prv_${price}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `P${pct.toFixed(1)}`, display: true, position: 'start',
          color, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
      };
    }
  });

  // Mi Proyecto annotations
  if (mp.inDistrib && mp.tipologias.length > 0) {
    const normFn  = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const nc      = normFn(col);
    const isUfm2   = nc.includes('uf/m') || nc.includes('uf / m');
    const isTicket = !isUfm2 && nc.includes('ticket');

    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => normFn(c.name).includes(k)));
    const fmtTipo = v => {
      const s = String(v ?? '').trim();
      return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
    };
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) {
        mpTipos = mpTipos.filter(t => activeTipos.has(fmtTipo(t.nombre)));
      }
    }

    const mpColor = '#1e3a5f';
    mpTipos.forEach(t => {
      let val = null;
      if (isUfm2)        val = t.ufm2;
      else if (isTicket) val = (t.sup != null && t.ufm2 != null) ? t.sup * t.ufm2 : null;
      else               val = t.sup;
      if (val == null) return;
      const pct = lerpAtY(refData, val);
      if (pct === null) return;
      const valLabel = val.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      annotations[`mp_h_${t.id}`] = {
        type: 'line', yMin: val, yMax: val, xMax: pct,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: {
          content: `${t.nombre}: ${valLabel}`,
          display: true, position: 'start',
          color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
        },
      };
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: val,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: {
          content: `P${pct.toFixed(1)}`,
          display: true, position: 'start',
          color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
        },
      };
    });
  }

  distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest',
          intersect: false,
          axis: 'x',
          callbacks: {
            title: items => `P${Number(items[0]?.parsed.x).toFixed(1)}`,
            label: item => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('es-CL', { maximumFractionDigits: 0 })} ${distribUnit}`,
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear', min: 0, max: 100,
          title: { display: true, text: 'Percentil (%)', font: { size: fs } },
          ticks: { callback: v => v + '%', font: { size: fs } },
        },
        y: {
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });

}