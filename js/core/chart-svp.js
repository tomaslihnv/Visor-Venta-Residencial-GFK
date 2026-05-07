import { norm } from './utils.js';
import { copyChartPng } from './export.js';

// svpConfig: {
//   xCandidates:   string[]   — candidates for X axis column (e.g. m² útil)
//   xLabel:        string
//   yOptions:      [{ value, label, candidates }]  — Y axis options
//   groupCandidates?: string[]  — candidates for tipología/group column (optional)
//   projCandidates?:  string[]
// }

const palette = ['#1e3a5f','#2563eb','#7c3aed','#db2777','#d97706','#059669','#0891b2','#65a30d'];

let _svpReady  = false;
export const svpMarkers = new Set();

export function initSvpListeners(state, svpConfig, mp) {
  if (_svpReady) return;
  _svpReady = true;

  document.getElementById('svpTipoFilter')?.addEventListener('change', () => renderSvp(state, svpConfig, mp));
  document.getElementById('svpYAxis')?.addEventListener('change',      () => renderSvp(state, svpConfig, mp));
  document.getElementById('svpTrendToggle')?.addEventListener('change',() => renderSvp(state, svpConfig, mp));
  document.getElementById('svpAvgToggle')?.addEventListener('change',  () => renderSvp(state, svpConfig, mp));

  const addM2 = () => {
    const v = parseFloat(document.getElementById('svpM2Input')?.value ?? '');
    if (isNaN(v) || v <= 0) return;
    svpMarkers.add(v);
    document.getElementById('svpM2Input').value = '';
    _refreshSvpMarkerTags(state, svpConfig, mp);
    renderSvp(state, svpConfig, mp);
  };
  document.getElementById('svpAddM2')?.addEventListener('click', addM2);
  document.getElementById('svpM2Input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addM2(); });

  const fontSlider = document.getElementById('svpFontSize');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const val = document.getElementById('svpFontSizeVal');
      if (val) val.textContent = fontSlider.value + 'px';
      renderSvp(state, svpConfig, mp);
    });
  }

  document.querySelectorAll('.svp-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.svp-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('svpExportPngBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('svpExportPngBtn');
    const ok  = await copyChartPng(state.chart, document.getElementById('svpWrap'), '.svp-ratio-btn');
    if (ok && btn) {
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!'; btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    }
  });
}

export function populateSvpSelectors(state, svpConfig) {
  const tipoSel = document.getElementById('svpTipoFilter');
  if (!tipoSel) return;
  tipoSel.innerHTML = '<option value="">Todas</option>';

  if (svpConfig.groupCandidates?.length) {
    const tipoCol = state.columns.find(c => svpConfig.groupCandidates.some(k => norm(c.name).includes(norm(k))));
    if (tipoCol) {
      const tipos = [...new Set(state.raw.map(r => r[tipoCol.name]).filter(Boolean))].sort();
      for (const t of tipos) {
        const o = document.createElement('option');
        o.value = t; o.textContent = t;
        tipoSel.appendChild(o);
      }
    }
  }

  // Populate Y axis selector
  const yAxisSel = document.getElementById('svpYAxis');
  if (yAxisSel && svpConfig.yOptions?.length) {
    yAxisSel.innerHTML = '';
    for (const opt of svpConfig.yOptions) {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      yAxisSel.appendChild(o);
    }
  }
}

function _refreshSvpMarkerTags(state, svpConfig, mp) {
  const cont = document.getElementById('svpM2Tags');
  if (!cont) return;
  cont.innerHTML = '';
  [...svpMarkers].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag pct-tag';
    tag.innerHTML = `${v.toLocaleString('es-CL')} m² <button class="rm-svp-m2">×</button>`;
    tag.querySelector('.rm-svp-m2').addEventListener('click', () => {
      svpMarkers.delete(v);
      _refreshSvpMarkerTags(state, svpConfig, mp);
      renderSvp(state, svpConfig, mp);
    });
    cont.appendChild(tag);
  });
}

function _linearRegression(pts) {
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

export function renderSvp(state, svpConfig, mp) {
  if (!state.filtered.length) return;

  const yAxisMode = document.getElementById('svpYAxis')?.value ?? svpConfig.yOptions[0]?.value;
  const fs        = parseInt(document.getElementById('svpFontSize')?.value ?? '11');

  const yOpt = svpConfig.yOptions?.find(o => o.value === yAxisMode) ?? svpConfig.yOptions?.[0];
  if (!yOpt) return;

  const xCol = state.columns.find(c =>
    c.type === 'number' && svpConfig.xCandidates.some(k => norm(c.name).includes(norm(k)))
  );
  const yCol = state.columns.find(c =>
    yOpt.candidates.some(k => norm(c.name).includes(norm(k)))
  );
  const groupCol = svpConfig.groupCandidates?.length
    ? state.columns.find(c => svpConfig.groupCandidates.some(k => norm(c.name).includes(norm(k))))
    : null;
  const projCol = state.columns.find(c =>
    (svpConfig.projCandidates ?? ['proyecto','edificio','nombre']).some(k => norm(c.name).includes(norm(k)))
  );

  if (!xCol || !yCol) return;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = document.getElementById('svpChart')?.getContext('2d');
  if (!ctx) return;

  const tipoFilter = document.getElementById('svpTipoFilter')?.value ?? '';
  let rows = state.filtered;
  if (tipoFilter && groupCol) {
    rows = rows.filter(r => String(r[groupCol.name] ?? '') === tipoFilter);
  }

  // Mi Proyecto dataset
  const mpDatasets = [];
  if (mp?.inSvp && mp.tipologias?.length > 0) {
    const mpColor = '#1e293b';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.ufm2 != null);
    const mpFiltered = tipoFilter
      ? mpTipos.filter(t => String(t.nombre).toUpperCase() === tipoFilter.toUpperCase())
      : mpTipos;
    if (mpFiltered.length > 0) {
      const getMpY = svpConfig.getMpY ?? ((t, mode) => mode === 'ufm2' ? t.ufm2 : t.sup * t.ufm2);
      mpDatasets.push({
        label: mp.proyecto || 'Mi Proyecto',
        data: mpFiltered.map(t => ({
          x: t.sup,
          y: getMpY(t, yAxisMode),
          label: `${mp.proyecto || 'Mi Proyecto'} ${t.nombre}`,
        })),
        backgroundColor: mpColor, borderColor: mpColor,
        borderWidth: 2, pointRadius: 7, pointHoverRadius: 9,
      });
    }
  }

  // Comparable datasets
  const compDatasets = [];
  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  if (groupCol && !tipoFilter) {
    const groups = {};
    for (const r of rows) {
      const xv = Number(r[xCol.name]), yv = Number(r[yCol.name]);
      if (isNaN(xv) || isNaN(yv) || xv <= 0 || yv <= 0) continue;
      const g = fmtTipo(r[groupCol.name]) || '—';
      const p = projCol ? String(r[projCol.name] ?? '—') : '—';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ x: xv, y: yv, label: p });
    }
    Object.keys(groups).sort().forEach((g, i) => {
      const hex = palette[i % palette.length];
      compDatasets.push({
        label: `Comparables ${g}`,
        data: groups[g],
        backgroundColor: hex + 'AA', borderColor: hex,
        borderWidth: 1, pointRadius: 5, pointHoverRadius: 7,
      });
    });
  } else {
    const pts = [];
    for (const r of rows) {
      const xv = Number(r[xCol.name]), yv = Number(r[yCol.name]);
      if (isNaN(xv) || isNaN(yv) || xv <= 0 || yv <= 0) continue;
      pts.push({ x: xv, y: yv, label: projCol ? String(r[projCol.name] ?? '—') : '—' });
    }
    compDatasets.push({
      label: tipoFilter ? `Comparables ${fmtTipo(tipoFilter)}` : 'Comparables',
      data: pts,
      backgroundColor: palette[0] + 'AA', borderColor: palette[0],
      borderWidth: 1, pointRadius: 5, pointHoverRadius: 7,
    });
  }

  const datasets      = [...mpDatasets, ...compDatasets];
  const allCompPts    = compDatasets.flatMap(ds => ds.data);
  const annotations   = {};
  const MARKER_COLOR  = '#ef4444';

  // Average line
  const showAvg = document.getElementById('svpAvgToggle')?.checked ?? false;
  if (showAvg && allCompPts.length > 0) {
    const avgY = allCompPts.reduce((s, p) => s + p.y, 0) / allCompPts.length;
    const avgLabel = yOpt.formatAvg
      ? yOpt.formatAvg(avgY)
      : `Prom.: ${avgY.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${yOpt.label}`;
    annotations.avgLine = {
      type: 'line', scaleID: 'y', value: avgY,
      borderColor: '#dc2626', borderWidth: 1.5, borderDash: [8, 4],
      label: { content: avgLabel, display: true, position: 'start',
        color: '#dc2626', backgroundColor: 'rgba(255,255,255,0.92)',
        font: { size: fs, weight: 'bold' }, padding: { x: 6, y: 3 } },
    };
  }

  // Trend line
  let reg = null;
  const showTrend = document.getElementById('svpTrendToggle')?.checked ?? true;
  if (showTrend && allCompPts.length >= 3) {
    reg = _linearRegression(allCompPts);
    if (reg) {
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      datasets.push({
        label: `Tendencia (R² = ${reg.r2.toFixed(2)})`,
        data: [{ x: xMin, y: reg.m * xMin + reg.b }, { x: xMax, y: reg.m * xMax + reg.b }],
        showLine: true, borderColor: 'rgba(30,58,95,0.75)', backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [7, 4], pointRadius: 0, fill: false, order: 0,
      });
    }
  }

  // m² markers
  const yFmtFn = yOpt.formatValue ?? (v => `${v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${yOpt.label}`);
  [...svpMarkers].sort((a, b) => a - b).forEach(m2 => {
    if (reg) {
      const trendY = reg.m * m2 + reg.b;
      annotations[`sv_${m2}`] = {
        type: 'line', xMin: m2, xMax: m2, yMax: trendY,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `${m2.toLocaleString('es-CL')} m²`, display: true, position: 'start',
          color: MARKER_COLOR, backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 }, xAdjust: 4 },
      };
      annotations[`sh_${m2}`] = {
        type: 'line', yMin: trendY, yMax: trendY, xMax: m2,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: yFmtFn(trendY), display: true, position: 'start',
          color: MARKER_COLOR, backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 }, yAdjust: -10 },
      };
    } else {
      annotations[`sv_${m2}`] = {
        type: 'line', scaleID: 'x', value: m2,
        borderColor: MARKER_COLOR, borderWidth: 1.5, borderDash: [6, 4],
        label: { content: `${m2.toLocaleString('es-CL')} m²`, display: true, position: 'start',
          color: MARKER_COLOR, backgroundColor: 'rgba(255,255,255,0.92)',
          font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 }, xAdjust: 4 },
      };
    }
  });

  const r2Plugin = {
    id: 'svpR2',
    afterDraw(chart) {
      if (!reg) return;
      const { ctx: c, chartArea: { right, top } } = chart;
      const text = `R² = ${reg.r2.toFixed(3)}`;
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      c.textAlign = 'right'; c.textBaseline = 'middle';
      const w = c.measureText(text).width;
      const pad = 6, h = 22, rx = right - w - pad * 2 - 2, ry = top + 6;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(rx, ry, w + pad * 2, h);
      c.strokeStyle = '#cbd5e1'; c.lineWidth = 1;
      c.strokeRect(rx, ry, w + pad * 2, h);
      c.fillStyle = '#1e3a5f';
      c.fillText(text, right - pad, ry + h / 2);
      c.restore();
    },
  };

  const yTooltip = yOpt.formatTooltip ?? (v => yFmtFn(v));

  state.chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    plugins: [r2Plugin],
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
              return `${name}${Number(d.x).toLocaleString('es-CL')} ${svpConfig.xLabel ?? 'm²'} · ${yTooltip(d.y)}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          title: { display: true, text: svpConfig.xLabel ?? 'm²', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: yOpt.label, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });
}
