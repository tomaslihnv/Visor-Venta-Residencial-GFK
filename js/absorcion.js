import { $ } from './utils.js';
import { state } from './data.js';

// Misma transformación aplicada a 'Tipología' en api.js (flattenEntities) —
// necesaria para poder cruzar los programas crudos de state.rawEntities
// contra las filas ya normalizadas en state.filtered.
function _tipoFromPrograma(programa) {
  return String(programa ?? '').replace(/^(\d+D)\d+B$/i, '$1');
}

let _chart = null;
let _tipoFilt = new Set(); // vacío = TODOS

function _hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!m) return `rgba(59,130,246,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const BAR_COLOR  = '#3b82f6';
const LINE_COLOR = '#16a34a';

function _renderChips(tipologias) {
  const cont = $('#absorcionChips');
  if (!cont) return;

  const todosChip = `<button class="prog-chip active" data-tipo="__todos__" style="background:#1e3a5f;color:#fff;">TODOS</button>`;
  const tipoChips = tipologias.map(t =>
    `<button class="prog-chip" data-tipo="${t}">${t}</button>`
  ).join('');
  cont.innerHTML = todosChip + tipoChips;

  const paint = (btn, active) => {
    btn.classList.toggle('active', active);
    btn.style.background = active ? '#1e3a5f' : '';
    btn.style.color      = active ? '#fff'    : '';
  };

  cont.querySelectorAll('.prog-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.tipo;
      if (tipo === '__todos__') {
        _tipoFilt.clear();
        cont.querySelectorAll('.prog-chip').forEach(b => paint(b, b.dataset.tipo === '__todos__'));
      } else {
        _tipoFilt.has(tipo) ? _tipoFilt.delete(tipo) : _tipoFilt.add(tipo);
        paint(btn, _tipoFilt.has(tipo));
        const todosBtn = cont.querySelector('[data-tipo="__todos__"]');
        if (todosBtn) paint(todosBtn, _tipoFilt.size === 0);
      }
      _renderChart(tipologias);
    });
  });
}

function _renderChart(tipologias) {
  const canvas = $('#absorcionChart');
  if (!canvas) return;

  // Solo se consideran (Edificio, Tipología) que sobreviven a los filtros
  // activos del sidebar — así el gráfico refleja el mismo "mercado
  // comparable" que el resto del visor, no todo lo que trae la API.
  const allowedPairs = new Set(state.filtered.map(r => `${r['Edificio']}::${r['Tipología']}`));

  const periodTotals = new Map(); // key -> suma netSales del mes
  const periodLabels = new Map(); // key -> label legible

  for (const entity of state.rawEntities) {
    for (const period of (entity.periods ?? [])) {
      if (!periodLabels.has(period.key)) periodLabels.set(period.key, period.label ?? period.key);
      for (const stage of (period.stages ?? [])) {
        for (const prog of (stage.programs ?? [])) {
          const tipo = _tipoFromPrograma(prog.program);
          const pairKey = `${entity.name}::${tipo}`;
          if (!allowedPairs.has(pairKey)) continue;
          if (_tipoFilt.size && !_tipoFilt.has(tipo)) continue;
          periodTotals.set(period.key, (periodTotals.get(period.key) ?? 0) + (Number(prog.netSales) || 0));
        }
      }
    }
  }

  const keys = [...periodTotals.keys()].sort();
  const labels = keys.map(k => periodLabels.get(k) ?? k);
  const monthly = keys.map(k => periodTotals.get(k));
  let running = 0;
  const cumulative = monthly.map(v => (running += v));

  if (_chart) { _chart.destroy(); _chart = null; }
  const ctx = canvas.getContext('2d');

  _chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Ventas netas mensuales',
          data: monthly,
          backgroundColor: _hexToRgba(BAR_COLOR, 0.55),
          borderColor: _hexToRgba(BAR_COLOR, 0.9),
          borderWidth: 1,
          borderRadius: 2,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: 'Unidades vendidas (acumulado)',
          data: cumulative,
          borderColor: LINE_COLOR,
          backgroundColor: LINE_COLOR,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          yAxisID: 'y1',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16, right: 16, bottom: 8, left: 8 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Mes' },
          ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 24 },
          grid: { display: false },
        },
        y: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'Ventas netas del mes' },
          ticks: { precision: 0 },
        },
        y1: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Acumulado vendido' },
          grid: { drawOnChartArea: false },
          ticks: { precision: 0 },
        },
      },
    },
  });
}

export function renderAbsorcion() {
  const wrap  = $('#absorcionWrap');
  const empty = $('#absorcionEmpty');
  const chips = $('#absorcionChips');
  if (!wrap) return;

  if (!state.rawEntities.length) {
    if (empty) empty.style.display = '';
    if (wrap)  wrap.style.display  = 'none';
    if (chips) chips.innerHTML     = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap)  wrap.style.display  = '';

  const tipologias = [...new Set(state.filtered.map(r => r['Tipología']).filter(Boolean))]
    .sort((a, b) => {
      const na = parseInt(String(a)), nb = parseInt(String(b));
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b), 'es');
    });

  // Descarta selecciones de tipologías que ya no existen en el subconjunto filtrado
  for (const t of [..._tipoFilt]) if (!tipologias.includes(t)) _tipoFilt.delete(t);

  _renderChips(tipologias);
  _renderChart(tipologias);
}
