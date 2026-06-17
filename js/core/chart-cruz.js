import { norm } from './utils.js';
import { copyChartPng } from './export.js';

// cruzConfig: {
//   xCandidates, xLabel, yCandidates, yLabel,
//   colorCandidates, colorLabel,   — operador (color)
//   shapeCandidates, shapeLabel,   — tipología (forma)
//   sizeCandidates,                — ocupación % (tamaño)
//   reportaCandidates,             — binario reporta/no reporta (borde punteado)
//   projCandidates,
// }

const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7'];
const SHAPES  = ['circle', 'triangle', 'rect', 'rectRot', 'star', 'cross'];
const MIN_R = 4, MAX_R = 13;

let _cruzReady = false;

export function initCruzListeners(state, cruzConfig, mp) {
  if (_cruzReady) return;
  _cruzReady = true;

  const fontSlider = document.getElementById('cruzFontSize');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const val = document.getElementById('cruzFontSizeVal');
      if (val) val.textContent = fontSlider.value + 'px';
      renderCruz(state, cruzConfig, mp);
    });
  }

  document.querySelectorAll('.cruz-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cruz-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('cruzExportPngBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('cruzExportPngBtn');
    const ok  = await copyChartPng(state.cruzChart, document.getElementById('cruzWrap'), '.cruz-ratio-btn');
    if (ok && btn) {
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!'; btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    }
  });
}

function _parseBool(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (['si', 'sí', 's', 'yes', 'y', 'true', '1', 'reporta'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'no reporta'].includes(s)) return false;
  return null;
}

function _parsePct(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim();
  if (s.endsWith('%')) s = s.slice(0, -1);
  const n = Number(s);
  if (isNaN(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function _median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function _renderShapeLegend(shapeMap, shapeLabel) {
  const cont = document.getElementById('cruzShapeLegend');
  if (!cont) return;
  const entries = Object.entries(shapeMap);
  if (!entries.length) { cont.innerHTML = ''; return; }
  const glyphs = { circle: '●', triangle: '▲', rect: '■', rectRot: '◆', star: '★', cross: '✚' };
  cont.innerHTML = `<span class="cruz-legend-title">${shapeLabel}:</span>` +
    entries.map(([k, shape]) => `<span class="cruz-legend-item">${glyphs[shape] ?? '●'} ${k}</span>`).join('');
}

export function renderCruz(state, cruzConfig, mp) {
  if (!state.filtered.length) return;

  const fs = parseInt(document.getElementById('cruzFontSize')?.value ?? '11');

  const xCol = state.columns.find(c =>
    c.type === 'number' && cruzConfig.xCandidates.some(k => norm(c.name).includes(norm(k))));
  const yCol = state.columns.find(c =>
    c.type === 'number' && cruzConfig.yCandidates.some(k => norm(c.name).includes(norm(k))));
  const colorCol = state.columns.find(c =>
    cruzConfig.colorCandidates.some(k => norm(c.name).includes(norm(k))));
  const shapeCol = state.columns.find(c =>
    cruzConfig.shapeCandidates.some(k => norm(c.name).includes(norm(k))));
  const sizeCol = state.columns.find(c =>
    cruzConfig.sizeCandidates.some(k => norm(c.name).includes(norm(k))));
  const reportaCol = state.columns.find(c =>
    cruzConfig.reportaCandidates.some(k => norm(c.name).includes(norm(k))));
  const projCol = state.columns.find(c =>
    (cruzConfig.projCandidates ?? ['proyecto', 'edificio', 'nombre']).some(k => norm(c.name).includes(norm(k))));

  if (!xCol || !yCol) return;

  if (state.cruzChart) { state.cruzChart.destroy(); state.cruzChart = null; }
  const ctx = document.getElementById('cruzChart')?.getContext('2d');
  if (!ctx) return;

  const shapeMap = {};
  const colorMap = {};
  let shapeIdx = 0, colorIdx = 0;

  const getShape = v => {
    const key = String(v ?? '—');
    if (!(key in shapeMap)) shapeMap[key] = SHAPES[shapeIdx++ % SHAPES.length];
    return shapeMap[key];
  };
  const getColor = v => {
    const key = String(v ?? '—');
    if (!(key in colorMap)) colorMap[key] = palette[colorIdx++ % palette.length];
    return colorMap[key];
  };
  const getRadius = occ => {
    if (occ == null || isNaN(occ)) return (MIN_R + MAX_R) / 2;
    const pct = Math.max(0, Math.min(100, occ));
    return MIN_R + (MAX_R - MIN_R) * Math.sqrt(pct / 100);
  };

  const groups = {};
  const xs = [], ys = [];

  for (const r of state.filtered) {
    const xv = Number(r[xCol.name]), yv = Number(r[yCol.name]);
    if (isNaN(xv) || isNaN(yv) || xv <= 0 || yv <= 0) continue;
    xs.push(xv); ys.push(yv);

    const opKey   = colorCol ? String(r[colorCol.name] ?? '—') : '—';
    const tipoKey = shapeCol ? String(r[shapeCol.name] ?? '—') : '—';
    const occ     = sizeCol ? _parsePct(r[sizeCol.name]) : null;
    const reporta = reportaCol ? _parseBool(r[reportaCol.name]) : null;
    const proj    = projCol ? String(r[projCol.name] ?? '—') : '—';

    if (!groups[opKey]) groups[opKey] = { color: getColor(opKey), data: [] };
    groups[opKey].data.push({
      x: xv, y: yv, label: proj, tipo: tipoKey, occ, reporta,
      pointStyle: getShape(tipoKey),
      r: getRadius(occ),
    });
  }

  if (!xs.length) return;
  const medianX = _median(xs), medianY = _median(ys);

  const datasets = Object.entries(groups).map(([op, g]) => ({
    label: op,
    data: g.data,
    backgroundColor: g.color + 'CC',
    borderColor: g.color,
    borderWidth: 1.5,
    pointStyle: g.data.map(p => p.pointStyle),
    pointRadius: g.data.map(p => p.r),
    pointHoverRadius: g.data.map(p => p.r + 2),
  }));

  const ANN_COLOR = '#6b7280';
  const xFmt = v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  const yFmt = v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Centrar la mediana en el medio del gráfico: el rango de cada eje se
  // expande simétricamente alrededor de la mediana según el punto más lejano.
  const xHalfSpan = Math.max(...xs.map(v => Math.abs(v - medianX))) * 1.08 || 1;
  const yHalfSpan = Math.max(...ys.map(v => Math.abs(v - medianY))) * 1.08 || 1;
  const xAxisMin = medianX - xHalfSpan, xAxisMax = medianX + xHalfSpan;
  const yAxisMin = medianY - yHalfSpan, yAxisMax = medianY + yHalfSpan;

  const annotations = {
    medianX: {
      type: 'line', scaleID: 'x', value: medianX,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: {
        content: `Mediana ${cruzConfig.xLabel}: ${xFmt(medianX)}`, display: true, position: 'end',
        color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
        font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 },
      },
    },
    medianY: {
      type: 'line', scaleID: 'y', value: medianY,
      borderColor: ANN_COLOR, borderWidth: 1.5, borderDash: [6, 4],
      label: {
        content: `Mediana ${cruzConfig.yLabel}: ${yFmt(medianY)}`, display: true, position: 'end',
        color: ANN_COLOR, backgroundColor: 'rgba(255,255,255,0.9)',
        font: { size: fs, weight: 'bold' }, padding: { x: 4, y: 2 },
      },
    },
  };

  const reportRingPlugin = {
    id: 'cruzReportRing',
    afterDatasetsDraw(chart) {
      const { ctx: c } = chart;
      chart.data.datasets.forEach((ds, dsIndex) => {
        const meta = chart.getDatasetMeta(dsIndex);
        ds.data.forEach((pt, i) => {
          if (pt.reporta !== false) return;
          const el = meta.data[i];
          if (!el) return;
          const { x, y } = el.getProps(['x', 'y'], true);
          const r = (pt.r ?? 6) + 3;
          c.save();
          c.setLineDash([4, 3]);
          c.lineWidth = 1.5;
          c.strokeStyle = ds.borderColor ?? '#374151';
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.stroke();
          c.restore();
        });
      });
    },
  };

  state.cruzChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    plugins: [reportRingPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          callbacks: {
            label: item => {
              const d = item.raw;
              const parts = [`${d.label}`];
              if (d.tipo) parts.push(d.tipo);
              parts.push(`${xFmt(d.x)} ${cruzConfig.xLabel}`);
              parts.push(`${yFmt(d.y)} ${cruzConfig.yLabel}`);
              if (d.occ != null) parts.push(`Ocupación: ${d.occ.toFixed(0)}%`);
              if (d.reporta != null) parts.push(d.reporta ? 'Reporta' : 'No reporta');
              return parts.join(' · ');
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          min: xAxisMin, max: xAxisMax,
          title: { display: true, text: cruzConfig.xLabel, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          min: yAxisMin, max: yAxisMax,
          title: { display: true, text: cruzConfig.yLabel, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });

  _renderShapeLegend(shapeMap, cruzConfig.shapeLabel ?? 'Tipología');
}
