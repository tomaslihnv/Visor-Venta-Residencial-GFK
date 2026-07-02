import { norm } from './utils.js';
import { copyChartPng } from './export.js';

// ── Normal / density helpers ──────────────────────────────────────────────

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
  const n  = sortedVals.length;
  const h  = Math.max(1.06 * sigma * Math.pow(n, -0.2), histBw * 0.1);
  const x0 = sortedVals[0] - 2 * sigma;
  const x1 = sortedVals[n - 1] + 2 * sigma;
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

// ── Module state ──────────────────────────────────────────────────────────

let _distribChart = null;
let _distribReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
let _distribUnit  = 'UF';
let _distribState = null;
let _distribCols  = null;
let _distribMp    = null;

// ── Init ──────────────────────────────────────────────────────────────────

export function initDistribListeners(state, distribCols, mp) {
  _distribState = state; _distribCols = distribCols; _distribMp = mp;
  if (_distribReady) return;
  _distribReady = true;

  const rerender = () => renderDistrib(state, distribCols, mp);

  document.getElementById('distribCol')?.addEventListener('change', rerender);
  document.getElementById('distribNormalToggle')?.addEventListener('change', rerender);
  document.querySelector('.distrib-mp-btn')?.addEventListener('click', () => {
    document.querySelector('.distrib-mp-btn').classList.toggle('active');
    rerender();
  });

  document.querySelectorAll('.distrib-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.distrib-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      const binsCtrl = document.getElementById('distribBinsCtrl');
      if (binsCtrl) binsCtrl.style.display = mode === 'densidad' ? '' : 'none';
      rerender();
    });
  });

  const binsSlider = document.getElementById('distribBins');
  const binsVal    = document.getElementById('distribBinsVal');
  if (binsSlider) {
    binsSlider.addEventListener('input', () => {
      if (binsVal) binsVal.textContent = +binsSlider.value === 0 ? 'Auto' : binsSlider.value;
      rerender();
    });
  }

  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const fontSlider = document.getElementById('distribFontSize');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const val = document.getElementById('distribFontSizeVal');
      if (val) val.textContent = fontSlider.value + 'px';
      rerender();
    });
  }

  document.getElementById('distribExportPngBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('distribExportPngBtn');
    const ok  = await copyChartPng(_distribChart, document.getElementById('distribWrap'), '.ratio-btn');
    if (ok && btn) {
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!'; btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    }
  });

  const addPct = () => {
    const v = parseInt(document.getElementById('distribPctInput')?.value ?? '');
    if (isNaN(v) || v < 1 || v > 99) return;
    distribMarkers.percentiles.add(v);
    document.getElementById('distribPctInput').value = '';
    _refreshMarkerTags(); rerender();
  };
  document.getElementById('distribAddPct')?.addEventListener('click', addPct);
  document.getElementById('distribPctInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPct(); });

  const addPrice = () => {
    const v = parseFloat(document.getElementById('distribPriceInput')?.value ?? '');
    if (isNaN(v) || v <= 0) return;
    distribMarkers.prices.add(v);
    document.getElementById('distribPriceInput').value = '';
    _refreshMarkerTags(); rerender();
  };
  document.getElementById('distribAddPrice')?.addEventListener('click', addPrice);
  document.getElementById('distribPriceInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPrice(); });
}

// ── Selectors ─────────────────────────────────────────────────────────────

export function populateDistribSelectors(state, distribCols) {
  const colSel = document.getElementById('distribCol');
  if (!colSel) return;
  colSel.innerHTML = '';
  for (const def of distribCols) {
    const col = state.columns.find(c => norm(c.name).includes(norm(def.col)));
    if (!col) continue;
    const o = document.createElement('option');
    o.value = col.name; o.textContent = def.label;
    colSel.appendChild(o);
  }
  if (!colSel.options.length) {
    for (const col of state.columns) {
      if (col.type === 'number' && !col.name.startsWith('__')) {
        const o = document.createElement('option');
        o.value = col.name; o.textContent = col.name;
        colSel.appendChild(o); break;
      }
    }
  }
}

// ── Marker tags ───────────────────────────────────────────────────────────

function _refreshMarkerTags() {
  const pctCont   = document.getElementById('distribPctTags');
  const priceCont = document.getElementById('distribPriceTags');
  if (!pctCont) return;
  pctCont.innerHTML = '';
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag pct-tag';
    tag.innerHTML = `P${v} <button data-val="${v}" class="rm-pct">×</button>`;
    tag.querySelector('.rm-pct').addEventListener('click', () => {
      distribMarkers.percentiles.delete(v); _refreshMarkerTags();
      renderDistrib(_distribState, _distribCols, _distribMp);
    });
    pctCont.appendChild(tag);
  });
  if (!priceCont) return;
  priceCont.innerHTML = '';
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag price-tag';
    tag.innerHTML = `${v.toLocaleString('es-CL')} ${_distribUnit} <button data-val="${v}" class="rm-price">×</button>`;
    tag.querySelector('.rm-price').addEventListener('click', () => {
      distribMarkers.prices.delete(v); _refreshMarkerTags();
      renderDistrib(_distribState, _distribCols, _distribMp);
    });
    priceCont.appendChild(tag);
  });
}

// Curva de cuantiles: X = percentil (0–100%), Y = valor
function _enableAnnotationLabelDrag(chart) {
  const canvas = chart.canvas;
  let dragging = null;

  function _anns() { return chart.options?.plugins?.annotation?.annotations ?? {}; }

  function _anchor(ann) {
    const ca = chart.chartArea, sx = chart.scales?.x, sy = chart.scales?.y;
    if (!ca || !sx || !sy) return null;
    if (ann.xMin != null && (ann.xMax == null || ann.xMin === ann.xMax))
      return { ax: sx.getPixelForValue(ann.xMin), ay: sy.getPixelForValue(ann.yMin ?? sy.min ?? 0) };
    if (ann.yMin != null && (ann.yMax == null || ann.yMin === ann.yMax))
      return { ax: sx.getPixelForValue(ann.xMin ?? sx.min ?? 0), ay: sy.getPixelForValue(ann.yMin) };
    return null;
  }

  function _box(key) {
    const ann = _anns()[key];
    if (!ann?.label || ann.label.display === false) return null;
    const a = _anchor(ann);
    if (!a) return null;
    const fs = ann.label.font?.size ?? 11;
    const text = Array.isArray(ann.label.content) ? ann.label.content.join(' ') : String(ann.label.content ?? '');
    const ctx2 = canvas.getContext('2d');
    ctx2.save(); ctx2.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = ctx2.measureText(text).width; ctx2.restore();
    return { cx: a.ax + (ann.label.xAdjust ?? 0), cy: a.ay + (ann.label.yAdjust ?? 0), w: tw + 16, h: fs * 1.8 };
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

function _lerpAtX(data, x) {
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

function _lerpAtY(data, y) {
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

function _fmtVal(v) {
  if (v >= 100) return v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  if (v >= 10)  return v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  return v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tipologías de Mi Proyecto a graficar: respeta el filtro de Programa activo
// en el sidebar (si hay alguno), igual que los comparables del mercado.
function _mpTiposFiltrados(mp) {
  const tipos = (mp.tipologias ?? []).filter(t => t.nombre);
  const programaFilter = _distribState?.filterValues?.programa;
  if (programaFilter?.size > 0) return tipos.filter(t => programaFilter.has(t.nombre));
  return tipos;
}

// Valor de una tipología de Mi Proyecto para la columna de distribución elegida.
// Vacancia/Stock/Rating son métricas de edificio, no existen por tipología —
// no hay punto que graficar para esas, a diferencia de Útil/UF/m²/Arriendo.
function _mpValForCol(col, t) {
  const nc = norm(col);
  if (nc.includes('uf/m')) return t.ufm2 ?? null;
  if (nc.includes('util') || nc.includes('útil')) return t.sup ?? null;
  if (nc.includes('renta') || nc.includes('arriendo') || nc.includes('precio')) {
    return t.renta ?? (t.sup != null && t.ufm2 != null ? t.sup * t.ufm2 : null);
  }
  return null;
}

function _statsPlugin(normalFit, fs) {
  return {
    id: 'normalStats',
    afterDraw(chart) {
      if (!normalFit) return;
      const { ctx: c, chartArea: { left, top } } = chart;
      const lines = [
        `μ = ${_fmtVal(normalFit.mu)}   σ = ${_fmtVal(normalFit.sigma)}`,
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
}

// ── Main render ───────────────────────────────────────────────────────────

export function renderDistrib(state, distribCols, mp) {
  _distribState = state; _distribCols = distribCols; _distribMp = mp;

  const colSel = document.getElementById('distribCol');
  if (!colSel || !state.filtered.length) return;

  const col = colSel.value;
  // El def original (con unit/perBuilding) se resuelve igual que en
  // populateDistribSelectors, ya que colSel.value guarda el nombre real
  // de columna, no el candidate de config.
  const def = distribCols.find(d => state.columns.find(c => norm(c.name).includes(norm(d.col)))?.name === col);
  _distribUnit = def?.unit ?? '';
  const markLabel = document.getElementById('distribMarkLabel');
  if (markLabel) markLabel.textContent = `Marcar ${def?.label ?? 'valor'}`;
  const fs   = parseInt(document.getElementById('distribFontSize')?.value ?? '11');
  const mode = document.querySelector('.distrib-mode-btn.active')?.dataset.mode ?? 'acumulada';

  if (_distribChart) { _distribChart.destroy(); _distribChart = null; }
  const ctx = document.getElementById('distribChart')?.getContext('2d');
  if (!ctx) return;

  // Métricas de edificio (Vacancia, Rating) se repiten idénticas en cada fila
  // de tipología del mismo proyecto — sin deduplicar, los edificios con más
  // tipologías pesarían más de lo debido en la distribución.
  let rows = state.filtered;
  if (def?.perBuilding) {
    const projCol = state.columns.find(c => ['proyecto', 'edificio', 'nombre'].some(k => norm(c.name).includes(norm(k))))?.name;
    if (projCol) {
      const seen = new Set();
      rows = rows.filter(r => {
        const key = r[projCol];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  const sortedVals = rows
    .map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  if (sortedVals.length < 2) return;

  const showNormal = document.getElementById('distribNormalToggle')?.checked ?? false;
  const label = def?.label ?? col;

  if (mode === 'densidad') {
    _renderDensidad(ctx, sortedVals, col, fs, showNormal, mp, label);
  } else if (mode === 'lognormal') {
    _renderLognormal(ctx, sortedVals, col, fs, mp, label);
  } else if (mode === 'cuantil') {
    _renderCuantil(ctx, sortedVals, col, fs, showNormal, mp, label);
  } else {
    _renderAcumulada(ctx, sortedVals, col, fs, showNormal, mp, label);
  }
}

// ── Normal fit para modo CDF (x=valor, y=percentil) ──────────────────────

function _computeNormalFitCDF(sortedVals) {
  const n = sortedVals.length;
  if (n < 3) return null;
  const mu    = sortedVals.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(sortedVals.reduce((s, v) => s + (v - mu) ** 2, 0) / n);
  if (sigma === 0) return null;

  // CDF formato: x=valor, y=percentil (0–100)
  const curve = Array.from({ length: 99 }, (_, i) => {
    const pct = i + 1;
    return { x: mu + sigma * _probit(pct / 100), y: pct };
  });

  // R² en espacio de valores (comparar cuantiles empíricos vs teóricos)
  const valAtPct = pct => {
    const h = (pct / 100) * (n - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    if (lo === hi) return sortedVals[lo];
    return sortedVals[lo] + (h - lo) * (sortedVals[hi] - sortedVals[lo]);
  };
  let ssRes = 0, ssTot = 0;
  const sample = Array.from({ length: 91 }, (_, i) => i + 5);
  const empMean = sample.reduce((s, p) => s + valAtPct(p), 0) / sample.length;
  for (const pct of sample) {
    const emp  = valAtPct(pct);
    const theo = mu + sigma * _probit(pct / 100);
    ssRes += (emp - theo) ** 2;
    ssTot += (emp - empMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { curve, mu, sigma, r2 };
}

// ── Modo Acumulada — CDF real (x=valor, y=% acumulado) ────────────────────
// La curva crece rápido donde hay más densidad (zona del promedio) y se aplana
// en las colas: forma sigmoide/logística para datos normales o levemente sesgados.

function _readSmooth() { return 0.4; }

function _renderAcumulada(ctx, sortedVals, col, fs, showNormal, mp, label = col) {
  const n = sortedVals.length;

  const valAtPct = pct => {
    const h = (pct / 100) * (n - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    if (lo === hi) return sortedVals[lo];
    return sortedVals[lo] + (h - lo) * (sortedVals[hi] - sortedVals[lo]);
  };

  // CDF: x = valor, y = percentil acumulado (0–100)
  const refDataClean = Array.from({ length: 101 }, (_, pct) => ({ x: valAtPct(pct), y: pct }));
  const xMin = sortedVals[0], xMax = sortedVals[n - 1];

  const normalFit = showNormal ? _computeNormalFitCDF(sortedVals) : null;

  // cubicInterpolationMode:'monotone' evita overshoot — sin esto el bezier sube/baja
  // más allá del rango 0-100 y Chart.js recorta la línea, creando "cortes" visibles.
  const datasets = [{
    label: label,
    data: refDataClean,
    borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.10)',
    pointRadius: 0, borderWidth: 2, cubicInterpolationMode: 'monotone', fill: true,
  }];

  if (normalFit) {
    datasets.push({
      label: `Normal (μ=${_fmtVal(normalFit.mu)}, σ=${_fmtVal(normalFit.sigma)})`,
      data: normalFit.curve,
      borderColor: '#f97316', backgroundColor: 'transparent',
      pointRadius: 0, borderWidth: 2, borderDash: [6, 3], cubicInterpolationMode: 'monotone', fill: false,
    });
  }

  const ANN_COLOR = '#6b7280';
  const annotations = {};
  const annLabel = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  // Marcadores de percentil → encuentra el valor y dibuja la cruz
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const price = valAtPct(pct);
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: price, xMax: price, yMax: pct,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}`),
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: pct, yMax: pct, xMax: price,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${_fmtVal(price)} ${_distribUnit}`),
    };
  });

  // Marcadores de valor → encuentra el percentil y dibuja la cruz
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = _lerpAtX(refDataClean, price);
    annotations[`prv_${price}`] = {
      type: 'line', xMin: price, xMax: price, yMax: pct ?? 100,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${_fmtVal(price)} ${_distribUnit}`),
    };
    if (pct !== null) {
      annotations[`prh_${price}`] = {
        type: 'line', yMin: pct, yMax: pct, xMax: price,
        borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct.toFixed(1)}`),
      };
    }
  });

  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp?.inDistrib && mp.tipologias?.length > 0) {
    const mpColor = '#96323C';
    const mpAnn = (c) => ({ content: c, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    _mpTiposFiltrados(mp).forEach(t => {
      const val = _mpValForCol(col, t);
      if (val == null) return;
      const pct = _lerpAtX(refDataClean, val);
      if (pct === null) return;
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: val, xMax: val, yMax: pct,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${t.nombre}: ${_fmtVal(val)}`),
      };
      annotations[`mp_h_${t.id}`] = {
        type: 'line', yMin: pct, yMax: pct, xMax: val,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`P${pct.toFixed(1)}`),
      };
    });
  }

  _distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [_statsPlugin(normalFit, fs)],
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => {
              const pt = items[0]?.raw;
              return pt ? `${_fmtVal(pt.x)} ${_distribUnit}` : '';
            },
            label: item => {
              const y = item.raw?.y;
              if (y == null) return '';
              return ` ${item.dataset.label}: P${_fmtVal(y)}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear', min: xMin, max: xMax,
          title: { display: true, text: label, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          type: 'linear', min: 0, max: 100,
          title: { display: true, text: 'Acumulado (%)', font: { size: fs } },
          ticks: { callback: v => v + '%', font: { size: fs } },
        },
      },
    },
  });
  _enableAnnotationLabelDrag(_distribChart);
}

// ── Modo Cuantil — función cuantil (x=% percentil, y=valor) ──────────────
// Permite leer directamente "¿cuánto vale el P50?". Para datos sesgados se
// aplana en la zona de mayor densidad y sube rápido en las colas.

function _renderCuantil(ctx, sortedVals, col, fs, showNormal, mp, label = col) {
  const n = sortedVals.length;
  const tension = _readSmooth();

  const valAtPct = pct => {
    const h = (pct / 100) * (n - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    if (lo === hi) return sortedVals[lo];
    return sortedVals[lo] + (h - lo) * (sortedVals[hi] - sortedVals[lo]);
  };

  // Cuantil: x = percentil (0–100), y = valor
  const refDataClean = Array.from({ length: 101 }, (_, pct) => ({ x: pct, y: valAtPct(pct) }));

  const normalFit = showNormal ? _computeNormalFit(sortedVals, refDataClean) : null;

  const datasets = [{
    label: label,
    data: refDataClean,
    borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.10)',
    pointRadius: 0, borderWidth: 2, tension, fill: true,
  }];

  if (normalFit) {
    datasets.push({
      label: `Normal (μ=${_fmtVal(normalFit.mu)}, σ=${_fmtVal(normalFit.sigma)})`,
      data: normalFit.curve,
      borderColor: '#f97316', backgroundColor: 'transparent',
      pointRadius: 0, borderWidth: 2, borderDash: [6, 3], tension, fill: false,
    });
  }

  const ANN_COLOR = '#6b7280';
  const annotations = {};
  const annLabel = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const price = _lerpAtX(refDataClean, pct);
    if (!price) return;
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}`),
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${_fmtVal(price)} ${_distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = _lerpAtY(refDataClean, price);
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct ?? 100,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${_fmtVal(price)} ${_distribUnit}`),
    };
    if (pct !== null) {
      annotations[`prv_${price}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct.toFixed(1)}`),
      };
    }
  });

  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp?.inDistrib && mp.tipologias?.length > 0) {
    const mpColor = '#96323C';
    const mpAnn = (c) => ({ content: c, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    _mpTiposFiltrados(mp).forEach(t => {
      const val = _mpValForCol(col, t);
      if (val == null) return;
      const pct = _lerpAtY(refDataClean, val);
      if (pct === null) return;
      annotations[`mp_h_${t.id}`] = {
        type: 'line', yMin: val, yMax: val, xMax: pct,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${t.nombre}: ${_fmtVal(val)}`),
      };
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: val,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`P${pct.toFixed(1)}`),
      };
    });
  }

  _distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [_statsPlugin(normalFit, fs)],
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => {
              const pt = refDataClean[items[0]?.dataIndex] ?? items[0]?.raw;
              return pt ? `P${Number(pt.x).toFixed(1)}` : '';
            },
            label: item => {
              const y = item.datasetIndex === 0 ? refDataClean[item.dataIndex]?.y : item.raw?.y;
              if (y == null) return '';
              return ` ${item.dataset.label}: ${_fmtVal(y)} ${_distribUnit}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: { type: 'linear', min: 0, max: 100,
          title: { display: true, text: 'Percentil (%)', font: { size: fs } },
          ticks: { callback: v => v + '%', font: { size: fs } } },
        y: { title: { display: true, text: label, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } } },
      },
    },
  });
  _enableAnnotationLabelDrag(_distribChart);
}

// ── Modo Densidad (histograma + KDE + normal PDF) ─────────────────────────

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

function _renderLognormal(ctx, sortedVals, col, fs, mp, label = col) {
  const lnData = _computeLogNormal(sortedVals);
  if (!lnData.length) return;

  const refData = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return { x: pct, y: sortedVals[idx] };
  });
  const valAtPct = pct => sortedVals[Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1)];

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
      type: 'line', xMin: val, xMax: val, yMax: _lerpAtX(lnData, val) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`P${pct}: ${_fmtVal(val)} ${_distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = _lerpAtY(refData, price);
    const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
    annotations[`dprv_${price}`] = {
      type: 'line', xMin: price, xMax: price, yMax: _lerpAtX(lnData, price) ?? undefined,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabel(`${_fmtVal(price)} ${_distribUnit}${pctStr}`),
    };
  });

  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp?.inDistrib && mp.tipologias?.length > 0) {
    const mpColor = '#96323C';
    const mpAnn = (content) => ({ content, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    _mpTiposFiltrados(mp).forEach(t => {
      const val = _mpValForCol(col, t);
      if (val == null) return;
      const pct = _lerpAtY(refData, val);
      const pctStr = pct !== null ? `P${Math.round(pct)}: ` : '';
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: val, xMax: val, yMax: _lerpAtX(lnData, val) ?? undefined,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${pctStr}${_fmtVal(val)} ${_distribUnit} (${t.nombre})`),
      };
    });
  }

  _distribChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: label,
        data: lnData,
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.08)',
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
            title: items => { const x = items[0]?.raw?.x; return x != null ? `${_fmtVal(x)} ${_distribUnit}` : ''; },
            label: item => { const y = item.raw?.y; return y != null ? ` Densidad: ${y.toFixed(4)}` : ''; },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: label, font: { size: fs } },
          ticks: { callback: v => _fmtVal(v), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'Densidad', font: { size: fs } },
          ticks: { display: false },
          grid: { display: false },
        },
      },
    },
  });
  _enableAnnotationLabelDrag(_distribChart);
}

// ── Modo Densidad (histograma + KDE + normal PDF) ─────────────────────────

function _renderDensidad(ctx, sortedVals, col, fs, showNormal, mp, label = col) {
  const refData  = Array.from({ length: 101 }, (_, pct) => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return { x: pct, y: sortedVals[idx] };
  });
  const normalFit = _computeNormalFit(sortedVals, refData);
  const { mu, sigma } = normalFit ?? {
    mu:    sortedVals.reduce((a, b) => a + b, 0) / sortedVals.length,
    sigma: Math.sqrt(sortedVals.reduce((s, v) => {
      const m = sortedVals.reduce((a, b) => a + b, 0) / sortedVals.length;
      return s + (v - m) ** 2;
    }, 0) / sortedVals.length),
  };

  const userBins = parseInt(document.getElementById('distribBins')?.value ?? '0');
  const binCount = userBins > 0 ? userBins : undefined;
  const { bins, bw } = _computeHistogram(sortedVals, binCount);
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
      backgroundColor: 'rgba(56,189,248,0.35)', borderColor: '#38bdf8', borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0, order: 3,
    },
    {
      type: 'line', label: 'Densidad',
      data: kdeData,
      borderColor: '#0ea5e9', backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, order: 2,
    },
  ];

  if (normalData) {
    datasets.push({
      type: 'line',
      label: `Normal (μ=${_fmtVal(mu)}, σ=${_fmtVal(sigma)})`,
      data: normalData,
      borderColor: '#f97316', backgroundColor: 'transparent',
      borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0.3, fill: false, order: 1,
    });
  }

  const valAtPct = pct => sortedVals[Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1)];

  const ANN_COLOR_D = '#6b7280';
  const annLabelD = (content) => ({
    content, display: true, position: 'start',
    color: ANN_COLOR_D, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  const annotations = {};

  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const val = valAtPct(pct);
    if (val == null) return;
    annotations[`dpv_${pct}`] = {
      type: 'line', xMin: val, xMax: val, yMax: _lerpAtX(kdeData, val) ?? undefined,
      borderColor: ANN_COLOR_D, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabelD(`P${pct}: ${_fmtVal(val)} ${_distribUnit}`),
    };
  });

  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = _lerpAtY(refData, price);
    const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
    annotations[`dprv_${price}`] = {
      type: 'line', xMin: price, xMax: price, yMax: _lerpAtX(kdeData, price) ?? undefined,
      borderColor: ANN_COLOR_D, borderWidth: 1.5, borderDash: [6, 4],
      label: annLabelD(`${_fmtVal(price)} ${_distribUnit}${pctStr}`),
    };
  });

  const showMpDistribD = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistribD && mp?.inDistrib && mp.tipologias?.length > 0) {
    const mpColor = '#96323C';
    const mpAnn = (content) => ({ content, display: true, position: 'start', color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)', padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } });
    _mpTiposFiltrados(mp).forEach(t => {
      const val = _mpValForCol(col, t);
      if (val == null) return;
      const pct = _lerpAtY(refData, val);
      const pctStr = pct !== null ? `P${Math.round(pct)}: ` : '';
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: val, xMax: val, yMax: _lerpAtX(kdeData, val) ?? undefined,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: mpAnn(`${pctStr}${_fmtVal(val)} ${_distribUnit} (${t.nombre})`),
      };
    });
  }

  _distribChart = new Chart(ctx, {
    type: 'bar',
    data: { datasets },
    plugins: [_statsPlugin(showNormal ? normalFit : null, fs)],
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest', intersect: false, axis: 'x',
          callbacks: {
            title: items => {
              const x = items[0]?.raw?.x;
              return x != null ? `${_fmtVal(x)} ${_distribUnit}` : '';
            },
            label: item => {
              const y = item.raw?.y;
              if (y == null) return '';
              return ` ${item.dataset.label}: ${y.toFixed(2)}%`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: { type: 'linear', min: x0, max: x1,
          title: { display: true, text: label, font: { size: fs } },
          ticks: { callback: v => _fmtVal(v), font: { size: fs } } },
        y: { beginAtZero: true,
          title: { display: true, text: '% de datos', font: { size: fs } },
          ticks: { callback: v => v.toFixed(1) + '%', font: { size: fs } } },
      },
    },
  });
  _enableAnnotationLabelDrag(_distribChart);
}
