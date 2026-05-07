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

  const normStr  = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const yAxisMode = $('#svpYAxis')?.value ?? 'renta';
  const fs        = parseInt($('#svpFontSize')?.value ?? '11');

  const supCol = state.columns.find(c =>
    c.type === 'number' && ['util (m', 'útil (m', 'metros util'].some(k => normStr(c.name).includes(normStr(k)))
  );
  const rentaCol = state.columns.find(c =>
    normStr(c.name).includes('renta uf') || normStr(c.name).includes('precio')
  );
  const ufm2Col = state.columns.find(c =>
    normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m')
  );
  const tipoCol = state.columns.find(c =>
    ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
  );
  const proyCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre'].some(k => normStr(c.name).includes(k))
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
    rows = rows.filter(r => tipoCol && String(r[tipoCol.name] ?? '') === tipoFilter);
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
          y: yAxisMode === 'ufm2' ? t.ufm2 : t.sup * t.ufm2,
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
  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  if (tipoCol && !tipoFilter) {
    const tipoGroups = {};
    for (const r of rows) {
      const sup = Number(r[supCol.name]);
      const yv  = Number(r[yCol.name]);
      if (isNaN(sup) || isNaN(yv) || sup <= 0 || yv <= 0) continue;
      const tipo = fmtTipo(r[tipoCol.name]) || '—';
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
      borderColor: '#dc2626',
      borderWidth: 1.5,
      borderDash: [8, 4],
      label: {
        content: avgLabel,
        display: true,
        position: 'start',
        color: '#dc2626',
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

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const rentaCol = state.columns.find(c => normStr(c.name).includes('renta uf') || normStr(c.name).includes('precio (uf'));
  const ufm2Col  = state.columns.find(c => normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m'));

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

  colSel.addEventListener('change', renderDistrib);

  if (!distribListenersReady) {
    distribListenersReady = true;

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

      const res  = await fetch(url);
      const blob = await res.blob();
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
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²' : 'UF';
  const fs   = parseInt($('#distribFontSize')?.value ?? '11');

  // Formato adaptativo: más decimales cuando los valores son pequeños
  const fmtVal = v => {
    if (v >= 100) return v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    if (v >= 10)  return v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
    return v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart')?.getContext('2d');
  if (!ctx) return;

  // Array ordenado para lookups exactos de percentil
  const sortedVals = state.filtered
    .map(r => Number(r[col]))
    .filter(v => !isNaN(v) && v > 0)
    .sort((a, b) => a - b);

  if (sortedVals.length < 2) return;

  // Valor exacto en el percentil pct (0-100)
  const valAtPct = pct => {
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const refData = computeQuantileCurve(state.filtered, col);
  const datasets = [{
    label: col,
    data: refData,
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56,189,248,0.10)',
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.55,
    fill: true,
  }];

  const annotations = {};
  const RED = '#ef4444';

  // ── Percentiles ────────────────────────────────────────────
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
    const price = lerpAtX(refData, pct);
    if (price == null || price === 0) return;
    const priceLabel = fmtVal(price);
    // Línea vertical: desde eje X hasta la curva
    annotations[`pv_${pct}`] = {
      type: 'line', xMin: pct, xMax: pct, yMax: price,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `P${pct}`, display: true, position: 'start',
        color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
    // Línea horizontal: desde eje Y hasta la curva
    annotations[`ph_${pct}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pct,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${priceLabel} ${distribUnit}`, display: true, position: 'start',
        color: RED, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' } },
    };
  });

  // ── Precios marcados ────────────────────────────────────────
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
    const pct = lerpAtY(refData, price);
    const pctForLabel = pct !== null ? pct : 100;
    annotations[`prh_${price}`] = {
      type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
      borderColor: RED, borderWidth: 1.5, borderDash: [6, 4],
      label: { content: `${fmtVal(price)} ${distribUnit}`, display: true, position: 'start',
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

  // ── Mi Proyecto ─────────────────────────────────────────────
  if (mp.inDistrib && mp.tipologias.length > 0) {
    const normFn  = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const nc      = normFn(col);
    const isUfm2   = nc.includes('uf/m') || nc.includes('uf / m');
    const isRenta  = !isUfm2 && (nc.includes('renta') || nc.includes('precio'));

    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => normFn(c.name).includes(k)));
    const fmtTipo = v => {
      const s = String(v ?? '').trim();
      return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
    };
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) mpTipos = mpTipos.filter(t => activeTipos.has(fmtTipo(t.nombre)));
    }

    const mpColor = '#1e3a5f';
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
        label: { content: `${t.nombre}: ${valLabel}`, display: true, position: 'start',
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

  distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: { padding: { top: 12, right: 20, bottom: 12, left: 12 } },
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
              return ` ${item.dataset.label}: ${fmtVal(pt.y)} ${distribUnit}`;
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