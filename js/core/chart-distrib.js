import { norm } from './utils.js';
import { copyChartPng } from './export.js';

// distribCols: [{ col, label }] — columns to offer in the selector
// mp (optional): Mi Proyecto state for overlay

let _distribChart = null;
let _distribReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
let _distribUnit  = 'UF';
let _distribState = null;
let _distribCols  = null;
let _distribMp    = null;

export function initDistribListeners(state, distribCols, mp) {
  _distribState = state;
  _distribCols  = distribCols;
  _distribMp    = mp;

  if (!_distribReady) {
    _distribReady = true;

    document.getElementById('distribCol')?.addEventListener('change', () => renderDistrib(state, distribCols, mp));

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
        renderDistrib(state, distribCols, mp);
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
      _refreshMarkerTags();
      renderDistrib(state, distribCols, mp);
    };
    document.getElementById('distribAddPct')?.addEventListener('click', addPct);
    document.getElementById('distribPctInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPct(); });

    const addPrice = () => {
      const v = parseFloat(document.getElementById('distribPriceInput')?.value ?? '');
      if (isNaN(v) || v <= 0) return;
      distribMarkers.prices.add(v);
      document.getElementById('distribPriceInput').value = '';
      _refreshMarkerTags();
      renderDistrib(state, distribCols, mp);
    };
    document.getElementById('distribAddPrice')?.addEventListener('click', addPrice);
    document.getElementById('distribPriceInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPrice(); });
  }
}

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
  // Fallback: first numeric column
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
}

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
      distribMarkers.percentiles.delete(v);
      _refreshMarkerTags();
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
      distribMarkers.prices.delete(v);
      _refreshMarkerTags();
      renderDistrib(_distribState, _distribCols, _distribMp);
    });
    priceCont.appendChild(tag);
  });
}

// Curva de cuantiles: X = percentil (0–100%), Y = valor
function _computeQuantileCurve(rows, col) {
  const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
  if (vals.length < 2) return [];
  vals.sort((a, b) => a - b);
  const n = vals.length;
  return vals.map((v, i) => ({ x: (i / (n - 1)) * 100, y: v }));
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

export function renderDistrib(state, distribCols, mp) {
  _distribState = state; _distribCols = distribCols; _distribMp = mp;

  const colSel = document.getElementById('distribCol');
  if (!colSel || !state.filtered.length) return;

  const col  = colSel.value;
  const _nc  = norm(col);
  _distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²' : 'UF';
  const fs   = parseInt(document.getElementById('distribFontSize')?.value ?? '11');

  if (_distribChart) { _distribChart.destroy(); _distribChart = null; }
  const ctx = document.getElementById('distribChart')?.getContext('2d');
  if (!ctx) return;

  const sortedVals = state.filtered
    .map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  if (sortedVals.length < 2) return;

  const valAtPct = pct => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const refData = _computeQuantileCurve(state.filtered, col);
  const datasets = [{
    label: col,
    data: refData,
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56,189,248,0.10)',
    pointRadius: 0, borderWidth: 2, tension: 0.55, fill: true,
  }];

  const annotations = {};
  const RED = '#ef4444';

  // Percentile markers
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const price = _lerpAtX(refData, pct);
    if (!price) return;
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `P${pct}`, display: true, position: 'start',
        color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${_fmtVal(price)} ${_distribUnit}`, display: true, position: 'start',
        color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
  });

  // Price markers
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = _lerpAtY(refData, price);
    const pctForLabel = pct !== null ? pct : 100;
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${_fmtVal(price)} ${_distribUnit}`, display: true, position: 'start',
        color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
    if (pct !== null) {
      annotations[`prv_${price}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `P${pct.toFixed(1)}`, display: true, position: 'start',
          color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
      };
    }
  });

  // Mi Proyecto overlay (if provided and has relevant metrics)
  if (mp?.inDistrib && mp.tipologias?.length > 0) {
    const nc       = norm(col);
    const isUfm2   = nc.includes('uf/m') || nc.includes('uf / m');
    const isRenta  = !isUfm2 && (nc.includes('renta') || nc.includes('arriendo') || nc.includes('precio'));
    const mpColor  = '#1e3a5f';

    mp.tipologias.filter(t => t.nombre).forEach(t => {
      let val = null;
      if (isUfm2)       val = t.ufm2 ?? null;
      else if (isRenta) val = t.renta ?? (t.sup != null && t.ufm2 != null ? t.sup * t.ufm2 : null);
      else              val = t.sup ?? null;
      if (val == null) return;

      const pct = _lerpAtY(refData, val);
      if (pct === null) return;
      annotations[`mp_h_${t.id}`] = {
        type: 'line', yMin: val, yMax: val, xMax: pct,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: { content: `${t.nombre}: ${_fmtVal(val)}`, display: true, position: 'start',
          color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
      };
      annotations[`mp_v_${t.id}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: val,
        borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
        label: { content: `P${pct.toFixed(1)}`, display: true, position: 'start',
          color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
          padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
      };
    });
  }

  _distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
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
            title: items => {
              const pt = refData[items[0]?.dataIndex];
              return pt ? `P${pt.x.toFixed(1)}` : '';
            },
            label: item => {
              const pt = refData[item.dataIndex];
              if (!pt) return '';
              return ` ${item.dataset.label}: ${_fmtVal(pt.y)} ${_distribUnit}`;
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
        },
      },
    },
  });
}
