import { $, fmt } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

const palette = ['#1e3a5f','#2563eb','#7c3aed','#db2777','#d97706','#059669','#0891b2','#65a30d'];

const fmtNum = (v, dec = 1) =>
  v == null || isNaN(v) ? '—'
  : Number(v).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ============== KPIs ==============
export function renderKpis() {
  const rows = state.filtered;
  const cont = $('#kpis');
  if (!cont) return;
  cont.innerHTML = '';

  const avg = col => {
    const nums = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  };

  const kpis = [
    { label: 'Registros', value: rows.length.toLocaleString('es-CL'), sub: `de ${state.raw.length.toLocaleString('es-CL')}` },
  ];

  const proyCol = state.columns.find(c => ['proyecto', 'edificio', 'nombre'].some(k => c.name.toLowerCase().includes(k)));
  if (proyCol) {
    const proyectos = new Set(rows.map(r => r[proyCol.name]).filter(Boolean));
    kpis.push({ label: 'Proyectos únicos', value: proyectos.size.toLocaleString('es-CL') });
  }

  if (state.columns.find(c => c.name === 'Renta UF')) {
    kpis.push({
      label: 'Renta UF promedio',
      value: avg('Renta UF').toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      sub: 'UF/mes',
    });
  }
  if (state.columns.find(c => c.name === 'UF/m²')) {
    kpis.push({
      label: 'UF/<span class="keep-case">m²</span> promedio',
      value: avg('UF/m²').toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  }
  if (state.columns.find(c => c.name === 'Gastos Comunes (UF)')) {
    const v = avg('Gastos Comunes (UF)');
    if (v > 0) {
      kpis.push({
        label: 'Gastos Comunes prom.',
        value: v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        sub: 'UF/mes',
      });
    }
  }

  for (const k of kpis) {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `<div class="label">${k.label}</div><div class="value">${k.value}</div>${k.sub ? `<div class="sub">${k.sub}</div>` : ''}`;
    cont.appendChild(card);
  }
}

// ============== Proyectos ==============
const PROY_METRICS = [
  { id: 'renta',  label: 'Renta UF prom.',       keys: ['renta uf', 'precio'],  agg: 'avg',   fmt: v => fmtNum(v, 1) },
  { id: 'ufm2',   label: 'UF/m²',                keys: ['uf/m'],                agg: 'avg',   fmt: v => fmtNum(v, 2) },
  { id: 'util',   label: 'Útil (m²)',            keys: ['util (m', 'útil (m'],  agg: 'avg',   fmt: v => fmtNum(v, 0) },
  { id: 'gastos', label: 'Gastos Comunes (UF)',  keys: ['gastos comunes'],      agg: 'avg',   fmt: v => fmtNum(v, 1) },
  { id: 'count',  label: 'N° Unidades',          keys: [],                      agg: 'count', fmt: v => String(Math.round(v)) },
];

let proyChart = null;
let proyListenersReady = false;

export function populateProyectosSelectors() {
  if (proyListenersReady) return;
  proyListenersReady = true;
  $('#proyMetrica')?.addEventListener('change', renderProyectos);
  $('#proyExportPngBtn')?.addEventListener('click', () => {
    if (!proyChart) return;
    const a = document.createElement('a');
    a.href = proyChart.toBase64Image('image/png', 1);
    a.download = `proyectos_renta_${Date.now()}.png`;
    a.click();
  });
}

export function renderProyectos() {
  if (state.filtered.length === 0) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const metricId = $('#proyMetrica')?.value ?? 'renta';
  const metric   = PROY_METRICS.find(m => m.id === metricId) ?? PROY_METRICS[0];

  const edifCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre', 'building'].some(k => normStr(c.name).includes(k))
  )?.name;
  const metricCol = metricId === 'count' ? null : state.columns.find(c =>
    c.type === 'number' && metric.keys.some(k => normStr(c.name).includes(normStr(k)))
  )?.name;

  if (!edifCol) return;
  if (metricId !== 'count' && !metricCol) return;

  if (proyChart) { proyChart.destroy(); proyChart = null; }
  const ctx = $('#proyChart')?.getContext('2d');
  if (!ctx) return;

  const byEdif = {};
  for (const r of state.filtered) {
    const edif = String(r[edifCol] ?? '').trim();
    if (!edif) continue;
    if (!byEdif[edif]) byEdif[edif] = [];
    if (metricId === 'count') {
      byEdif[edif].push(1);
    } else {
      const val = Number(r[metricCol]);
      if (!isNaN(val) && val > 0) byEdif[edif].push(val);
    }
  }

  const aggFn = metric.agg === 'count'
    ? arr => arr.length
    : arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  let entries = Object.entries(byEdif)
    .filter(([, vals]) => vals.length > 0)
    .map(([edif, vals]) => [edif, aggFn(vals)]);

  let mpName = null;
  if (mp.inProy && (mp.proyecto || mp.edificio) && mp.tipologias.length > 0) {
    let mpVal = null;
    if (metricId === 'renta') {
      const vals = mp.tipologias.filter(t => t.renta != null).map(t => t.renta);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    } else if (metricId === 'ufm2') {
      const vals = mp.tipologias.filter(t => t.ufm2 != null).map(t => t.ufm2);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    } else if (metricId === 'util') {
      const vals = mp.tipologias.filter(t => t.sup != null).map(t => t.sup);
      if (vals.length) mpVal = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    if (mpVal !== null) {
      mpName = mp.proyecto || mp.edificio || 'Mi Proyecto';
      entries.push([mpName, mpVal]);
    }
  }

  entries = entries.sort((a, b) => b[1] - a[1]);

  const MP_COLOR  = '#f59e0b';
  const BAR_COLOR = '#1e3a5f';

  const barLabelsPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c } = chart;
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
        tooltip: { callbacks: { label: item => ` ${metric.fmt(item.raw)}` } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 11 } } },
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

// ============== Sup. vs Renta ==============
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
    tipoSel.addEventListener('change', renderSupVsRenta);
    $('#svpTrendToggle')?.addEventListener('change', renderSupVsRenta);
    $('#svpExportPngBtn')?.addEventListener('click', () => {
      if (!state.chart) return;
      const a = document.createElement('a');
      a.href = state.chart.toBase64Image('image/png', 1);
      a.download = `sup_vs_renta_${Date.now()}.png`;
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

export function renderSupVsRenta() {
  if (state.filtered.length === 0) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const supCol = state.columns.find(c =>
    c.type === 'number' && ['util (m', 'útil (m', 'metros util'].some(k => normStr(c.name).includes(normStr(k)))
  );
  const rentaCol = state.columns.find(c =>
    normStr(c.name).includes('renta uf') || normStr(c.name).includes('precio')
  );
  const tipoCol = state.columns.find(c =>
    ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
  );
  const proyCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre'].some(k => normStr(c.name).includes(k))
  );

  if (!supCol || !rentaCol) return;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = $('#svpChart')?.getContext('2d');
  if (!ctx) return;

  const tipoFilter = $('#svpTipoFilter')?.value ?? '';
  let rows = state.filtered;
  if (tipoFilter) {
    rows = rows.filter(r => tipoCol && String(r[tipoCol.name] ?? '') === tipoFilter);
  }

  const mpDatasets = [];
  if (mp.inSvp && mp.tipologias.length > 0) {
    const mpColor = '#1e293b';
    const mpPName = mp.proyecto || mp.edificio || 'Mi Proyecto';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.renta != null);
    const mpFiltered = tipoFilter
      ? mpTipos.filter(t => String(t.nombre).toUpperCase() === tipoFilter.toUpperCase())
      : mpTipos;
    if (mpFiltered.length > 0) {
      mpDatasets.push({
        label: mpPName,
        data: mpFiltered.map(t => ({ x: t.sup, y: t.renta, label: `${mpPName} ${t.nombre}` })),
        backgroundColor: mpColor,
        borderColor: mpColor,
        borderWidth: 2,
        pointRadius: 7,
        pointHoverRadius: 9,
      });
    }
  }

  const compDatasets = [];
  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  if (tipoCol && !tipoFilter) {
    const tipoGroups = {};
    for (const r of rows) {
      const sup   = Number(r[supCol.name]);
      const renta = Number(r[rentaCol.name]);
      if (isNaN(sup) || isNaN(renta) || sup <= 0 || renta <= 0) continue;
      const tipo = fmtTipo(r[tipoCol.name]) || '—';
      const proy = proyCol ? String(r[proyCol.name] ?? '—') : '—';
      if (!tipoGroups[tipo]) tipoGroups[tipo] = [];
      tipoGroups[tipo].push({ x: sup, y: renta, label: proy });
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
      const sup   = Number(r[supCol.name]);
      const renta = Number(r[rentaCol.name]);
      if (isNaN(sup) || isNaN(renta) || sup <= 0 || renta <= 0) continue;
      const proy = proyCol ? String(r[proyCol.name] ?? '—') : '—';
      pts.push({ x: sup, y: renta, label: proy });
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

  const allCompPts = compDatasets.flatMap(ds => ds.data);
  let reg = null;
  const showTrend = $('#svpTrendToggle')?.checked ?? true;
  if (showTrend && allCompPts.length >= 3) {
    reg = linearRegression(allCompPts);
    if (reg) {
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      datasets.push({
        label: `Tendencia (R² = ${reg.r2.toFixed(2)})`,
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
              if (item.dataset.showLine) return null;
              const d = item.raw;
              const name = d.label ? `${d.label}: ` : '';
              return `${name}${Number(d.x).toLocaleString('es-CL')} m² · ${Number(d.y).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/mes`;
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
          title: { display: true, text: 'Renta UF/mes' },
          ticks: { callback: v => v.toLocaleString('es-CL') },
        },
      },
    },
  });
}

// ============== Distribución ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };

export function populateDistribSelectors() {
  const sel = $('#distribCol');
  if (!sel) return;
  sel.innerHTML = '';

  const priority = ['Renta UF', 'UF/m²', 'Útil (m²)', 'Gastos Comunes (UF)', 'Total (m²)'];
  const numCols = state.columns.filter(c => c.type === 'number' && !c.name.startsWith('__'));
  const sorted = [
    ...priority.filter(name => numCols.find(c => c.name === name)),
    ...numCols.filter(c => !priority.includes(c.name)).map(c => c.name),
  ];

  for (const name of sorted) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }

  if (!distribListenersReady) {
    distribListenersReady = true;
    sel.addEventListener('change', renderDistrib);
    $('#distribCumulToggle')?.addEventListener('change', renderDistrib);
    _setupMarkers();
  }
}

function _setupMarkers() {
  $('#distribAddPct')?.addEventListener('click', () => {
    const v = parseInt($('#distribPctInput').value);
    if (isNaN(v) || v < 1 || v > 99) return;
    distribMarkers.percentiles.add(v);
    _renderMarkerTags('#distribPctTags', distribMarkers.percentiles, 'pct');
    renderDistrib();
  });
  $('#distribAddPrice')?.addEventListener('click', () => {
    const v = parseFloat($('#distribPriceInput').value);
    if (isNaN(v) || v < 0) return;
    distribMarkers.prices.add(v);
    _renderMarkerTags('#distribPriceTags', distribMarkers.prices, 'price');
    renderDistrib();
  });
}

function _renderMarkerTags(selector, set, type) {
  const cont = document.querySelector(selector);
  if (!cont) return;
  cont.innerHTML = '';
  for (const v of [...set].sort((a, b) => a - b)) {
    const tag = document.createElement('span');
    tag.className = `marker-tag ${type}-tag`;
    tag.innerHTML = `${type === 'pct' ? 'P' + v : v.toLocaleString('es-CL') + (type === 'price' ? ' UF' : '')} <button data-val="${v}">×</button>`;
    tag.querySelector('button').addEventListener('click', () => {
      set.delete(v);
      _renderMarkerTags(selector, set, type);
      renderDistrib();
    });
    cont.appendChild(tag);
  }
}

export function renderDistrib() {
  if (state.filtered.length === 0) return;
  const colName = $('#distribCol')?.value;
  if (!colName) return;

  const isCumulative = $('#distribCumulToggle')?.checked ?? false;

  const values = state.filtered
    .map(r => Number(r[colName]))
    .filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);

  if (!values.length) return;

  // Función para obtener percentil exacto
  const percentile = (pct) => {
    if (pct === 0) return values[0];
    const idx = Math.ceil((pct / 100) * values.length) - 1;
    return values[Math.max(0, Math.min(idx, values.length - 1))];
  };

  // Mi Proyecto overlay
  let mpVals = [];
  if (mp.inDistrib && mp.tipologias.length > 0) {
    for (const t of mp.tipologias) {
      if (colName === 'Renta UF' && t.renta != null) mpVals.push(t.renta);
      else if (colName === 'UF/m²' && t.ufm2 != null) mpVals.push(t.ufm2);
      else if ((colName === 'Útil (m²)' || colName === 'Total (m²)') && t.sup != null) mpVals.push(t.sup);
    }
  }

  let labels = [];
  let plotData = [];
  const annotations = {};

  if (isCumulative) {
    // ---- MODO ACUMULADO (CURVA DE PERCENTILES) ----
    for (let i = 0; i <= 100; i++) {
      labels.push(i);
      plotData.push(percentile(i));
    }

    // 1. MARCADORES DE PERCENTIL (Eje X -> Curva -> Eje Y)
    for (const pct of distribMarkers.percentiles) {
      const val = percentile(pct);
      
      // Línea vertical: Desde el eje X (abajo) hasta el valor en la curva
      annotations[`pct${pct}_v`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: pct, xMax: pct, yMax: val,
        borderColor: '#7c3aed', borderWidth: 2, borderDash: [5, 3],
        label: { content: `P${pct}`, display: true, position: 'start', font: { size: 10 }, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)' }
      };
      // Línea horizontal: Desde el eje Y (izquierda) hasta el valor en la curva
      annotations[`pct${pct}_h`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: 0, xMax: pct, yMin: val, yMax: val,
        borderColor: '#7c3aed', borderWidth: 2, borderDash: [5, 3],
        label: { content: `${val.toLocaleString('es-CL', { maximumFractionDigits: 1 })}`, display: true, position: 'start', font: { size: 10 }, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)' }
      };
    }

    // 2. MARCADORES DE PRECIO (Eje Y -> Curva -> Eje X)
    for (const price of distribMarkers.prices) {
      const countBelow = values.filter(v => v <= price).length;
      const calcPct = Math.round((countBelow / values.length) * 100);
      
      // Línea horizontal: Desde el eje Y (izquierda) hasta el valor en la curva
      annotations[`price${price}_h`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: 0, xMax: calcPct, yMin: price, yMax: price,
        borderColor: '#db2777', borderWidth: 2, borderDash: [5, 3],
        label: { content: `${price.toLocaleString('es-CL')} UF`, display: true, position: 'start', font: { size: 10 }, color: '#db2777', backgroundColor: 'rgba(219,39,119,0.1)' }
      };
      // Línea vertical: Desde el eje X (abajo) hasta la curva para mostrar a qué percentil equivale
      annotations[`price${price}_v`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: calcPct, xMax: calcPct, yMax: price,
        borderColor: '#db2777', borderWidth: 2, borderDash: [5, 3],
        label: { content: `P${calcPct}`, display: true, position: 'start', font: { size: 10 }, color: '#db2777', backgroundColor: 'rgba(219,39,119,0.1)' }
      };
    }

    // 3. MARCADORES DE MI PROYECTO (Eje Y -> Curva -> Eje X)
    for (const mpV of mpVals) {
      const countBelow = values.filter(v => v <= mpV).length;
      const calcPct = Math.round((countBelow / values.length) * 100);

      annotations[`mp${mpV}_h`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: 0, xMax: calcPct, yMin: mpV, yMax: mpV,
        borderColor: '#f59e0b', borderWidth: 2.5,
        label: { content: `Mi Proyecto`, display: true, position: 'start', font: { size: 10, weight: 'bold' }, color: '#d97706', backgroundColor: 'rgba(245,158,11,0.12)' }
      };
      annotations[`mp${mpV}_v`] = {
        type: 'line', xScaleID: 'x', yScaleID: 'y',
        xMin: calcPct, xMax: calcPct, yMax: mpV,
        borderColor: '#f59e0b', borderWidth: 2.5, borderDash: [4, 4],
        label: { content: `P${calcPct}`, display: true, position: 'start', font: { size: 10, weight: 'bold' }, color: '#d97706', backgroundColor: 'rgba(245,158,11,0.12)' }
      };
    }

  } else {
    // ---- MODO NORMAL (HISTOGRAMA) ----
    const bins = Math.min(40, Math.max(10, Math.round(Math.sqrt(values.length))));
    const minV = values[0], maxV = values[values.length - 1];
    const step = (maxV - minV) / bins || 1;

    const counts = Array(bins).fill(0);
    for (let i = 0; i < bins; i++) {
      const lo = minV + i * step;
      labels.push(lo.toLocaleString('es-CL', { maximumFractionDigits: 1 }));
    }
    for (const v of values) {
      let idx = Math.floor((v - minV) / step);
      idx = Math.min(idx, bins - 1);
      counts[idx]++;
    }
    plotData = counts;

    for (const pct of distribMarkers.percentiles) {
      const val = percentile(pct);
      const binIdx = Math.min(Math.floor((val - minV) / step), bins - 1);
      annotations[`pct${pct}`] = {
        type: 'line', scaleID: 'x', value: binIdx,
        borderColor: '#7c3aed', borderWidth: 2, borderDash: [5, 3],
        label: { content: `P${pct}: ${val.toLocaleString('es-CL', { maximumFractionDigits: 1 })}`, display: true, position: 'start', font: { size: 10 }, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)' },
      };
    }
    for (const price of distribMarkers.prices) {
      const binIdx = Math.min(Math.floor((price - minV) / step), bins - 1);
      annotations[`price${price}`] = {
        type: 'line', scaleID: 'x', value: binIdx,
        borderColor: '#db2777', borderWidth: 2, borderDash: [5, 3],
        label: { content: `${price.toLocaleString('es-CL')}`, display: true, position: 'end', font: { size: 10 }, color: '#db2777', backgroundColor: 'rgba(219,39,119,0.1)' },
      };
    }
    for (const mpV of mpVals) {
      const binIdx = Math.min(Math.floor((mpV - minV) / step), bins - 1);
      annotations[`mp${mpV}`] = {
        type: 'line', scaleID: 'x', value: binIdx,
        borderColor: '#f59e0b', borderWidth: 2.5,
        label: { content: `Mi Proyecto: ${mpV.toLocaleString('es-CL', { maximumFractionDigits: 1 })}`, display: true, position: 'center', font: { size: 10, weight: 'bold' }, color: '#d97706', backgroundColor: 'rgba(245,158,11,0.12)' },
      };
    }
  }

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart')?.getContext('2d');
  if (!ctx) return;

  distribChart = new Chart(ctx, {
    type: isCumulative ? 'line' : 'bar',
    data: {
      labels,
      datasets: [{
        label: colName,
        data: plotData,
        backgroundColor: isCumulative ? 'rgba(30,58,95,0.05)' : '#1e3a5fCC',
        borderColor: '#1e3a5f',
        borderWidth: isCumulative ? 2.5 : 1,
        borderRadius: isCumulative ? 0 : 2,
        fill: isCumulative,
        pointRadius: 0,
        pointHoverRadius: isCumulative ? 5 : 0, 
        tension: isCumulative ? 0.3 : 0
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        tooltip: {
          callbacks: {
            title: items => {
              if (isCumulative) return `Percentil ${items[0].label}%`;
              const i = items[0].dataIndex;
              const minV = values[0];
              const maxV = values[values.length - 1];
              const step = (maxV - minV) / Math.min(40, Math.max(10, Math.round(Math.sqrt(values.length)))) || 1;
              const lo = minV + i * step;
              const hi = lo + step;
              return `${lo.toLocaleString('es-CL', { maximumFractionDigits: 1 })} – ${hi.toLocaleString('es-CL', { maximumFractionDigits: 1 })}`;
            },
            label: item => {
              if (isCumulative) return ` Valor: ${item.raw.toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${colName.includes('UF') ? 'UF' : ''}`;
              return ` ${item.raw} unidades`;
            },
          },
        },
      },
      scales: {
        x: { 
          title: { display: true, text: isCumulative ? 'Percentil (%)' : colName },
          ticks: { 
            callback: function(value, index) {
              if (isCumulative) return index % 10 === 0 ? index + '%' : '';
              return this.getLabelForValue(value);
            }
          }
        },
        y: { 
          title: { display: true, text: isCumulative ? colName : 'Unidades' }, 
          beginAtZero: !isCumulative
        },
      },
    },
  });
}