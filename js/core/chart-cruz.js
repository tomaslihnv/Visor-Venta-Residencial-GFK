import { norm } from './utils.js';
import { copyChartPng } from './export.js';

// cruzConfig: {
//   xCandidates, xLabel, yCandidates, yLabel,
//   colorCandidates, colorLabel,   — operador (color)
//   shapeCandidates,               — tipología (solo filtro/tooltip, sin encoding visual)
//   reportaCandidates,             — binario reporta/no reporta (borde punteado)
//   stockCandidates, dispoCandidates, — para agrupar tipologías por proyecto
//   projCandidates,
// }
// Los filtros (comuna, ocupación, tipología, reporte) se resuelven con los
// filtros existentes de la barra lateral — este módulo no agrega selectores propios.

const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7'];
const POINT_R = 8;

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

  document.getElementById('cruzGroupToggle')?.addEventListener('change', () => renderCruz(state, cruzConfig, mp));

  document.getElementById('cruzExportPngBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('cruzExportPngBtn');
    const ok  = await copyChartPng(state.cruzChart, document.getElementById('cruzWrap'), '.cruz-ratio-btn');
    if (ok && btn) {
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!'; btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    }
  });

  _initCruzFilterWidget(state);
}

function _initCruzFilterWidget(state) {
  const toggleBtn = document.getElementById('cruzFilterWidgetBtn');
  const container = document.getElementById('cruzWrap');
  if (!toggleBtn || !container) return;

  const widget = document.createElement('div');
  widget.id = 'cruzFilterWidget';
  widget.className = 'map-filter-widget hidden';
  widget.innerHTML = `
    <div class="mfw-header" id="cruzFwHeader">
      <span>Filtros activos</span>
      <button class="mfw-close" id="cruzFwClose">&#xD7;</button>
    </div>
    <div class="mfw-body" id="cruzFwBody"></div>
  `;
  container.appendChild(widget);

  document.getElementById('cruzFwHeader').addEventListener('mousedown', e => {
    if (e.target.id === 'cruzFwClose') return;
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

  document.getElementById('cruzFwClose').addEventListener('click', () => {
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
      _updateCruzFilterWidget(state);
    }
  });
}

export function updateCruzFilterWidget(state) { _updateCruzFilterWidget(state); }

function _updateCruzFilterWidget(state) {
  const body = document.getElementById('cruzFwBody');
  if (!body) return;
  const widget = document.getElementById('cruzFilterWidget');
  if (!widget || widget.classList.contains('hidden')) return;
  const defs = state?._filterDefs ?? [];
  const items = [];
  for (const def of defs) {
    if (def.type === 'multi') {
      const set = state?.filterValues?.[def.key];
      if (set?.size > 0) items.push({ label: def.label, value: [...set].join(', ') });
    } else if (def.type === 'slider') {
      const min = state?.filterValues?.[def.key + 'Min'];
      const max = state?.filterValues?.[def.key + 'Max'];
      if (min !== null || max !== null) {
        const ref = state?.filterRefs?.[def.key];
        const lo = min !== null ? (ref?.iMin?.value ?? min) : '—';
        const hi = max !== null ? (ref?.iMax?.value ?? max) : '—';
        items.push({ label: def.label, value: `${lo} – ${hi}` });
      }
    }
  }
  body.innerHTML = items.length
    ? items.map(it => `<div class="mfw-row"><span class="mfw-label">${it.label}</span><span class="mfw-value">${it.value}</span></div>`).join('')
    : '<div class="mfw-empty">Sin filtros aplicados</div>';
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

function _median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Agrupa filas por (proyecto + tipología): promedia m² y UF/m².
function _aggregateByTipologia(entries) {
  const groups = {};
  for (const e of entries) {
    const key = `${e.label}__${e.tipo}`;
    if (!groups[key]) {
      groups[key] = { label: e.label, tipo: e.tipo, opKey: e.opKey, xs: [], ys: [], anyNoReporta: false, count: 0 };
    }
    const g = groups[key];
    g.xs.push(e.x); g.ys.push(e.y); g.count++;
    if (e.reporta === false) g.anyNoReporta = true;
  }
  return Object.values(groups).map(g => ({
    x: g.xs.reduce((a, b) => a + b, 0) / g.xs.length,
    y: g.ys.reduce((a, b) => a + b, 0) / g.ys.length,
    label: g.label, tipo: g.tipo, opKey: g.opKey,
    reporta: !g.anyNoReporta, count: g.count,
  }));
}

function _renderLegend(colorMap, colorLabel, hasReportaCol) {
  const cont = document.getElementById('cruzShapeLegend');
  if (!cont) return;
  const entries = Object.entries(colorMap);
  let html = '';
  if (entries.length) {
    html += `<span class="cruz-legend-title">${colorLabel}</span>` +
      entries.map(([k, color]) => `<span class="cruz-legend-item"><span class="cruz-legend-swatch" style="background:${color}"></span>${k}</span>`).join('');
  }
  if (hasReportaCol) {
    html += `
      <span class="cruz-legend-title cruz-legend-sep">Reporte</span>
      <span class="cruz-legend-item"><span class="cruz-legend-ring cruz-legend-ring-solid"></span> Reporta</span>
      <span class="cruz-legend-item"><span class="cruz-legend-ring cruz-legend-ring-dashed"></span> No reporta</span>`;
  }
  cont.innerHTML = html;
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
  const reportaCol = state.columns.find(c =>
    cruzConfig.reportaCandidates.some(k => norm(c.name).includes(norm(k))));
  const projCol = state.columns.find(c =>
    (cruzConfig.projCandidates ?? ['proyecto', 'edificio', 'nombre']).some(k => norm(c.name).includes(norm(k))));

  if (!xCol || !yCol) return;

  if (state.cruzChart) { state.cruzChart.destroy(); state.cruzChart = null; }
  const ctx = document.getElementById('cruzChart')?.getContext('2d');
  if (!ctx) return;

  const colorMap = {};
  let colorIdx = 0;
  const getColor = v => {
    const key = String(v ?? '—');
    if (!(key in colorMap)) colorMap[key] = palette[colorIdx++ % palette.length];
    return colorMap[key];
  };

  const entries = [];
  for (const r of state.filtered) {
    const xv = Number(r[xCol.name]), yv = Number(r[yCol.name]);
    if (isNaN(xv) || isNaN(yv) || xv <= 0 || yv <= 0) continue;

    const opKey   = colorCol ? String(r[colorCol.name] ?? '—') : '—';
    const tipoKey = shapeCol ? String(r[shapeCol.name] ?? '—') : '—';
    const reporta = reportaCol ? _parseBool(r[reportaCol.name]) : null;
    const proj    = projCol ? String(r[projCol.name] ?? '—') : '—';

    entries.push({ x: xv, y: yv, label: proj, tipo: tipoKey, opKey, reporta });
  }

  if (!entries.length) return;

  const grouped = document.getElementById('cruzGroupToggle')?.checked ?? false;
  const points  = grouped ? _aggregateByTipologia(entries) : entries;

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const medianX = _median(xs), medianY = _median(ys);

  const groups = {};
  for (const p of points) {
    if (!groups[p.opKey]) groups[p.opKey] = { color: getColor(p.opKey), data: [] };
    groups[p.opKey].data.push({
      x: p.x, y: p.y, label: p.label, tipo: p.tipo, reporta: p.reporta, count: p.count,
    });
  }

  const datasets = Object.entries(groups).map(([op, g]) => ({
    label: op,
    data: g.data,
    backgroundColor: g.color + 'CC',
    borderColor: g.color,
    borderWidth: 1.5,
    pointRadius: POINT_R,
    pointHoverRadius: POINT_R + 2,
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

  // Anillo punteado superpuesto para las unidades que no reportan.
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
          c.save();
          c.setLineDash([4, 3]);
          c.lineWidth = 1.5;
          c.strokeStyle = ds.borderColor ?? '#374151';
          c.beginPath();
          c.arc(x, y, POINT_R + 3, 0, Math.PI * 2);
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
              if (d.reporta != null) parts.push(d.reporta ? 'Reporta' : 'No reporta');
              if (d.count > 1) parts.push(`${d.count} unidades`);
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

  _renderLegend(colorMap, cruzConfig.colorLabel ?? 'Operador', !!reportaCol);
  _updateCruzFilterWidget(state);
}
