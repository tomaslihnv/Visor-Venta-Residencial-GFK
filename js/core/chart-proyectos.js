import { norm } from './utils.js';

// metricDefs: array of { id, label, col, agg, fmt }
// agg: 'avg' | 'sum' | 'count'
// fmt: function(value) => string
//
// options: { canvasId, selectId, exportBtnId, projectCandidates }

const palette = ['#1e3a5f','#2563eb','#7c3aed','#db2777','#d97706','#059669','#0891b2','#65a30d'];

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

  document.getElementById(exportBtnId)?.addEventListener('click', () => {
    if (!_proyChart) return;
    const a = document.createElement('a');
    a.href = _proyChart.toBase64Image('image/png', 1);
    a.download = `proyectos_${Date.now()}.png`;
    a.click();
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

  _proyChart = new Chart(ctx, {
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
