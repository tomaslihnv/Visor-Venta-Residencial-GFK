import { norm } from './utils.js';

// metricDefs: array of { id, label, col, agg, fmt }
// agg: 'avg' | 'sum' | 'count'
// fmt: function(value) => string
//
// options: { canvasId, selectId, exportBtnId, projectCandidates }

const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7'];

// Mediana ponderada: pairs = [[valor, peso], ...]. Con peso 1 para todos
// equivale a la mediana simple de siempre.
function _weightedMedian(pairs) {
  const sorted = pairs.filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  const total  = sorted.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return sorted[sorted.length - 1]?.[0] ?? null;
}

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

let _proyChart  = null;
let _proyReady  = false;

export function initProyectosListeners(state, metricDefs, mp, options = {}) {
  if (_proyReady) return;
  _proyReady = true;

  const selectId    = options.selectId    ?? 'proyMetrica';
  const exportBtnId = options.exportBtnId ?? 'proyExportPngBtn';

  document.getElementById(selectId)?.addEventListener('change', () => {
    renderProyectos(state, metricDefs, mp, options);
  });

  const fontSlider = document.getElementById('proyFontSize');
  const fontVal    = document.getElementById('proyFontSizeVal');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      if (fontVal) fontVal.textContent = fontSlider.value + 'px';
      renderProyectos(state, metricDefs, mp, options);
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
      renderProyectos(state, metricDefs, mp, options);
    });
  });

  document.querySelectorAll('.proy-median-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-median-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProyectos(state, metricDefs, mp, options);
    });
  });

  document.getElementById(exportBtnId)?.addEventListener('click', async () => {
    if (!_proyChart) return;
    const btn = document.getElementById(exportBtnId);
    const scale = 4;
    const pad = 32;
    const wrap = document.getElementById('proyWrap');
    const ratio = document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto';

    const origDPR = _proyChart.options.devicePixelRatio ?? window.devicePixelRatio;
    const exportW = wrap ? wrap.clientWidth - pad : _proyChart.width;
    const exportH = ratio === 'auto'
      ? _proyChart.height
      : Math.round(exportW / parseFloat(ratio));

    _proyChart.options.devicePixelRatio = scale;
    _proyChart.resize(exportW, exportH);
    const url = _proyChart.toBase64Image('image/png', 1);
    _proyChart.options.devicePixelRatio = origDPR;
    _proyChart.resize();
    const prev = btn.textContent;
    const blob = await _withMargin(url, 64);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    btn.textContent = '¡Copiado!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
  });
}

export function renderProyectos(state, metricDefs, mp, options = {}) {
  if (!state.filtered.length) return;

  const canvasId  = options.canvasId  ?? 'proyChart';
  const selectId  = options.selectId  ?? 'proyMetrica';
  const projCands = options.projectCandidates ?? ['proyecto', 'edificio', 'nombre', 'building'];

  const metricId = document.getElementById(selectId)?.value ?? metricDefs[0]?.id;
  const metric   = metricDefs.find(m => m.id === metricId) ?? metricDefs[0];
  if (!metric) return;

  const proyCol  = state.columns.find(c => projCands.some(k => norm(c.name).includes(norm(k))))?.name;
  const metricCol = metric.col
    ? state.columns.find(c => c.type === 'number' && norm(c.name).includes(norm(metric.col)))?.name
    : null;

  if (!proyCol) return;
  if (metric.col && !metricCol) return;

  const fs = parseInt(document.getElementById('proyFontSize')?.value ?? '11');
  const xRot = document.querySelector('.proy-xrot-btn.active')?.dataset.rot ?? 'diagonal';
  const xMaxRot = xRot === 'vertical' ? 90 : 45;
  const xMinRot = xRot === 'vertical' ? 90 : 30;
  const showMedian = (document.querySelector('.proy-median-btn.active')?.dataset.median ?? 'show') === 'show';

  if (_proyChart) { _proyChart.destroy(); _proyChart = null; }
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const byProj = {};
  for (const r of state.filtered) {
    const proj = String(r[proyCol] ?? '').trim();
    if (!proj) continue;
    if (!byProj[proj]) byProj[proj] = [];
    if (!metric.col) {
      byProj[proj].push(1);
    } else {
      const val = Number(r[metricCol]);
      if (!isNaN(val) && val > 0) byProj[proj].push(val);
    }
  }

  const aggFn = metric.agg === 'sum'
    ? arr => arr.reduce((a, b) => a + b, 0)
    : metric.agg === 'count'
      ? arr => arr.length
      : arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  let entries = Object.entries(byProj)
    .filter(([, vals]) => vals.length > 0)
    .map(([proj, vals]) => [proj, aggFn(vals)]);

  // Mi Proyecto
  let mpName = null;
  if (mp?.inProy && mp.proyecto && options.getMpValue) {
    const mpVal = options.getMpValue(metric.id, mp);
    if (mpVal !== null && mpVal !== undefined) {
      mpName = mp.proyecto;
      entries.push([mpName, mpVal]);
    }
  }

  entries = entries.sort((a, b) => b[1] - a[1]);

  const MP_COLOR  = '#96323C';
  const BAR_COLOR = '#DDE0E3';

  // Mediana ponderada por Stock: cada unidad pesa igual, no cada proyecto
  // (un edificio de 391 unidades influye más que uno de 54).
  const stockCol = state.columns.find(c => norm(c.name).includes('stock'))?.name;
  const stockByProj = {};
  if (stockCol) {
    for (const r of state.filtered) {
      const proj = String(r[proyCol] ?? '').trim();
      if (!proj) continue;
      const v = Number(r[stockCol]);
      if (!isNaN(v) && v > 0) stockByProj[proj] = (stockByProj[proj] ?? 0) + v;
    }
  }
  const weightedPairs = entries.map(([proj, val]) => [
    val,
    stockCol ? (proj === mpName ? (mp?.stock ?? 0) : (stockByProj[proj] ?? 0)) : 1,
  ]);
  const medianVal = showMedian ? _weightedMedian(weightedPairs) : null;

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
      borderColor: '#dc2626', borderWidth: 1.5, borderDash: [5, 4],
      label: { content: `Mediana: ${metric.fmt(medianVal)}`, display: true, position: 'end', font: { size: fs - 1 }, color: '#dc2626', backgroundColor: 'rgba(255,255,255,0.85)' },
    },
  } : {};

  _proyChart = new Chart(ctx, {
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
