import { norm } from './utils.js';

function _parseAxisVal(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function _$(id) { return document.getElementById(id); }

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

// ── Drag de etiquetas de anotaciones (ej. "Mediana") ────────────────────────
// Mismo patrón que chart-distrib.js, generalizado para leer label.position
// ('start'|'center'|'end') ya que acá la mediana usa 'end'.
function _enableAnnotationLabelDrag(chart) {
  const canvas = chart.canvas;
  let dragging = null;

  function _anns() { return chart.options?.plugins?.annotation?.annotations ?? {}; }

  function _anchorCoord(scale, vMin, vMax, position) {
    if (position === 'end')    return scale.getPixelForValue(vMax ?? scale.max ?? 0);
    if (position === 'center') return (scale.getPixelForValue(scale.min ?? 0) + scale.getPixelForValue(scale.max ?? 0)) / 2;
    return scale.getPixelForValue(vMin ?? scale.min ?? 0);
  }

  function _anchor(ann) {
    const sx = chart.scales?.x, sy = chart.scales?.y;
    if (!sx || !sy) return null;
    const pos = ann.label?.position ?? 'start';
    if (ann.xMin != null && (ann.xMax == null || ann.xMin === ann.xMax))
      return { ax: sx.getPixelForValue(ann.xMin), ay: _anchorCoord(sy, ann.yMin, ann.yMax, pos) };
    if (ann.yMin != null && (ann.yMax == null || ann.yMin === ann.yMax))
      return { ax: _anchorCoord(sx, ann.xMin, ann.xMax, pos), ay: sy.getPixelForValue(ann.yMin) };
    return null;
  }

  function _box(key) {
    const ann = _anns()[key];
    if (!ann?.label || ann.label.display === false) return null;
    const a = _anchor(ann);
    if (!a) return null;
    const fs = ann.label.font?.size ?? 11;
    const content = Array.isArray(ann.label.content) ? ann.label.content : [ann.label.content];
    const text = content.join(' ');
    const ctx2 = canvas.getContext('2d');
    ctx2.save(); ctx2.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = Math.max(...content.map(l => ctx2.measureText(String(l ?? '')).width));
    ctx2.restore();
    return { cx: a.ax + (ann.label.xAdjust ?? 0), cy: a.ay + (ann.label.yAdjust ?? 0), w: tw + 16, h: fs * 1.8 * content.length };
  }

  function _hit(mx, my) {
    for (const key of Object.keys(_anns())) {
      const b = _box(key);
      if (b && Math.abs(mx - b.cx) <= b.w / 2 + 10 && Math.abs(my - b.cy) <= b.h / 2 + 10) return key;
    }
    return null;
  }

  canvas.addEventListener('mousedown', e => {
    const key = _hit(e.offsetX, e.offsetY);
    if (!key) return;
    const ann = _anns()[key];
    if (!ann?.label) return;
    e.preventDefault(); e.stopPropagation();
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = false;
    dragging = { key, sx: e.offsetX, sy: e.offsetY, ox: ann.label.xAdjust ?? 0, oy: ann.label.yAdjust ?? 0 };
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
    dragging = null; canvas.style.cursor = '';
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = true;
    chart.update('none');
  }
  canvas.addEventListener('mouseup', _stop);
  canvas.addEventListener('mouseleave', _stop);
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
  _$('proyYMin')?.addEventListener('input', () => renderProyectos(state, metricDefs, mp, options));
  _$('proyYMax')?.addEventListener('input', () => renderProyectos(state, metricDefs, mp, options));

  const fontSlider = document.getElementById('proyFontSize');
  const fontVal    = document.getElementById('proyFontSizeVal');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      if (fontVal) fontVal.textContent = fontSlider.value + 'px';
      renderProyectos(state, metricDefs, mp, options);
    });
  }

  document.getElementById('proyGridToggle')?.addEventListener('change', () => renderProyectos(state, metricDefs, mp, options));

  document.querySelectorAll('.proy-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const customEl = document.getElementById('proyRatioCustom');
      if (customEl) customEl.value = '';
    });
  });
  document.getElementById('proyRatioCustom')?.addEventListener('input', e => {
    if (e.target.value.trim() !== '') document.querySelectorAll('.proy-ratio-btn').forEach(b => b.classList.remove('active'));
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
    const customVal = parseFloat(document.getElementById('proyRatioCustom')?.value ?? '');
    const ratio = (!isNaN(customVal) && customVal > 0)
      ? String(customVal)
      : (document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto');

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
  const gridOn = _$('proyGridToggle') ? _$('proyGridToggle').checked : true;

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
  let mpVal  = null;
  if (mp?.inProy && mp.proyecto && options.getMpValue) {
    mpVal = options.getMpValue(metric.id, mp);
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

  const medianLabel = medianVal != null ? [`Mediana: ${metric.fmt(medianVal)}`] : null;
  if (medianLabel && mpName && mpVal != null && mpVal > 0 && medianVal !== mpVal) {
    const diff = ((medianVal - mpVal) / Math.abs(mpVal)) * 100;
    const abs  = Math.abs(diff).toLocaleString('es-CL', { maximumFractionDigits: 0 });
    medianLabel.push(`(${abs}% ${diff > 0 ? 'mayor' : 'menor'} al proyecto)`);
  }
  const medianAnnotations = medianVal != null ? {
    mediana: {
      type: 'line', yMin: medianVal, yMax: medianVal,
      borderColor: '#ef4444', borderWidth: 1.5, borderDash: [5, 4],
      label: { content: medianLabel, display: true, position: 'end', clip: false, font: { size: fs - 1 }, color: '#ef4444', backgroundColor: 'rgba(255,255,255,0.92)' },
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
      layout: { padding: { top: Math.max(40, fs * 3), right: 20, bottom: 12, left: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: item => ` ${metric.fmt(item.raw)}` } },
        annotation: { annotations: medianAnnotations },
      },
      scales: {
        x: { grid: { display: gridOn }, ticks: { maxRotation: xMaxRot, minRotation: xMinRot, font: { size: fs } } },
        y: {
          title: { display: false },
          grid: { display: gridOn },
          ticks: { callback: v => metric.fmt(v), font: { size: fs } },
          beginAtZero: false,
          ...(_parseAxisVal(_$('proyYMin')?.value) !== null ? { min: _parseAxisVal(_$('proyYMin').value) } : {}),
          ...(_parseAxisVal(_$('proyYMax')?.value) !== null ? { max: _parseAxisVal(_$('proyYMax').value) } : {}),
        },
      },
    },
    plugins: [barLabelsPlugin, {
      id: 'yAxisHLabel',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(metric.label, chartArea.left, chartArea.top - 22);
        ctx.restore();
      },
    }],
  });
  _enableAnnotationLabelDrag(_proyChart);
}
