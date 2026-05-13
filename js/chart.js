import { $, fmt } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

// ── Normal distribution helpers ───────────────────────────────────────────

function _probit(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  const a = [-3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
  const d = [ 7.784695709041462e-03,  3.224671290700398e-01,  2.445134137142996e+00,
              3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function _computeHistogram(sortedVals) {
  const n = sortedVals.length;
  const binCount = Math.min(50, Math.max(10, Math.ceil(Math.log2(n) + 1)));
  const minV = sortedVals[0], maxV = sortedVals[n - 1];
  const bw = (maxV - minV) / binCount;
  if (bw === 0) return { bins: [], bw: 0 };
  const bins = Array.from({ length: binCount }, (_, i) => ({ x: minV + (i + 0.5) * bw, y: 0 }));
  for (const v of sortedVals) {
    const i = Math.min(Math.floor((v - minV) / bw), binCount - 1);
    bins[i].y += 100 / n;
  }
  return { bins, bw };
}

function _computeKDE(sortedVals, sigma, histBw, evalPoints = 120) {
  const n = sortedVals.length;
  const h = Math.max(1.06 * sigma * Math.pow(n, -0.2), histBw * 0.1);
  const x0 = sortedVals[0] - 2 * sigma, x1 = sortedVals[n - 1] + 2 * sigma;
  const step = (x1 - x0) / evalPoints;
  const INV_SQRT2PI = 1 / Math.sqrt(2 * Math.PI);
  return Array.from({ length: evalPoints }, (_, i) => {
    const x = x0 + (i + 0.5) * step;
    let sum = 0;
    for (const xi of sortedVals) { const u = (x - xi) / h; sum += Math.exp(-0.5 * u * u); }
    return { x, y: (sum / (n * h)) * INV_SQRT2PI * histBw * 100 };
  });
}

function _normalPDFcurve(mu, sigma, histBw, x0, x1, points = 120) {
  const step = (x1 - x0) / points;
  const INV_SQRT2PI = 1 / Math.sqrt(2 * Math.PI);
  return Array.from({ length: points }, (_, i) => {
    const x = x0 + (i + 0.5) * step;
    return { x, y: INV_SQRT2PI / sigma * Math.exp(-0.5 * ((x - mu) / sigma) ** 2) * histBw * 100 };
  });
}

function _computeNormalFit(sortedVals, refData) {
  const n = sortedVals.length;
  if (n < 3) return null;
  const mu    = sortedVals.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(sortedVals.reduce((s, v) => s + (v - mu) ** 2, 0) / n);
  if (sigma === 0) return null;
  const curve = Array.from({ length: 99 }, (_, i) => {
    const pct = i + 1;
    return { x: pct, y: mu + sigma * _probit(pct / 100) };
  });
  let ssRes = 0, ssTot = 0;
  const slice = refData.slice(5, 96);
  const empMean = slice.reduce((s, p) => s + p.y, 0) / slice.length;
  for (let pct = 5; pct <= 95; pct++) {
    const emp  = refData[pct].y;
    const theo = mu + sigma * _probit(pct / 100);
    ssRes += (emp - theo) ** 2;
    ssTot += (emp - empMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { curve, mu, sigma, r2 };
}

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

const PROY_UNITS = { ticket: 'UF', ufm2: 'UF/m²', util: 'm²', disp: 'un.', vel: 'un./mes', oferta: 'un.', pct: '' };

const PROY_METRICS = [
  { id: 'ticket', label: 'Ticket UF',            keys: ['ticket'],                      agg: 'avg', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'ufm2',   label: 'UF/m²',               keys: ['uf/m', 'uf / m'],              agg: 'avg', fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { id: 'util',   label: 'Útil (m²)',            keys: ['útil', 'util', 'vendible'],    agg: 'avg', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'disp',   label: 'Disponibles',          keys: ['disponib'],                    agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'vel',    label: 'Vel. Venta (un./mes)', keys: ['vel. venta', 'vel venta'],     agg: 'avg', fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) },
  { id: 'oferta', label: 'Oferta total proyecto',keys: ['oferta total', 'oferta'],      agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'pct',    label: '% Vendido',            keys: ['% vendido', 'pct vendido', 'vendido'], agg: 'avg', fmt: v => {
    const pct = Math.abs(v) <= 1.05 ? v * 100 : v;
    return pct.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%';
  }},
];

function _withMargin(dataUrl, m) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width + m * 2; c.height = img.height + m * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, m, m);
      c.toBlob(resolve, 'image/png');
    };
    img.src = dataUrl;
  });
}

export function populateProyectosSelectors() {
  const sel = $('#proyMetrica');
  if (!sel || proyListenersReady) return;
  proyListenersReady = true;
  sel.addEventListener('change', renderProyectos);

  const proyFontSlider = $('#proyFontSize');
  const proyFontVal    = $('#proyFontSizeVal');
  if (proyFontSlider) {
    proyFontSlider.addEventListener('input', () => {
      proyFontVal.textContent = proyFontSlider.value + 'px';
      renderProyectos();
    });
  }

  document.querySelectorAll('.proy-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.proy-xrot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-xrot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProyectos();
    });
  });

  document.querySelectorAll('.proy-median-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-median-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProyectos();
    });
  });

  $('#proyExportPngBtn')?.addEventListener('click', async () => {
    if (!proyChart) return;
    const btn = $('#proyExportPngBtn');
    const scale = 4;
    const pad = 32;
    const wrap = $('#proyWrap');
    const ratio = document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto';

    const origDPR = proyChart.options.devicePixelRatio ?? window.devicePixelRatio;
    const exportW = wrap.clientWidth - pad;
    const exportH = ratio === 'auto'
      ? proyChart.height
      : Math.round(exportW / parseFloat(ratio));

    proyChart.options.devicePixelRatio = scale;
    proyChart.resize(exportW, exportH);
    const url = proyChart.toBase64Image('image/png', 1);
    proyChart.options.devicePixelRatio = origDPR;
    proyChart.resize();
    const prev = btn.textContent;
    const blob = await _withMargin(url, 64);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    btn.textContent = '¡Copiado!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
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

  const fs = parseInt($('#proyFontSize')?.value ?? '11');
  const xRot = document.querySelector('.proy-xrot-btn.active')?.dataset.rot ?? 'diagonal';
  const xMaxRot = xRot === 'vertical' ? 90 : 45;
  const xMinRot = xRot === 'vertical' ? 90 : 30;
  const showMedian = (document.querySelector('.proy-median-btn.active')?.dataset.median ?? 'show') === 'show';

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
  let mpVal  = null;
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

  // Mediana de edificios comparables (excluye Mi Proyecto)
  const compVals = entries.filter(([e]) => e !== mpName).map(([, v]) => v).slice().sort((a, b) => a - b);
  let median = null;
  if (compVals.length > 0) {
    const mid = Math.floor(compVals.length / 2);
    median = compVals.length % 2 === 0 ? (compVals[mid - 1] + compVals[mid]) / 2 : compVals[mid];
  }

  const MP_COLOR  = '#96323C';
  const BAR_COLOR = '#DDE0E3';

  // Plugin inline para etiquetas permanentes sobre cada barra
  const barLabelsPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c, scales } = chart;
      const meta = chart.getDatasetMeta(0);
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const value = entries[i]?.[1];
        if (value == null) return;
        const isMP = entries[i]?.[0] === mpName;
        c.fillStyle = isMP ? '#96323C' : '#374151';
        c.fillText(metric.fmt(value), bar.x, bar.y - 3);
      });
      c.restore();
    },
  };

  const medianPlugin = {
    id: 'medianPlugin',
    afterDraw(chart) {
      if (median == null) return;
      const { ctx: c, chartArea, scales } = chart;
      const y = scales.y.getPixelForValue(median);
      if (y < chartArea.top || y > chartArea.bottom) return;
      const unit = PROY_UNITS[metricId] ? ' ' + PROY_UNITS[metricId] : '';
      const line1 = `Mediana: ${metric.fmt(median)}${unit}`;
      const lines = [line1];
      if (mpVal != null && mpVal > 0 && median !== mpVal) {
        const diff = ((median - mpVal) / mpVal) * 100;
        const abs = Math.abs(diff).toLocaleString('es-CL', { maximumFractionDigits: 0 });
        lines.push(`(${abs}% ${diff > 0 ? 'mayor' : 'menor'} al proyecto)`);
      }
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      const padX = 8, padY = 4, lineH = fs + 4;
      const labelW = Math.max(...lines.map(l => c.measureText(l).width)) + padX * 2;
      const labelH = lines.length * lineH + padY * 2;
      const labelX = chartArea.right - labelW;
      const labelY = y - labelH / 2;
      c.setLineDash([6, 4]);
      c.strokeStyle = '#ef4444';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(chartArea.left, y);
      c.lineTo(labelX - 4, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(labelX, labelY, labelW, labelH);
      c.fillStyle = '#ef4444';
      c.textAlign = 'left';
      c.textBaseline = 'top';
      lines.forEach((line, i) => c.fillText(line, labelX + padX, labelY + padY + i * lineH));
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
        backgroundColor: entries.map(([e]) => e === mpName ? MP_COLOR : BAR_COLOR),
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 40, right: 20, bottom: 12, left: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: item => ` ${metric.fmt(item.raw)}` },
        },
      },
      scales: {
        x: {
          ticks: { maxRotation: xMaxRot, minRotation: xMinRot, font: { size: fs } },
          grid: { display: false },
        },
        y: {
          title: { display: false },
          ticks: { callback: v => metric.fmt(v), font: { size: fs } },
          beginAtZero: false,
          grid: { display: false },
        },
      },
    },
    plugins: [barLabelsPlugin, ...(showMedian ? [medianPlugin] : []), {
      id: 'yAxisHLabel',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const labelY = Math.max(chartArea.top - 22, fs + 4);
        const labelX = Math.max(chartArea.left, ctx.measureText(metric.label).width + 4);
        ctx.fillText(metric.label, labelX, labelY);
        ctx.restore();
      },
    }, {
      id: 'proySettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const text = `${ratioMap[ratioVal] ?? ratioVal} · ${fs}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
  });
}

// ============== Sup. vs Precio ==============
let svpListenersReady = false;

// Estado del triángulo de pendiente (draggable)
let svpSlopeXPct   = 0.22;   // posición a lo largo del eje X (0–1)
let svpSlopeDragging = false;
let svpSlopeBbox   = null;    // { x, y, w, h } en coordenadas canvas (CSS px)

const _svpSlpDown = e => {
  if (!svpSlopeBbox) return;
  const r = e.currentTarget.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (mx >= svpSlopeBbox.x && mx <= svpSlopeBbox.x + svpSlopeBbox.w &&
      my >= svpSlopeBbox.y && my <= svpSlopeBbox.y + svpSlopeBbox.h) {
    svpSlopeDragging = true;
    e.preventDefault();
  }
};
const _svpSlpMove = e => {
  const canvas = e.currentTarget;
  const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
  if (!showTrend || !svpSlopeBbox) { canvas.style.cursor = ''; return; }
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (!svpSlopeDragging) {
    const hit = mx >= svpSlopeBbox.x && mx <= svpSlopeBbox.x + svpSlopeBbox.w &&
                my >= svpSlopeBbox.y && my <= svpSlopeBbox.y + svpSlopeBbox.h;
    canvas.style.cursor = hit ? 'grab' : '';
    return;
  }
  canvas.style.cursor = 'grabbing';
  if (!state.chart) return;
  const { scales } = state.chart;
  const xMin = scales.x.min, xMax = scales.x.max, range = xMax - xMin;
  const dataX = scales.x.getValueForPixel(mx);
  svpSlopeXPct = Math.max(0.02, Math.min(0.78, (dataX - xMin) / range));
  state.chart.update('none');
};
const _svpSlpUp = e => {
  svpSlopeDragging = false;
  e.currentTarget.style.cursor = '';
};

export function populateSvpSelectors() {
  if (!$('#svpExportPngBtn')) return;

  if (!svpListenersReady) {
    svpListenersReady = true;

    document.querySelector('.svp-tend-btn')?.addEventListener('click', () => {
      document.querySelector('.svp-tend-btn').classList.toggle('active');
      renderSupVsPrecio();
    });
    document.querySelector('.svp-pred-btn')?.addEventListener('click', () => {
      document.querySelector('.svp-pred-btn').classList.toggle('active');
      state.chart?.update();
    });

    document.querySelectorAll('.svp-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.svp-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const svpFontSlider = $('#svpFontSize');
    if (svpFontSlider) {
      svpFontSlider.addEventListener('input', () => {
        $('#svpFontSizeVal').textContent = svpFontSlider.value + 'px';
        renderSupVsPrecio();
      });
    }

    $('#svpExportPngBtn')?.addEventListener('click', async () => {
      if (!state.chart) return;
      const btn = $('#svpExportPngBtn');
      const scale = 4;
      const pad = 32;
      const wrap = $('#svpWrap');
      const ratio = document.querySelector('.svp-ratio-btn.active')?.dataset.ratio ?? 'auto';

      const origDPR = state.chart.options.devicePixelRatio ?? window.devicePixelRatio;
      const exportW = wrap.clientWidth - pad;
      const exportH = ratio === 'auto'
        ? state.chart.height
        : Math.round(exportW / parseFloat(ratio));

      state.chart.options.devicePixelRatio = scale;
      state.chart.resize(exportW, exportH);
      const url = state.chart.toBase64Image('image/png', 1);
      state.chart.options.devicePixelRatio = origDPR;
      state.chart.resize();

      const blob = await _withMargin(url, 64);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
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
  const r2adj = n > 2 ? 1 - (1 - r2) * (n - 1) / (n - 2) : r2;
  return { m, b, r2, r2adj };
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

  const fs = parseInt($('#svpFontSize')?.value ?? '12');
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

  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  const rows = state.filtered;

  // Tipologías activas según state.filtered (respeta el filtro del sidebar)
  const activeTipos = tipoCol
    ? new Set(rows.map(r => fmtTipo(r[tipoCol.name])).filter(Boolean))
    : null;

  // Mi Proyecto dataset (se construye primero para que aparezca primero en la leyenda)
  let mpFiltered = [];
  const mpDatasets = [];
  if (mp.inSvp && mp.tipologias.length > 0) {
    const mpColor = '#1e293b';
    const mpName  = mp.edificio || mp.propietario || 'Mi Proyecto';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.ufm2 != null);
    mpFiltered = activeTipos
      ? mpTipos.filter(t => activeTipos.has(fmtTipo(t.nombre)))
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

  // Muestras: un punto por fila, coloreado por tipología pero un solo ítem en la leyenda
  const compDatasets = [];
  if (tipoCol) {
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
    const allPts = [];
    Object.keys(tipoGroups).sort().forEach(tipo => {
      for (const pt of tipoGroups[tipo]) allPts.push(pt);
    });
    compDatasets.push({
      label: 'Muestras',
      data: allPts,
      backgroundColor: palette[0] + 'AA',
      borderColor: palette[0],
      borderWidth: 1,
      pointRadius: 5,
      pointHoverRadius: 7,
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
    compDatasets.push({
      label: 'Muestras',
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
  const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
  if (showTrend && allCompPts.length >= 3) {
    reg = linearRegression(allCompPts);
    if (reg) {
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      datasets.push({
        label: `Tendencia  (R² = ${reg.r2.toFixed(2)},  R² aj. = ${reg.r2adj.toFixed(2)})`,
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



  // Plugin: predicción de la regresión para cada tipología de Mi Proyecto
  const svpMpPredPlugin = {
    id: 'svpMpPred',
    afterDraw(chart) {
      const showPred = document.querySelector('.svp-pred-btn')?.classList.contains('active') ?? false;
      if (!reg || !mpFiltered.length || !showPred) return;
      const { ctx: c, scales, chartArea: ca } = chart;
      c.save();
      for (const t of mpFiltered) {
        const predY   = reg.m * t.sup + reg.b;
        const px      = scales.x.getPixelForValue(t.sup);
        const pyPred  = scales.y.getPixelForValue(predY);
        const pyReal  = scales.y.getPixelForValue(t.ufm2);
        if (px < ca.left || px > ca.right || pyPred < ca.top || pyPred > ca.bottom) continue;

        // Línea vertical punteada del punto real al predicho
        c.setLineDash([4, 3]);
        c.strokeStyle = '#64748b';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(px, Math.min(Math.max(pyReal, ca.top), ca.bottom));
        c.lineTo(px, pyPred);
        c.stroke();
        c.setLineDash([]);

        // Cruz (×) en la regresión
        const r = 5;
        c.strokeStyle = '#ef4444';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(px - r, pyPred - r); c.lineTo(px + r, pyPred + r);
        c.moveTo(px + r, pyPred - r); c.lineTo(px - r, pyPred + r);
        c.stroke();

        // Caja con el valor predicho
        const label = `${fmtTipo(t.nombre)}: ${predY.toLocaleString('es-CL', { maximumFractionDigits: 0 })} UF/m²`;
        c.font = `bold ${fs}px system-ui, sans-serif`;
        const tw = c.measureText(label).width;
        const pad = 5, bh = fs + pad * 2;
        let lx = px + 10;
        if (lx + tw + pad * 2 > ca.right) lx = px - tw - pad * 2 - 10;
        const ly = pyPred - bh / 2;
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fillRect(lx, ly, tw + pad * 2, bh);
        c.strokeStyle = '#ef4444';
        c.lineWidth = 1;
        c.strokeRect(lx, ly, tw + pad * 2, bh);
        c.fillStyle = '#ef4444';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(label, lx + pad, ly + bh / 2);
      }
      c.restore();
    },
  };

  // Plugin: triángulo de pendiente sobre la línea de tendencia
  const svpSlopePlugin = {
    id: 'svpSlope',
    afterDraw(chart) {
      const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
      if (!showTrend || !reg || !allCompPts.length) return;

      const { ctx: c, scales, chartArea: ca } = chart;
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const range = xMax - xMin;

      // Posición del triángulo: controlada por svpSlopeXPct (draggable)
      const x0 = xMin + range * svpSlopeXPct;
      const dxData = range * 0.14;
      const x1 = x0 + dxData;
      const y0 = reg.m * x0 + reg.b;
      const y1 = reg.m * x1 + reg.b;

      const px0 = scales.x.getPixelForValue(x0);
      const px1 = scales.x.getPixelForValue(x1);
      const py0 = scales.y.getPixelForValue(y0);
      const py1 = scales.y.getPixelForValue(y1);

      if (px0 < ca.left || px1 > ca.right ||
          Math.min(py0, py1) < ca.top || Math.max(py0, py1) > ca.bottom) return;

      const negSlope = py1 > py0; // pendiente negativa → py1 más abajo en canvas
      const lfs = fs;
      c.save();
      c.setLineDash([]);

      // ── Triángulo relleno ──
      c.beginPath();
      c.moveTo(px0, py0);
      c.lineTo(px1, py0);  // vértice recto
      c.lineTo(px1, py1);
      c.closePath();
      c.fillStyle = 'rgba(30,58,95,0.10)';
      c.fill();
      c.strokeStyle = 'rgba(30,58,95,0.35)';
      c.lineWidth = 1;
      c.stroke();

      // ── Flecha desde vértice recto → cajita de interpretación ──
      const aX1 = px1, aY1 = py0;
      const aX2 = px1 + 20, aY2 = py0 + (negSlope ? -22 : 22);
      c.beginPath();
      c.moveTo(aX1, aY1);
      c.lineTo(aX2, aY2);
      c.strokeStyle = '#9ca3af';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.stroke();
      c.setLineDash([]);

      // Punta de flecha
      const ang = Math.atan2(aY2 - aY1, aX2 - aX1);
      const hl = 6;
      c.beginPath();
      c.moveTo(aX2, aY2);
      c.lineTo(aX2 - hl * Math.cos(ang - Math.PI / 6), aY2 - hl * Math.sin(ang - Math.PI / 6));
      c.moveTo(aX2, aY2);
      c.lineTo(aX2 - hl * Math.cos(ang + Math.PI / 6), aY2 - hl * Math.sin(ang + Math.PI / 6));
      c.strokeStyle = '#9ca3af';
      c.lineWidth = 1;
      c.stroke();

      // Cajita de interpretación
      const mStr = (reg.m >= 0 ? '+' : '') +
        reg.m.toLocaleString('es-CL', { maximumFractionDigits: 2 });
      const callout = `+1 m²  →  ${mStr} UF/m²`;
      c.font = `bold ${lfs}px system-ui, sans-serif`;
      const tw = c.measureText(callout).width;
      const bp = 5, bh = lfs + bp * 2, bw = tw + bp * 2;
      const bx = Math.min(aX2 + 4, ca.right - bw - 4);
      const by = aY2 - bh / 2;
      c.fillStyle = 'rgba(255,255,255,0.94)';
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = '#d1d5db';
      c.lineWidth = 0.8;
      c.strokeRect(bx, by, bw, bh);
      c.fillStyle = '#1e3a5f';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(callout, bx + bp, by + bh / 2);

      // Actualizar bounding box del objeto completo para drag
      const bboxX = Math.min(px0, bx) - 4;
      const bboxY = Math.min(py0, py1, by) - 6;
      const bboxR = Math.max(px1 + 10, bx + bw) + 4;
      const bboxB = Math.max(py0, py1, by + bh) + 6;
      svpSlopeBbox = { x: bboxX, y: bboxY, w: bboxR - bboxX, h: bboxB - bboxY };

      // Indicador visual de arrastre
      if (svpSlopeDragging) {
        c.strokeStyle = 'rgba(30,58,95,0.5)';
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.strokeRect(bboxX, bboxY, bboxR - bboxX, bboxB - bboxY);
        c.setLineDash([]);
      }

      c.restore();
    },
  };

  state.chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    plugins: [svpMpPredPlugin, svpSlopePlugin, {
      id: 'svpSettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.svp-ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const ratioLabel = ratioMap[ratioVal] ?? ratioVal;
        const fsSetting = $('#svpFontSize')?.value ?? '12';
        const text = `${ratioLabel} · ${fsSetting}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
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
          title: { display: true, text: 'Útil (m²)', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'UF/m²', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });

  // Handlers de drag del triángulo de pendiente
  const svpCanvas = $('#svpChart');
  svpCanvas.removeEventListener('mousedown', _svpSlpDown);
  svpCanvas.removeEventListener('mousemove', _svpSlpMove);
  svpCanvas.removeEventListener('mouseup',   _svpSlpUp);
  svpCanvas.addEventListener('mousedown', _svpSlpDown);
  svpCanvas.addEventListener('mousemove', _svpSlpMove);
  svpCanvas.addEventListener('mouseup',   _svpSlpUp);

  if (!svpWidgetInited) initSvpFilterWidget();
  else updateSvpFilterWidget();
}

// ============== Widget de filtros activos (SVP) ==============
let svpWidgetInited = false;

function initSvpFilterWidget() {
  const toggleBtn = document.getElementById('svpFilterWidgetBtn');
  const container = document.getElementById('svpWrap');
  if (!toggleBtn || !container) return;

  const widget = document.createElement('div');
  widget.id = 'svpFilterWidget';
  widget.className = 'map-filter-widget hidden';
  widget.innerHTML = `
    <div class="mfw-header" id="svpFwHeader">
      <span>Filtros activos</span>
      <button class="mfw-close" id="svpFwClose">&#xD7;</button>
    </div>
    <div class="mfw-body" id="svpFwBody"></div>
  `;
  container.appendChild(widget);

  const header = document.getElementById('svpFwHeader');
  header.addEventListener('mousedown', e => {
    if (e.target.id === 'svpFwClose') return;
    const startX = e.clientX, startY = e.clientY;
    const startL = parseInt(widget.style.left) || (container.offsetWidth - 240);
    const startT = parseInt(widget.style.top)  || 10;
    widget.style.left = startL + 'px';
    widget.style.top  = startT + 'px';
    document.body.style.userSelect = 'none';
    const onMove = e => {
      widget.style.left = (startL + e.clientX - startX) + 'px';
      widget.style.top  = (startT + e.clientY - startY) + 'px';
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
  });

  document.getElementById('svpFwClose').addEventListener('click', () => {
    widget.classList.add('hidden');
    toggleBtn.classList.remove('active');
  });

  toggleBtn.addEventListener('click', () => {
    const nowHidden = widget.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !nowHidden);
    if (!nowHidden) {
      if (!widget.style.left) {
        widget.style.left = (container.offsetWidth - 240) + 'px';
        widget.style.top  = '10px';
      }
      updateSvpFilterWidget();
    }
  });

  svpWidgetInited = true;
}

export function updateSvpFilterWidget() {
  const body = document.getElementById('svpFwBody');
  if (!body) return;
  const widget = document.getElementById('svpFilterWidget');
  if (!widget || widget.classList.contains('hidden')) return;
  import('./filters.js').then(({ getActiveFiltersSummary }) => {
    const items = getActiveFiltersSummary();
    body.innerHTML = items.length
      ? items.map(it => `<div class="mfw-row"><span class="mfw-label">${it.label}</span><span class="mfw-value">${it.value}</span></div>`).join('')
      : '<div class="mfw-empty">Sin filtros aplicados</div>';
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
  const utilCol   = state.columns.find(c => ['util (m', 'util(m', 'sup. util', 'superficie util', 'sup util'].some(k => normStr(c.name).includes(k)));

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
  if (utilCol) {
    const o = document.createElement('option');
    o.value = utilCol.name; o.textContent = 'Útil (m²)';
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
    $('#distribNormalToggle')?.addEventListener('change', renderDistrib);

    document.querySelectorAll('.distrib-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.distrib-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDistrib();
      });
    });

    document.querySelectorAll('.distrib-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.distrib-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDistrib();
      });
    });

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

    document.querySelector('.distrib-mp-btn')?.addEventListener('click', () => {
      document.querySelector('.distrib-mp-btn').classList.toggle('active');
      renderDistrib();
    });

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

      const blob = await _withMargin(url, 64);
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

// Ajuste log-normal: X = valor (>0), Y = densidad
function computeLogNormal(sortedVals, nPoints = 300) {
  const posVals = sortedVals.filter(v => v > 0);
  const n = posVals.length;
  if (n < 2) return [];
  const logVals = posVals.map(v => Math.log(v));
  const mu  = logVals.reduce((a, b) => a + b, 0) / n;
  const sig = Math.sqrt(logVals.reduce((a, v) => a + (v - mu) ** 2, 0) / (n - 1));
  if (sig === 0) return [];
  const xMin = posVals[0] * 0.5;
  const xMax = posVals[n - 1] * 1.15;
  const step = (xMax - xMin) / nPoints;
  const K = 1 / (sig * Math.sqrt(2 * Math.PI));
  return Array.from({ length: nPoints + 1 }, (_, i) => {
    const x = xMin + i * step;
    if (x <= 0) return { x, y: 0 };
    const y = K / x * Math.exp(-0.5 * ((Math.log(x) - mu) / sig) ** 2);
    return { x, y };
  });
}

function lerpDensity(data, x) {
  if (!data.length) return undefined;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].x <= x && x <= data[i + 1].x) {
      const t = (x - data[i].x) / (data[i + 1].x - data[i].x);
      return data[i].y + t * (data[i + 1].y - data[i].y);
    }
  }
  return 0;
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
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²'
              : (_nc.includes('util') || _nc.includes('sup')) ? 'm²'
              : 'UF';
  const fs = parseInt($('#distribFontSize')?.value ?? '11');
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²' : 'UF';
  const fs   = parseInt($('#distribFontSize')?.value ?? '11');
  const mode = document.querySelector('.distrib-mode-btn.active')?.dataset.mode ?? 'acumulada';
  const fmtV = v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 });

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart').getContext('2d');

  const sortedVals = state.filtered
    .map(r => Number(r[col]))
    .filter(v => !isNaN(v))
    .sort((a, b) => a - b);

  if (sortedVals.length < 2) return;

  const showNormal = $('#distribNormalToggle')?.checked ?? false;

  if (mode === 'densidad') {
    _renderDensidadVenta(ctx, sortedVals, col, fs, showNormal, fmtV);
    return;
  }

  // ── Modo Acumulada (CDF) ──────────────────────────────────────────────

  const valAtPct = pct => {
    if (!sortedVals.length) return null;
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const isDens  = document.querySelector('.distrib-mode-btn.active')?.dataset.mode === 'dens';
  const refData = computeQuantileCurve(state.filtered, col);
  const kdeData = isDens ? computeLogNormal(sortedVals) : [];

  const chartData = isDens ? kdeData : refData;
  const datasets = [{
    label: col,
    data: chartData,
    borderColor: palette[0],
    backgroundColor: 'rgba(59,130,246,0.08)',
    pointRadius: 0,
    borderWidth: 2,
    tension: isDens ? 0.3 : 0.4,
    fill: true,
  }];

  if (normalFit) {
    datasets.push({
      label: `Normal (μ=${fmtV(normalFit.mu)}, σ=${fmtV(normalFit.sigma)})`,
      data: normalFit.curve,
      borderColor: '#f97316',
      backgroundColor: 'transparent',
      pointRadius: 0, borderWidth: 2, borderDash: [6, 3],
      tension: 0.3, fill: false,
    });
  }

  // Construir anotaciones
  const annotations = {};
  const pctColor   = '#6b7280';
  const priceColor = '#6b7280';
  const annLabel   = (content, color) => ({
    content, display: true, position: 'start',
    color, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  if (!isDens) {
    // ── Modo acumulada: mismo comportamiento original ──
    [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
      const color = pctColor;
      const price = lerpAtX(refData, pct);
      if (price == null) return;
      const priceLabel = price.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      annotations[`pv_${pct}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct}`, color),
      };
      annotations[`ph_${pct}`] = {
        type: 'line', yMin: price, yMax: price, xMax: pct,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${priceLabel} ${distribUnit}`, color),
      };
    });

    [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
      const color = priceColor;
      const pct   = lerpAtY(refData, price);
      const pctForLabel = pct !== null ? pct : 100;
      annotations[`prh_${price}`] = {
        type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${price.toLocaleString('es-CL')} ${distribUnit}`, color),
      };
      if (pct !== null) {
        annotations[`prv_${price}`] = {
          type: 'line', xMin: pct, xMax: pct, yMax: price,
          borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
          label: annLabel(`P${pct.toFixed(1)}`, color),
        };
      }
    });
  } else {
    // ── Modo densidad: líneas verticales en el eje X ──
    [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
      const val = valAtPct(pct);
      if (val == null) return;
      const valLabel = val.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      annotations[`dpv_${pct}`] = {
        type: 'line', xMin: val, xMax: val, yMax: lerpDensity(kdeData, val),
        borderColor: pctColor, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct}: ${valLabel} ${distribUnit}`, pctColor),
      };
    });

    [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
      const pct = lerpAtY(refData, price);
      const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
      annotations[`dprv_${price}`] = {
        type: 'line', xMin: price, xMax: price, yMax: lerpDensity(kdeData, price),
        borderColor: priceColor, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${price.toLocaleString('es-CL')} ${distribUnit}${pctStr}`, priceColor),
      };
    });
  }

  // Mi Proyecto annotations
  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp.inDistrib && mp.tipologias.length > 0) {
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

    const mpColor = '#ef4444';
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

  const normalStatsPlugin = {
    id: 'normalStats',
    afterDraw(chart) {
      if (!normalFit) return;
      const { ctx: c, chartArea: { left, top } } = chart;
      const lines = [
        `μ = ${fmtV(normalFit.mu)}   σ = ${fmtV(normalFit.sigma)}`,
        `Ajuste R² = ${normalFit.r2.toFixed(3)}`,
      ];
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      const maxW = Math.max(...lines.map(l => c.measureText(l).width));
      const pad = 6, lh = fs + 6, boxH = lines.length * lh + pad * 2;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(left + 8, top + 8, maxW + pad * 2, boxH);
      c.strokeStyle = '#f97316'; c.lineWidth = 1.5;
      c.strokeRect(left + 8, top + 8, maxW + pad * 2, boxH);
      c.fillStyle = '#f97316'; c.textBaseline = 'top';
      lines.forEach((line, i) => c.fillText(line, left + 8 + pad, top + 8 + pad + i * lh));
      c.restore();
    },
  };

  distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [normalStatsPlugin],
    plugins: [{
      id: 'distribSettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const text = `${ratioMap[ratioVal] ?? ratioVal} · ${fs}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest',
          intersect: false,
          axis: 'x',
          callbacks: {
            title: items => {
              const pt = refData[items[0]?.dataIndex];
              return pt ? `P${pt.x.toFixed(1)}` : '';
            },
            label: item => {
              const pt = refData[item.dataIndex];
              if (!pt) return '';
              return ` ${item.dataset.label}: ${pt.y.toLocaleString('es-CL', { maximumFractionDigits: 0 })} ${distribUnit}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: isDens ? {
        x: {
          type: 'linear',
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'Densidad', font: { size: fs } },
          ticks: { display: false },
          grid: { display: false },
        },
      } : {
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

// ── Modo Densidad (venta) ─────────────────────────────────────────────────

function _renderDensidadVenta(ctx, sortedVals, col, fs, showNormal, fmtV) {
  const refData = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return { x: pct, y: sortedVals[idx] };
  });
  const normalFit = _computeNormalFit(sortedVals, refData);
  const mu    = normalFit?.mu    ?? sortedVals.reduce((a, b) => a + b, 0) / sortedVals.length;
  const sigma = normalFit?.sigma ?? Math.sqrt(sortedVals.reduce((s, v) => s + (v - mu) ** 2, 0) / sortedVals.length);

  const { bins, bw } = _computeHistogram(sortedVals);
  if (!bins.length) return;

  const pad = 1.5 * Math.max(sigma, bw);
  const x0 = sortedVals[0] - pad;
  const x1 = sortedVals[sortedVals.length - 1] + pad;

  const kdeData    = _computeKDE(sortedVals, sigma, bw);
  const normalData = showNormal && normalFit ? _normalPDFcurve(mu, sigma, bw, x0, x1) : null;

  const datasets = [
    {
      type: 'bar', label: 'Frecuencia',
      data: bins,
      backgroundColor: 'rgba(59,130,246,0.30)', borderColor: palette[0], borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0, order: 3,
    },
    {
      type: 'line', label: 'Densidad',
      data: kdeData,
      borderColor: '#2563eb', backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, order: 2,
    },
  ];

  if (normalData) {
    datasets.push({
      type: 'line',
      label: `Normal (μ=${fmtV(mu)}, σ=${fmtV(sigma)})`,
      data: normalData,
      borderColor: '#f97316', backgroundColor: 'transparent',
      borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0.3, fill: false, order: 1,
    });
  }

  const statsPlugin = {
    id: 'normalStats',
    afterDraw(chart) {
      if (!normalFit || !showNormal) return;
      const { ctx: c, chartArea: { left, top } } = chart;
      const lines = [`μ = ${fmtV(mu)}   σ = ${fmtV(sigma)}`, `Ajuste R² = ${normalFit.r2.toFixed(3)}`];
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      const maxW = Math.max(...lines.map(l => c.measureText(l).width));
      const p = 6, lh = fs + 6, boxH = lines.length * lh + p * 2;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(left + 8, top + 8, maxW + p * 2, boxH);
      c.strokeStyle = '#f97316'; c.lineWidth = 1.5;
      c.strokeRect(left + 8, top + 8, maxW + p * 2, boxH);
      c.fillStyle = '#f97316'; c.textBaseline = 'top';
      lines.forEach((line, i) => c.fillText(line, left + 8 + p, top + 8 + p + i * lh));
      c.restore();
    },
  };

  distribChart = new Chart(ctx, {
    type: 'bar', data: { datasets }, plugins: [statsPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => { const x = items[0]?.raw?.x; return x != null ? `${fmtV(x)} ${distribUnit}` : ''; },
            label: item => { const y = item.raw?.y; return y != null ? ` ${item.dataset.label}: ${y.toFixed(2)}%` : ''; },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: x0, max: x1,
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => fmtV(v), font: { size: fs } } },
        y: { beginAtZero: true,
          title: { display: true, text: '% de datos', font: { size: fs } },
          ticks: { callback: v => v.toFixed(1) + '%', font: { size: fs } } },
      },
    },
  });
}