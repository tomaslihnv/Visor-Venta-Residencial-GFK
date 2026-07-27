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

const BAR_COLOR   = '#3b82f6';
const LINE_COLOR  = '#16a34a';
const PRICE_COLOR = '#f59e0b';

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

  const availableTotals = new Map(); // key -> suma de unidades disponibles del mes (oferta)
  const salesTotals     = new Map(); // key -> suma de netSales del mes
  const priceSums       = new Map(); // key -> suma de priceUF del mes (para promediar)
  const priceCounts     = new Map(); // key -> cantidad de programas con precio ese mes
  const periodLabels    = new Map(); // key -> label legible

  for (const entity of state.rawEntities) {
    for (const period of (entity.periods ?? [])) {
      if (!periodLabels.has(period.key)) periodLabels.set(period.key, period.label ?? period.key);
      for (const stage of (period.stages ?? [])) {
        for (const prog of (stage.programs ?? [])) {
          const tipo = _tipoFromPrograma(prog.program);
          const pairKey = `${entity.name}::${tipo}`;
          if (!allowedPairs.has(pairKey)) continue;
          if (_tipoFilt.size && !_tipoFilt.has(tipo)) continue;
          availableTotals.set(period.key, (availableTotals.get(period.key) ?? 0) + (Number(prog.available) || 0));
          salesTotals.set(period.key,     (salesTotals.get(period.key)     ?? 0) + (Number(prog.netSales)  || 0));
          const precio = Number(prog.priceUF);
          if (!isNaN(precio) && precio > 0) {
            priceSums.set(period.key,   (priceSums.get(period.key)   ?? 0) + precio);
            priceCounts.set(period.key, (priceCounts.get(period.key) ?? 0) + 1);
          }
        }
      }
    }
  }

  const keys      = [...availableTotals.keys()].sort();
  const labels    = keys.map(k => periodLabels.get(k) ?? k);
  const available = keys.map(k => availableTotals.get(k));
  const sales     = keys.map(k => salesTotals.get(k) ?? 0);
  const priceAvg  = keys.map(k => priceCounts.get(k) ? +(priceSums.get(k) / priceCounts.get(k)).toFixed(1) : null);

  if (_chart) { _chart.destroy(); _chart = null; }
  const ctx = canvas.getContext('2d');

  _chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Unidades disponibles (oferta)',
          data: available,
          backgroundColor: _hexToRgba(BAR_COLOR, 0.55),
          borderColor: _hexToRgba(BAR_COLOR, 0.9),
          borderWidth: 1,
          borderRadius: 2,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: 'Ventas netas del mes',
          data: sales,
          borderColor: LINE_COLOR,
          backgroundColor: LINE_COLOR,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          yAxisID: 'y1',
          order: 1,
        },
        {
          type: 'line',
          label: 'Precio promedio (Ticket UF)',
          data: priceAvg,
          borderColor: PRICE_COLOR,
          backgroundColor: PRICE_COLOR,
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          tension: 0.15,
          spanGaps: true,
          yAxisID: 'y2',
          order: 0,
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
          title: { display: true, text: 'Unidades disponibles' },
          ticks: { precision: 0 },
        },
        y1: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Ventas netas del mes' },
          grid: { drawOnChartArea: false },
          ticks: { precision: 0 },
        },
        y2: {
          type: 'linear',
          position: 'right',
          beginAtZero: false,
          title: { display: true, text: 'Precio promedio (UF)' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

// Exporta la serie mensual DESGLOSADA POR TIPOLOGÍA (una fila por mes×tipología,
// no agregada como en el gráfico) para poder correr una regresión multivariable
// en Excel: Disponibles / Ventas Netas / Precio Promedio como variables por mes
// y tipología. Ignora el filtro local de chips (_tipoFilt) a propósito — el
// gráfico se puede acotar visualmente a una tipología, pero el export siempre
// trae todas las tipologías del mercado filtrado para no perder datos de la
// regresión sin que el usuario se dé cuenta.
function _exportXlsx() {
  if (!state.rawEntities.length) return;

  const allowedPairs = new Set(state.filtered.map(r => `${r['Edificio']}::${r['Tipología']}`));

  const byKey = new Map(); // `${periodKey}::${tipo}` -> acumulador
  const periodLabels = new Map();

  for (const entity of state.rawEntities) {
    for (const period of (entity.periods ?? [])) {
      if (!periodLabels.has(period.key)) periodLabels.set(period.key, period.label ?? period.key);
      for (const stage of (period.stages ?? [])) {
        for (const prog of (stage.programs ?? [])) {
          const tipo = _tipoFromPrograma(prog.program);
          const pairKey = `${entity.name}::${tipo}`;
          if (!allowedPairs.has(pairKey)) continue;

          const key = `${period.key}::${tipo}`;
          if (!byKey.has(key)) {
            byKey.set(key, { periodKey: period.key, tipo, available: 0, sales: 0, priceSum: 0, priceCount: 0 });
          }
          const acc = byKey.get(key);
          acc.available += Number(prog.available) || 0;
          acc.sales     += Number(prog.netSales)  || 0;
          const precio = Number(prog.priceUF);
          if (!isNaN(precio) && precio > 0) { acc.priceSum += precio; acc.priceCount++; }
        }
      }
    }
  }

  // Agrupa por tipología — una hoja por tipología, cada una con su propia
  // serie mensual ordenada cronológicamente, lista para regresión sin tener
  // que filtrar/separar filas dentro de Excel.
  const byTipo = new Map();
  for (const r of byKey.values()) {
    if (!byTipo.has(r.tipo)) byTipo.set(r.tipo, []);
    byTipo.get(r.tipo).push(r);
  }

  if (!byTipo.size) {
    alert('No hay datos para exportar con los filtros actuales.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();
  const tipos = [...byTipo.keys()].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'es');
  });

  for (const tipo of tipos) {
    const rows = byTipo.get(tipo)
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map(r => ({
        'Mes':                   periodLabels.get(r.periodKey) ?? r.periodKey,
        'Período Key':           r.periodKey,
        'Unidades Disponibles':  r.available,
        'Ventas Netas':          r.sales,
        'Precio Promedio (UF)':  r.priceCount ? +(r.priceSum / r.priceCount).toFixed(1) : null,
      }));

    // Nombres de hoja en Excel: máx 31 caracteres, sin []:*?/\ ni duplicados.
    let sheetName = String(tipo).replace(/[\[\]:*?/\\]/g, '').slice(0, 31) || 'Tipología';
    let suffix = 2;
    while (usedNames.has(sheetName)) {
      sheetName = `${sheetName.slice(0, 28)}_${suffix++}`;
    }
    usedNames.add(sheetName);

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  XLSX.writeFile(wb, `absorcion_por_tipologia_${Date.now()}.xlsx`);
}

let _exportListenerReady = false;

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

  if (!_exportListenerReady) {
    _exportListenerReady = true;
    $('#absorcionExportBtn')?.addEventListener('click', _exportXlsx);
  }

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
