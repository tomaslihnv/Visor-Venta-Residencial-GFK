import { $, fmt, extractDormitorios, norm } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

function _fmtTipo(v) {
  const s = String(v ?? '').trim();
  return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
}

function _parseAxisVal(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

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

function _computeHistogram(sortedVals, binCount) {
  const n = sortedVals.length;
  if (!binCount) binCount = Math.min(50, Math.max(10, Math.ceil(Math.log2(n) + 1)));
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

const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7'];

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
  if (state.columns.find(c => c.name === 'Gastos Comunes (CLP)')) {
    const v = avg('Gastos Comunes (CLP)');
    if (v > 0) {
      kpis.push({
        label: 'Gastos Comunes prom.',
        value: v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        sub: 'CLP/mes',
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
  { id: 'gastos', label: 'Gastos Comunes (CLP)',  keys: ['gastos comunes'],      agg: 'avg',   fmt: v => fmtNum(v, 1) },
  { id: 'count',  label: 'N° Unidades',          keys: [],                      agg: 'count', fmt: v => String(Math.round(v)) },
];

let proyChart = null;
let proyListenersReady = false;

export function populateProyectosSelectors() {
  if (proyListenersReady) return;
  proyListenersReady = true;
  $('#proyMetrica')?.addEventListener('change', renderProyectos);
  $('#proyYMin')?.addEventListener('input', renderProyectos);
  $('#proyYMax')?.addEventListener('input', renderProyectos);

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
    const exportW = wrap ? wrap.clientWidth - pad : proyChart.width;
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

  const metricId = $('#proyMetrica')?.value ?? 'renta';
  const metric   = PROY_METRICS.find(m => m.id === metricId) ?? PROY_METRICS[0];

  const edifCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre', 'building'].some(k => norm(c.name).includes(k))
  )?.name;
  const metricCol = metricId === 'count' ? null : state.columns.find(c =>
    c.type === 'number' && metric.keys.some(k => norm(c.name).includes(norm(k)))
  )?.name;

  if (!edifCol) return;
  if (metricId !== 'count' && !metricCol) return;

  const fs = parseInt($('#proyFontSize')?.value ?? '11');
  const xRot = document.querySelector('.proy-xrot-btn.active')?.dataset.rot ?? 'diagonal';
  const xMaxRot = xRot === 'vertical' ? 90 : 45;
  const xMinRot = xRot === 'vertical' ? 90 : 30;
  const showMedian = (document.querySelector('.proy-median-btn.active')?.dataset.median ?? 'show') === 'show';

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

  const MP_COLOR  = '#96323C';
  const BAR_COLOR = '#DDE0E3';

  const sortedVals = entries.map(([, v]) => v).sort((a, b) => a - b);
  const medianVal  = showMedian && sortedVals.length
    ? sortedVals[Math.floor(sortedVals.length / 2)]
    : null;

  const barLabelsPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c } = chart;
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

  const medianAnnotations = medianVal != null ? {
    mediana: {
      type: 'line', yMin: medianVal, yMax: medianVal,
      borderColor: '#ef4444', borderWidth: 1.5, borderDash: [5, 4],
      label: { content: `Mediana: ${metric.fmt(medianVal)}`, display: true, position: 'end', font: { size: fs - 1 }, color: '#ef4444', backgroundColor: 'rgba(255,255,255,0.92)' },
    },
  } : {};

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
        tooltip: { callbacks: { label: item => ` ${metric.fmt(item.raw)}` } },
        annotation: { annotations: medianAnnotations },
      },
      scales: {
        x: { ticks: { maxRotation: xMaxRot, minRotation: xMinRot, font: { size: fs } } },
        y: {
          title: { display: false },
          ticks: { callback: v => metric.fmt(v), font: { size: fs } },
          beginAtZero: false,
          ...(_parseAxisVal($('#proyYMin')?.value) !== null ? { min: _parseAxisVal($('#proyYMin').value) } : {}),
          ...(_parseAxisVal($('#proyYMax')?.value) !== null ? { max: _parseAxisVal($('#proyYMax').value) } : {}),
        },
      },
    },
    plugins: [barLabelsPlugin, {
      id: 'yAxisHLabel',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(metric.label, chartArea.left, chartArea.top - 22);
        ctx.restore();
      },
    }],
  });
}

// ============== Sup. vs Renta ==============
let svpListenersReady = false;
const svpMarkers = new Set(); // m² útiles a marcar

function refreshSvpMarkerTags() {
  const cont = $('#svpM2Tags');
  if (!cont) return;
  cont.innerHTML = '';
  [...svpMarkers].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag pct-tag';
    tag.innerHTML = `${v.toLocaleString('es-CL')} m² <button class="rm-svp-m2">×</button>`;
    tag.querySelector('.rm-svp-m2').addEventListener('click', () => {
      svpMarkers.delete(v);
      refreshSvpMarkerTags();
      renderSupVsRenta();
    });
    cont.appendChild(tag);
  });
}

export function populateSvpSelectors() {
  const tipoSel = $('#svpTipoFilter');
  if (!tipoSel) return;

  const tipoCol = state.columns.find(c => ['tipolog', 'dormitor'].some(k => norm(c.name).includes(k)));

  tipoSel.innerHTML = '<option value="">Todas</option>';
  if (tipoCol) {
    const tipos = [...new Set(
      state.raw.map(r => extractDormitorios(r[tipoCol.name])).filter(Boolean)
    )].sort((a, b) => parseInt(a) - parseInt(b));
    for (const t of tipos) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      tipoSel.appendChild(o);
    }
  }

  if (!svpListenersReady) {
    svpListenersReady = true;
    tipoSel.addEventListener('change', renderSupVsRenta);
    $('#svpYAxis')?.addEventListener('change', renderSupVsRenta);
    $('#svpTrendToggle')?.addEventListener('change', renderSupVsRenta);
    $('#svpAvgToggle')?.addEventListener('change', renderSupVsRenta);

    const addM2 = () => {
      const v = parseFloat($('#svpM2Input').value);
      if (isNaN(v) || v <= 0) return;
      svpMarkers.add(v);
      $('#svpM2Input').value = '';
      refreshSvpMarkerTags();
      renderSupVsRenta();
    };
    $('#svpAddM2')?.addEventListener('click', addM2);
    $('#svpM2Input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addM2(); });
    const svpFont = $('#svpFontSize');
    if (svpFont) {
      svpFont.addEventListener('input', () => {
        $('#svpFontSizeVal').textContent = svpFont.value + 'px';
        renderSupVsRenta();
      });
    }

    document.querySelectorAll('.svp-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.svp-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    $('#svpExportPngBtn')?.addEventListener('click', async () => {
      if (!state.chart) return;
      const btn   = $('#svpExportPngBtn');
      const scale = 4;
      const pad   = 32;
      const wrap  = $('#svpWrap');
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

      const res  = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);

      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    });

    _initSvpFilterWidget();
  }
}

function _initSvpFilterWidget() {
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

  document.getElementById('svpFwHeader').addEventListener('mousedown', e => {
    if (e.target.id === 'svpFwClose') return;
    const startX = e.clientX, startY = e.clientY;
    const startL = parseInt(widget.style.left) || (container.offsetWidth - 240);
    const startT = parseInt(widget.style.top)  || 10;
    widget.style.left = startL + 'px'; widget.style.top = startT + 'px';
    document.body.style.userSelect = 'none';
    const onMove = e => {
      widget.style.left = (startL + e.clientX - startX) + 'px';
      widget.style.top  = (startT + e.clientY - startY) + 'px';
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
      _updateSvpFilterWidget();
    }
  });
}

export function updateSvpFilterWidget() { _updateSvpFilterWidget(); }

function _updateSvpFilterWidget() {
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

  const yAxisMode = $('#svpYAxis')?.value ?? 'renta';
  const fs        = parseInt($('#svpFontSize')?.value ?? '11');

  const supCol = state.columns.find(c =>
    c.type === 'number' && ['util (m', 'útil (m', 'metros util'].some(k => norm(c.name).includes(norm(k)))
  );
  const rentaCol = state.columns.find(c =>
    norm(c.name).includes('renta uf') || norm(c.name).includes('precio')
  );
  const ufm2Col = state.columns.find(c =>
    norm(c.name).includes('uf/m') || norm(c.name).includes('uf / m')
  );
  const tipoCol = state.columns.find(c =>
    ['tipolog', 'dormitor'].some(k => norm(c.name).includes(k))
  );
  const proyCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre'].some(k => norm(c.name).includes(k))
  );

  const yCol      = yAxisMode === 'ufm2' ? ufm2Col : rentaCol;
  const yLabel    = yAxisMode === 'ufm2' ? 'UF/m²' : 'Renta UF/mes';
  const yTooltip  = yAxisMode === 'ufm2'
    ? (v => `${Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`)
    : (v => `${Number(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/mes`);

  if (!supCol || !yCol) return;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = $('#svpChart')?.getContext('2d');
  if (!ctx) return;

  const tipoFilter = $('#svpTipoFilter')?.value ?? '';
  let rows = state.filtered;
  if (tipoFilter) {
    rows = rows.filter(r => tipoCol && extractDormitorios(r[tipoCol.name]) === tipoFilter);
  }

  const mpDatasets = [];
  if (mp.inSvp && mp.tipologias.length > 0) {
    const mpColor = '#1e293b';
    const mpPName = mp.proyecto || mp.edificio || 'Mi Proyecto';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.ufm2 != null);
    const mpFiltered = tipoFilter
      ? mpTipos.filter(t => String(t.nombre).toUpperCase() === tipoFilter.toUpperCase())
      : mpTipos;
    if (mpFiltered.length > 0) {
      mpDatasets.push({
        label: mpPName,
        data: mpFiltered.map(t => ({
          x: t.sup,
          y: yAxisMode === 'ufm2' ? t.ufm2 : (t.renta ?? t.sup * t.ufm2),
          label: `${mpPName} ${t.nombre}`,
        })),
        backgroundColor: mpColor,
        borderColor: mpColor,
        borderWidth: 2,
        pointRadius: 7,
        pointHoverRadius: 9,
      });
    }
  }

  const compDatasets = [];

  if (tipoCol && !tipoFilter) {
    const tipoGroups = {};
    for (const r of rows) {
      const sup = Number(r[supCol.name]);
      const yv  = Number(r[yCol.name]);
      if (isNaN(sup) || isNaN(yv) || sup <= 0 || yv <= 0) continue;
      const tipo = _fmtTipo(r[tipoCol.name]) || '—';
      const proy = proyCol ? String(r[proyCol.name] ?? '—') : '—';
      if (!tipoGroups[tipo]) tipoGroups[tipo] = [];
      tipoGroups[tipo].push({ x: sup, y: yv, label: proy });
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
      const sup = Number(r[supCol.name]);
      const yv  = Number(r[yCol.name]);
      if (isNaN(sup) || isNaN(yv) || sup <= 0 || yv <= 0) continue;
      const proy = proyCol ? String(r[proyCol.name] ?? '—') : '—';
      pts.push({ x: sup, y: yv, label: proy });
    }
    const tipo = tipoFilter ? _fmtTipo(tipoFilter) : '';
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

  // ── Promedio Y ─────────────────────────────────────────────
  const showAvg = $('#svpAvgToggle')?.checked ?? false;
  let avgY = null;
  const annotations = {};
  if (showAvg && allCompPts.length > 0) {
    avgY = allCompPts.reduce((s, p) => s + p.y, 0) / allCompPts.length;
    const avgLabel = yAxisMode === 'ufm2'
      ? `Prom.: ${avgY.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`
      : `Prom.: ${avgY.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/mes`;
    annotations.avgLine = {
      type: 'line',
      scaleID: 'y',
      value: avgY,
      borderColor: '#ef4444',
      borderWidth: 1.5,
      borderDash: [8, 4],
      label: {
        content: avgLabel,
        display: true,
        position: 'start',
        color: '#ef4444',
        backgroundColor: 'rgba(255,255,255,0.92)',
        font: { size: fs, weight: 'bold' },
        padding: { x: 6, y: 3 },
      },
    };
  }

  // ── Tendencia ───────────────────────────────────────────────
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

  // ── Marcadores de m² sobre la tendencia ────────────────────
  const MARKER_COLOR = '#ef4444';
  [...svpMarkers].sort((a, b) => a - b).forEach(m2 => {
    if (reg) {
      // Cruce con la línea de tendencia
      const trendY = reg.m * m2 + reg.b;
      const yFmt = yAxisMode === 'ufm2'
        ? `${trendY.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF/m²`
        : `${trendY.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/mes`;
      // Línea vertical: desde el eje X hasta el cruce con la tendencia
      annotations[`sv_${m2}`] = {
        type: 'line', xMin: m2, xMax: m2, yMax: trendY,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: {
          content: `${m2.toLocaleString('es-CL')} m²`,
          display: true,
          position: 'start', // top = punto de cruce con la tendencia
          color: MARKER_COLOR,
          backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' },
          padding: { x: 4, y: 2 },
          xAdjust: 4, // desplazar hacia la derecha para no tapar la línea
        },
      };
      // Línea horizontal: desde el cruce hasta el eje Y
      annotations[`sh_${m2}`] = {
        type: 'line', yMin: trendY, yMax: trendY, xMax: m2,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: {
          content: yFmt,
          display: true,
          position: 'start',
          color: MARKER_COLOR,
          backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' },
          padding: { x: 4, y: 2 },
          yAdjust: -10, // ligeramente arriba para no tapar la línea horizontal
        },
      };
    } else {
      // Sin tendencia: línea vertical completa con etiqueta arriba
      annotations[`sv_${m2}`] = {
        type: 'line', scaleID: 'x', value: m2,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `${m2.toLocaleString('es-CL')} m²`, display: true, position: 'start',
          color: MARKER_COLOR, backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 }, xAdjust: 4 },
      };
    }
  });

  const svpR2Plugin = {
    id: 'svpR2',
    afterDraw(chart) {
      if (!reg) return;
      const { ctx: c, chartArea: { right, top } } = chart;
      const text = `R² = ${reg.r2.toFixed(3)}`;
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
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
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          callbacks: {
            label: item => {
              if (item.dataset.showLine) return null;
              const d = item.raw;
              const name = d.label ? `${d.label}: ` : '';
              return `${name}${Number(d.x).toLocaleString('es-CL')} m² · ${yTooltip(d.y)}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          title: { display: true, text: 'Útil (m²)', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: yLabel, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });
}

// ============== Distribución (curva de cuantiles) ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
let distribUnit = 'UF';

export function populateDistribSelectors() {
  const colSel = $('#distribCol');
  if (!colSel) return;

  const rentaCol = state.columns.find(c => norm(c.name).includes('renta uf') || norm(c.name).includes('precio (uf'));
  const ufm2Col  = state.columns.find(c => norm(c.name).includes('uf/m') || norm(c.name).includes('uf / m'));
  const utilCol  = state.columns.find(c => ['util (m', 'util(m', 'sup. util', 'superficie util', 'sup util'].some(k => norm(c.name).includes(k)));

  colSel.innerHTML = '';
  if (rentaCol) {
    const o = document.createElement('option');
    o.value = rentaCol.name; o.textContent = 'Renta UF';
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
  // Otras columnas numéricas como fallback
  if (!colSel.options.length) {
    for (const col of state.columns) {
      if (col.type === 'number' && !col.name.startsWith('__')) {
        const o = document.createElement('option');
        o.value = col.name; o.textContent = col.name;
        colSel.appendChild(o);
        break;
      }
    }
  }

  if (!distribListenersReady) {
    distribListenersReady = true;
    colSel.addEventListener('change', renderDistrib);
    $('#distribNormalToggle')?.addEventListener('change', renderDistrib);
    $('#distribXMin')?.addEventListener('input', renderDistrib);
    $('#distribXMax')?.addEventListener('input', renderDistrib);
    $('#distribYMin')?.addEventListener('input', renderDistrib);
    $('#distribYMax')?.addEventListener('input', renderDistrib);
    document.querySelector('.distrib-mp-btn')?.addEventListener('click', () => {
      document.querySelector('.distrib-mp-btn').classList.toggle('active');
      renderDistrib();
    });

    document.querySelectorAll('.distrib-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.distrib-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        const binsCtrl = document.getElementById('distribBinsCtrl');
        if (binsCtrl) binsCtrl.style.display = mode === 'densidad' ? '' : 'none';
        renderDistrib();
      });
    });

    const binsSlider = document.getElementById('distribBins');
    const binsVal    = document.getElementById('distribBinsVal');
    if (binsSlider) {
      binsSlider.addEventListener('input', () => {
        binsVal.textContent = +binsSlider.value === 0 ? 'Auto' : binsSlider.value;
        renderDistrib();
      });
    }

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
      const btn   = $('#distribExportPngBtn');
      const scale = 4;
      const pad   = 32;
      const wrap  = $('#distribWrap');
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
  const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
  if (vals.length < 2) return [];
  vals.sort((a, b) => a - b);
  const n = vals.length;
  return vals.map((v, i) => ({ x: (i / (n - 1)) * 100, y: v }));
}

// Interpola Y dado X en la curva
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

// Interpola X dado Y en la curva
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

  const col  = colSel.value;
  const _nc  = col.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²'
              : (['util (m', 'util(m', 'sup. util', 'superficie util', 'sup util'].some(k => _nc.includes(k))) ? 'm²'
              : 'UF';
  const fs   = parseInt($('#distribFontSize')?.value ?? '11');
  const mode = document.querySelector('.distrib-mode-btn.active')?.dataset.mode ?? 'acumulada';

  const fmtVal = v => {
    if (v >= 100) return v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    if (v >= 10)  return v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
    return v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart')?.getContext('2d');
  if (!ctx) return;

  const sortedVals = state.filtered
    .map(r => Number(r[col]))
    .filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);

  if (sortedVals.length < 2) return;

  const showNormal = $('#distribNormalToggle')?.checked ?? false;

  if (mode === 'densidad') {
    _renderDensidadRenta(ctx, sortedVals, col, fs, showNormal, fmtVal);
    return;
  }

  if (mode === 'lognormal') {
    _renderLognormalRenta(ctx, sortedVals, col, fs, fmtVal);
    return;
  }

  // ── Modo Acumulada (CDF) ──────────────────────────────────────────────

  const valAtPct = pct => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const n = sortedVals.length;
  const refData = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (n - 1)), n - 1);
    return { x: pct, y: sortedVals[idx] };
  });
  const normalFit = showNormal ? _computeNormalFit(sortedVals, refData) : null;

  const datasets = [{
    label: col,
    data: refData,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.08)',
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.4,
    fill: true,
  }];

  if (normalFit) {
    datasets.push({
      label: `Normal (μ=${fmtVal(normalFit.mu)}, σ=${fmtVal(normalFit.sigma)})`,
      data: normalFit.curve,
      borderColor: '#f97316',
      backgroundColor: 'transparent',
      pointRadius: 0, borderWidth: 2, borderDash: [6, 3],
      tension: 0.3, fill: false,
    });
  }

  const annotations = {};
  const ANN_COLOR = '#6b7280';
  const annLabel = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const price = lerpAtX(refData, pct);
    if (price == null || price === 0) return;
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}`),
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${fmtVal(price)} ${distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = lerpAtY(refData, price);
    const pctForLabel = pct !== null ? pct : 100;
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${fmtVal(price)} ${distribUnit}`),
    };
    if (pct !== null) {
      annotations[`prv_${price}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct.toFixed(1)}`),
      };
    }
  });

  // ── Mi Proyecto ─────────────────────────────────────────────
  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp.inDistrib && mp.tipologias.length > 0) {
    const nc      = norm(col);
    const isUfm2   = nc.includes('uf/m') || nc.includes('uf / m');
    const isRenta  = !isUfm2 && (nc.includes('renta') || nc.includes('precio'));

    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => norm(c.name).includes(k)));
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => _fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) mpTipos = mpTipos.filter(t => activeTipos.has(_fmtTipo(t.nombre)) || (t.nombre === 'S' && activeTipos.has('1D')));
    }

    const mpColor = '#ef4444';
    const mpAnnLabel = (content) => ({
      content, display: true, position: 'start',
      color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
      padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
    });
    mpTipos.forEach(t => {
      let val = null;
      if (isUfm2)       val = t.ufm2;
      else if (isRenta) val = (t.sup != null && t.ufm2 != null) ? t.sup * t.ufm2 : null;
      else              val = t.sup;
      if (val == null) return;
      const pct = lerpAtY(refData, val);
      if (pct === null) return;
      const valLabel = fmtVal(val);
      annotations[`mp_h_${t.id}`] = {
        type: 'line', yMin: val, yMax: val, xMax: pct,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnnLabel(`${t.nombre}: ${valLabel}`),
      };
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: val,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnnLabel(`P${pct.toFixed(1)}`),
      };
    });
  }

  const normalStatsPlugin = {
    id: 'normalStats',
    afterDraw(chart) {
      if (!normalFit) return;
      const { ctx: c, chartArea: { left, top } } = chart;
      const lines = [
        `μ = ${fmtVal(normalFit.mu)}   σ = ${fmtVal(normalFit.sigma)}`,
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
              const y = item.datasetIndex === 0
                ? refData[item.dataIndex]?.y
                : item.raw?.y;
              if (y == null) return '';
              return ` ${item.dataset.label}: ${fmtVal(y)} ${distribUnit}`;
            },
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
          ...(_parseAxisVal($('#distribYMin')?.value) !== null ? { min: _parseAxisVal($('#distribYMin').value) } : {}),
          ...(_parseAxisVal($('#distribYMax')?.value) !== null ? { max: _parseAxisVal($('#distribYMax').value) } : {}),
        },
      },
    },
  });
  _enableAnnotationLabelDrag(distribChart);
}

// ── Drag de etiquetas de anotaciones ──────────────────────────────────────
// Calcula posición de etiqueta desde escalas del chart, sin depender
// de internals de chartjs-plugin-annotation (su estado es privado).

function _enableAnnotationLabelDrag(chart) {
  const canvas = chart.canvas;
  let dragging = null;

  function _anns() {
    return chart.options?.plugins?.annotation?.annotations ?? {};
  }

  // Anchor pixel de la etiqueta según tipo de línea con position:'start'
  function _anchor(ann) {
    const ca = chart.chartArea;
    const sx = chart.scales?.x, sy = chart.scales?.y;
    if (!ca || !sx || !sy) return null;
    // Línea vertical (xMin == xMax)
    if (ann.xMin != null && (ann.xMax == null || ann.xMin === ann.xMax)) {
      return { ax: sx.getPixelForValue(ann.xMin), ay: sy.getPixelForValue(ann.yMin ?? sy.min ?? 0) };
    }
    // Línea horizontal (yMin == yMax)
    if (ann.yMin != null && (ann.yMax == null || ann.yMin === ann.yMax)) {
      return { ax: sx.getPixelForValue(ann.xMin ?? sx.min ?? 0), ay: sy.getPixelForValue(ann.yMin) };
    }
    return null;
  }

  function _box(key) {
    const ann = _anns()[key];
    if (!ann?.label || ann.label.display === false) return null;
    const a = _anchor(ann);
    if (!a) return null;
    const fs   = ann.label.font?.size ?? 11;
    const text = Array.isArray(ann.label.content)
      ? ann.label.content.join(' ') : String(ann.label.content ?? '');
    const ctx2 = canvas.getContext('2d');
    ctx2.save();
    ctx2.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = ctx2.measureText(text).width;
    ctx2.restore();
    return {
      cx: a.ax + (ann.label.xAdjust ?? 0),
      cy: a.ay + (ann.label.yAdjust ?? 0),
      w: tw + 16, h: fs * 1.8,
    };
  }

  function _hit(mx, my) {
    for (const key of Object.keys(_anns())) {
      const b = _box(key);
      if (!b) continue;
      if (Math.abs(mx - b.cx) <= b.w / 2 + 10 && Math.abs(my - b.cy) <= b.h / 2 + 10)
        return key;
    }
    return null;
  }

  canvas.addEventListener('mousedown', e => {
    const key = _hit(e.offsetX, e.offsetY);
    if (!key) return;
    const ann = _anns()[key];
    if (!ann?.label) return;
    e.preventDefault();
    e.stopPropagation();
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = false;
    dragging = {
      key,
      sx: e.offsetX, sy: e.offsetY,
      ox: ann.label.xAdjust ?? 0,
      oy: ann.label.yAdjust ?? 0,
    };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', e => {
    if (dragging) {
      const ann = _anns()[dragging.key];
      if (!ann?.label) return;
      ann.label.xAdjust = dragging.ox + (e.offsetX - dragging.sx);
      ann.label.yAdjust = dragging.oy + (e.offsetY - dragging.sy);
      chart.update('none');
      canvas.style.cursor = 'grabbing';
    } else {
      const mx = e.offsetX, my = e.offsetY;
      setTimeout(() => { if (!dragging) canvas.style.cursor = _hit(mx, my) ? 'grab' : ''; }, 0);
    }
  });

  function _stop() {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = '';
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = true;
    chart.update('none');
  }
  canvas.addEventListener('mouseup',    _stop);
  canvas.addEventListener('mouseleave', _stop);
}

// ── Modo Densidad ─────────────────────────────────────────────────────────

function _getBinCount(sortedVals) {
  const userBins = parseInt(document.getElementById('distribBins')?.value ?? '0');
  if (userBins > 0) return userBins;
  return Math.min(50, Math.max(10, Math.ceil(Math.log2(sortedVals.length) + 1)));
}

function _renderDensidadRenta(ctx, sortedVals, col, fs, showNormal, fmtVal) {
  const refData = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return { x: pct, y: sortedVals[idx] };
  });
  const normalFit = _computeNormalFit(sortedVals, refData);
  const mu    = normalFit?.mu    ?? sortedVals.reduce((a, b) => a + b, 0) / sortedVals.length;
  const sigma = normalFit?.sigma ?? Math.sqrt(sortedVals.reduce((s, v) => s + (v - mu) ** 2, 0) / sortedVals.length);

  const customBinCount = _getBinCount(sortedVals);
  const { bins, bw } = _computeHistogram(sortedVals, customBinCount);
  if (!bins.length) return;

  const pad = 1.5 * Math.max(sigma, bw);
  const x0 = sortedVals[0] - pad;
  const x1 = sortedVals[sortedVals.length - 1] + pad;

  const kdeData    = _computeKDE(sortedVals, sigma, bw);
  const normalData = showNormal && normalFit ? _normalPDFcurve(mu, sigma, bw, x0, x1) : null;

  const valAtPct = pct => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const ANN_COLOR = '#6b7280';
  const annLabel = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  const annotations = {};

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const val = valAtPct(pct);
    if (val == null) return;
    const valLabel = fmtVal(val);
    annotations[`dpv_${pct}`] = {
      type: 'line', xMin: val, xMax: val, yMax: lerpAtX(kdeData, val) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}: ${valLabel} ${distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = lerpAtY(refData, price);
    const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
    annotations[`dprv_${price}`] = {
      type: 'line', xMin: price, xMax: price, yMax: lerpAtX(kdeData, price) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${fmtVal(price)} ${distribUnit}${pctStr}`),
    };
  });

  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp.inDistrib && mp.tipologias.length > 0) {
    const nc = norm(col);
    const isUfm2  = nc.includes('uf/m') || nc.includes('uf / m');
    const isRenta = !isUfm2 && (nc.includes('renta') || nc.includes('precio'));
    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => norm(c.name).includes(k)));
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => _fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) mpTipos = mpTipos.filter(t => activeTipos.has(_fmtTipo(t.nombre)));
    }
    const mpColor = '#ef4444';
    const mpAnn = (content) => ({ content, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    mpTipos.forEach(t => {
      let val = null;
      if (isUfm2)       val = t.ufm2;
      else if (isRenta) val = (t.sup != null && t.ufm2 != null) ? t.sup * t.ufm2 : null;
      else              val = t.sup;
      if (val == null) return;
      const pct = lerpAtY(refData, val);
      const pctStr = pct !== null ? `P${Math.round(pct)}: ` : '';
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: val, xMax: val, yMax: lerpAtX(kdeData, val) ?? undefined,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${pctStr}${fmtVal(val)} ${distribUnit} (${t.nombre})`),
      };
    });
  }

  const datasets = [
    {
      type: 'bar', label: 'Frecuencia',
      data: bins,
      backgroundColor: 'rgba(59,130,246,0.55)', borderColor: 'rgba(59,130,246,0.85)', borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0, order: 3,
    },
    {
      type: 'line', label: 'Densidad',
      data: kdeData,
      borderColor: '#3b82f6', backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, order: 2,
    },
  ];

  if (normalData) {
    datasets.push({
      type: 'line',
      label: `Normal (μ=${fmtVal(mu)}, σ=${fmtVal(sigma)})`,
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
      const lines = [`μ = ${fmtVal(mu)}   σ = ${fmtVal(sigma)}`, `Ajuste R² = ${normalFit.r2.toFixed(3)}`];
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      const maxW = Math.max(...lines.map(l => c.measureText(l).width));
      const pad2 = 6, lh = fs + 6, boxH = lines.length * lh + pad2 * 2;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(left + 8, top + 8, maxW + pad2 * 2, boxH);
      c.strokeStyle = '#f97316'; c.lineWidth = 1.5;
      c.strokeRect(left + 8, top + 8, maxW + pad2 * 2, boxH);
      c.fillStyle = '#f97316'; c.textBaseline = 'top';
      lines.forEach((line, i) => c.fillText(line, left + 8 + pad2, top + 8 + pad2 + i * lh));
      c.restore();
    },
  };

  const _minVR  = sortedVals[0];
  const _histEdgeTicksR = {
    id: 'histEdgeTicks',
    afterBuildTicks(chart, args) {
      if (args?.scale?.id !== 'x') return;
      const scale = args.scale;
      const lo = scale.min ?? _minVR;
      const hi = scale.max ?? (_minVR + bins.length * bw);
      const kStart = Math.floor((lo - _minVR) / bw);
      const kEnd   = Math.ceil((hi - _minVR) / bw);
      const allTicks = [];
      for (let k = kStart; k <= kEnd; k++) allTicks.push(_minVR + k * bw);
      const step = Math.max(1, Math.ceil(allTicks.length / 12));
      args.scale.ticks = allTicks
        .filter((_, i) => i % step === 0 || i === allTicks.length - 1)
        .map(value => ({ value }));
    },
  };

  distribChart = new Chart(ctx, {
    type: 'bar', data: { datasets }, plugins: [statsPlugin, _histEdgeTicksR],
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => { const x = items[0]?.raw?.x; return x != null ? `${fmtVal(x)} ${distribUnit}` : ''; },
            label: item => { const y = item.raw?.y; return y != null ? ` ${item.dataset.label}: ${y.toFixed(2)}%` : ''; },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: { type: 'linear', bounds: 'data',
          min: _parseAxisVal($('#distribXMin')?.value) ?? x0,
          max: _parseAxisVal($('#distribXMax')?.value) ?? x1,
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => fmtVal(v), font: { size: fs } } },
        y: { beginAtZero: true, bounds: 'data',
          title: { display: true, text: '% de datos', font: { size: fs } },
          ticks: { callback: v => v.toFixed(1) + '%', font: { size: fs } },
          ...(_parseAxisVal($('#distribYMin')?.value) !== null ? { min: _parseAxisVal($('#distribYMin').value) } : {}),
          ...(_parseAxisVal($('#distribYMax')?.value) !== null ? { max: _parseAxisVal($('#distribYMax').value) } : {}),
        },
      },
    },
  });
  _enableAnnotationLabelDrag(distribChart);
}

// ── Modo Log-normal ───────────────────────────────────────────────────────

function _computeLogNormal(sortedVals, nPoints = 300) {
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
    return { x, y: K / x * Math.exp(-0.5 * ((Math.log(x) - mu) / sig) ** 2) };
  });
}

function _renderLognormalRenta(ctx, sortedVals, col, fs, fmtVal) {
  const lnData = _computeLogNormal(sortedVals);
  if (!lnData.length) return;

  const refData = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return { x: pct, y: sortedVals[idx] };
  });

  const valAtPct = pct => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const ANN_COLOR = '#6b7280';
  const annLabel = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  const annotations = {};

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const val = valAtPct(pct);
    if (val == null) return;
    annotations[`dpv_${pct}`] = {
      type: 'line', xMin: val, xMax: val, yMax: lerpAtX(lnData, val) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}: ${fmtVal(val)} ${distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = lerpAtY(refData, price);
    const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
    annotations[`dprv_${price}`] = {
      type: 'line', xMin: price, xMax: price, yMax: lerpAtX(lnData, price) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${fmtVal(price)} ${distribUnit}${pctStr}`),
    };
  });

  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp.inDistrib && mp.tipologias.length > 0) {
    const nc = norm(col);
    const isUfm2  = nc.includes('uf/m') || nc.includes('uf / m');
    const isRenta = !isUfm2 && (nc.includes('renta') || nc.includes('precio'));
    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => norm(c.name).includes(k)));
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => _fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) mpTipos = mpTipos.filter(t => activeTipos.has(_fmtTipo(t.nombre)));
    }
    const mpColor = '#ef4444';
    const mpAnn = (content) => ({ content, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    mpTipos.forEach(t => {
      let val = null;
      if (isUfm2)       val = t.ufm2;
      else if (isRenta) val = (t.sup != null && t.ufm2 != null) ? t.sup * t.ufm2 : null;
      else              val = t.sup;
      if (val == null) return;
      const pct = lerpAtY(refData, val);
      const pctStr = pct !== null ? `P${Math.round(pct)}: ` : '';
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: val, xMax: val, yMax: lerpAtX(lnData, val) ?? undefined,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${pctStr}${fmtVal(val)} ${distribUnit} (${t.nombre})`),
      };
    });
  }

  distribChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: col,
        data: lnData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => { const x = items[0]?.raw?.x; return x != null ? fmtVal(x) + ' ' + distribUnit : ''; },
            label: item => { const y = item.raw?.y; return y != null ? ` Densidad: ${y.toFixed(4)}` : ''; },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear',
          ...(_parseAxisVal($('#distribXMin')?.value) !== null ? { min: _parseAxisVal($('#distribXMin').value) } : {}),
          ...(_parseAxisVal($('#distribXMax')?.value) !== null ? { max: _parseAxisVal($('#distribXMax').value) } : {}),
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => fmtVal(v), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'Densidad', font: { size: fs } },
          ticks: { display: false },
          grid: { display: false },
          ...(_parseAxisVal($('#distribYMin')?.value) !== null ? { min: _parseAxisVal($('#distribYMin').value) } : {}),
          ...(_parseAxisVal($('#distribYMax')?.value) !== null ? { max: _parseAxisVal($('#distribYMax').value) } : {}),
        },
      },
    },
  });
  _enableAnnotationLabelDrag(distribChart);
}