import { $, monthKeyToQuarter, quarterSortKey } from './utils.js';
import { state } from './data.js';
import { setFreshnessMin, getFreshnessMin } from './filters.js';

const COL = 'Última Actualización';

let _chart = null;
let _listenersReady = false;

function _hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!m) return `rgba(59,130,246,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const FRESH_COLOR = '#16a34a'; // proyectos que pasan el corte elegido
const STALE_COLOR = '#94a3b8'; // proyectos más viejos que el corte

export function renderActualizacion() {
  const canvas = $('#actualizacionChart');
  const wrap   = $('#actualizacionWrap');
  const empty  = $('#actualizacionEmpty');
  const sel    = $('#freshMinSelect');
  const hint   = $('#freshMinHint');
  if (!canvas) return;

  const hasCol = state.raw.some(r => COL in r && r[COL]);
  if (!hasCol) {
    if (empty) empty.style.display = '';
    if (wrap)  wrap.style.display  = 'none';
    if (sel)   sel.disabled = true;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap)  wrap.style.display  = '';
  if (sel)   sel.disabled = false;

  // Un punto por proyecto (Edificio), no por fila/tipología — todas las
  // filas de un mismo proyecto comparten el mismo período de origen.
  const byProj = new Map();
  for (const r of state.raw) {
    const proj = String(r['Edificio'] ?? '').trim();
    if (!proj || byProj.has(proj)) continue;
    const q = monthKeyToQuarter(r[COL]);
    if (q) byProj.set(proj, q);
  }

  const counts = new Map();
  for (const q of byProj.values()) counts.set(q, (counts.get(q) ?? 0) + 1);
  const quarters = [...counts.keys()].sort((a, b) => quarterSortKey(a) - quarterSortKey(b));

  if (!quarters.length) {
    if (empty) { empty.style.display = ''; empty.textContent = 'No hay datos de última actualización para los proyectos cargados.'; }
    if (wrap) wrap.style.display = 'none';
    return;
  }

  // ── Selector de corte ──────────────────────────────────────────────────
  const freshMin = getFreshnessMin();
  if (sel) {
    sel.innerHTML = '<option value="">Sin filtro</option>' +
      quarters.map(q => `<option value="${q}">${q} en adelante</option>`).join('');
    sel.value = quarters.includes(freshMin) ? freshMin : '';
  }
  if (hint) {
    const total = byProj.size;
    const pasan = freshMin
      ? [...byProj.values()].filter(q => quarterSortKey(q) >= quarterSortKey(freshMin)).length
      : total;
    hint.textContent = freshMin
      ? `${pasan} de ${total} proyectos actualizados desde ${freshMin}`
      : `${total} proyectos en total`;
  }

  if (!_listenersReady && sel) {
    _listenersReady = true;
    sel.addEventListener('change', () => setFreshnessMin(sel.value || null));
  }

  // ── Gráfico de barras ────────────────────────────────────────────────────
  if (_chart) { _chart.destroy(); _chart = null; }
  const ctx = canvas.getContext('2d');
  const data = quarters.map(q => counts.get(q));
  const isFresh = q => !freshMin || quarterSortKey(q) >= quarterSortKey(freshMin);

  _chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: quarters,
      datasets: [{
        label: 'Proyectos',
        data,
        backgroundColor: quarters.map(q => _hexToRgba(isFresh(q) ? FRESH_COLOR : STALE_COLOR, 0.55)),
        borderColor:     quarters.map(q => _hexToRgba(isFresh(q) ? FRESH_COLOR : STALE_COLOR, 0.9)),
        borderWidth: 1,
        borderRadius: 2,
        barPercentage: 0.9,
        categoryPercentage: 0.9,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24, right: 16, bottom: 8, left: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label}`,
            label: item => ` ${item.parsed.y} proyecto${item.parsed.y === 1 ? '' : 's'} actualizados ese trimestre`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Trimestre de última actualización' },
          ticks: { maxRotation: 45 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Proyectos' },
          ticks: { precision: 0 },
        },
      },
    },
    plugins: [{
      id: 'freshBarCounts',
      afterDatasetsDraw(chart) {
        const { ctx: c } = chart;
        const meta = chart.getDatasetMeta(0);
        c.save();
        c.font = 'bold 11px system-ui, sans-serif';
        c.fillStyle = '#334155';
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        meta.data.forEach((bar, i) => {
          const val = data[i];
          if (val == null) return;
          c.fillText(String(val), bar.x, bar.y - 3);
        });
        c.restore();
      },
    }],
  });
}
