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

// ============== Distribución (CDF) ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };

function _colUnit(colName) {
  if (colName.includes('m²')) return 'm²';
  if (colName.includes('UF')) return 'UF';
  return '';
}

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

  const values = state.filtered
    .map(r => Number(r[colName]))
    .filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);

  if (!values.length) return;

  const n = values.length;
  const unit = _colUnit(colName);

  // Percentil exacto: índice basado en el rango 0-100
  const percentile = pct => {
    if (pct <= 0) return values[0];
    if (pct >= 100) return values[n - 1];
    const idx = Math.ceil((pct / 100) * n) - 1;
    return values[Math.max(0, Math.min(idx, n - 1))];
  };

  // Qué percentil corresponde a un valor dado
  const valueToPct = val => Math.round((values.filter(v => v <= val).length / n) * 100);

  // Datos de la curva CDF: 101 puntos (P0 a P100)
  const labels = Array.from({ length: 101 }, (_, i) => i);
  const cdfData = labels.map(pct => percentile(pct));

  // Estilo compartido de anotación
  const annotLine = (scaleID, value, color, dash = [6, 4]) => ({
    type: 'line', scaleID, value,
    borderColor: color, borderWidth: 1.5, borderDash: dash,
  });
  const annotLabel = (content, position, color) => ({
    content, display: true, position,
    color, font: { size: 11, weight: 'bold' },
    backgroundColor: 'transparent', padding: { x: 3, y: 2 },
  });

  const annotations = {};

  // ── Percentiles (rojo) ─────────────────────────────────────
  for (const pct of distribMarkers.percentiles) {
    const val = percentile(pct);
    const valLabel = `${val.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`;

    annotations[`pct_v_${pct}`] = {
      ...annotLine('x', pct, '#ef4444'),
      label: annotLabel(`P${pct}`, 'end', '#ef4444'),
    };
    annotations[`pct_h_${pct}`] = {
      ...annotLine('y', val, '#ef4444'),
      label: annotLabel(valLabel, 'start', '#ef4444'),
    };
  }

  // ── Precios marcados (rojo oscuro) ─────────────────────────
  for (const price of distribMarkers.prices) {
    const calcPct = valueToPct(price);
    const priceLabel = `${price.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`;

    annotations[`price_h_${price}`] = {
      ...annotLine('y', price, '#dc2626'),
      label: annotLabel(priceLabel, 'start', '#dc2626'),
    };
    annotations[`price_v_${price}`] = {
      ...annotLine('x', calcPct, '#dc2626'),
      label: annotLabel(`P${calcPct}`, 'end', '#dc2626'),
    };
  }

  // ── Mi Proyecto (ámbar) ────────────────────────────────────
  let mpVals = [];
  if (mp.inDistrib && mp.tipologias.length > 0) {
    for (const t of mp.tipologias) {
      if (colName === 'Renta UF' && t.sup != null && t.ufm2 != null) mpVals.push(t.sup * t.ufm2);
      else if (colName === 'UF/m²' && t.ufm2 != null) mpVals.push(t.ufm2);
      else if ((colName === 'Útil (m²)' || colName === 'Total (m²)') && t.sup != null) mpVals.push(t.sup);
    }
  }
  for (const mpV of mpVals) {
    const calcPct = valueToPct(mpV);
    const mpLabel = `${mpV.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`;
    annotations[`mp_h_${mpV}`] = {
      ...annotLine('y', mpV, '#f59e0b', []),
      label: annotLabel(`★ ${mpLabel}`, 'start', '#d97706'),
    };
    annotations[`mp_v_${mpV}`] = {
      ...annotLine('x', calcPct, '#f59e0b', [5, 3]),
      label: annotLabel(`P${calcPct}`, 'end', '#d97706'),
    };
  }

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart')?.getContext('2d');
  if (!ctx) return;

  distribChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: colName,
        data: cdfData,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
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
            title: items => `Percentil ${items[0].label}%`,
            label: item => ` ${item.raw.toLocaleString('es-CL', { maximumFractionDigits: 2 })}${unit ? ' ' + unit : ''}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0, max: 100,
          title: { display: true, text: 'Percentil (%)' },
          ticks: {
            stepSize: 10,
            callback: v => `${v}%`,
          },
        },
        y: {
          title: { display: true, text: colName },
          beginAtZero: false,
          ticks: { callback: v => v.toLocaleString('es-CL') },
        },
      },
    },
  });
}