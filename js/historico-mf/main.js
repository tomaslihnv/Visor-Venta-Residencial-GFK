import { SAVED_DATASETS, PROGRAMAS_ORDER, PROGRAM_COLORS } from './config.js';

// ── Estado ─────────────────────────────────────────────────────────────────
const state = {
  raw:      [],   // todas las filas cargadas
  filtered: [],   // filas tras filtros de programa y proyecto
};

const filters = {
  programas:  new Set(),  // vacío = todos
  proyecto:   null,       // null = todos
};

// ── Utils ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function _avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Datasets ───────────────────────────────────────────────────────────────
function _renderDatasets() {
  const cont = $('datasetsList');
  const selected = new Set();

  cont.innerHTML = SAVED_DATASETS.map((d, i) =>
    `<button class="saved-dataset-btn" data-idx="${i}">${d.label}</button>`
  ).join('');

  async function _load() {
    if (!selected.size) return;
    $('loadingMsg').style.display = '';
    const results = await Promise.all([...selected].map(i =>
      fetch(SAVED_DATASETS[i].file).then(r => r.json())
    ));
    state.raw = results.flat();
    $('loadingMsg').style.display = 'none';
    _onDataLoaded();
  }

  cont.querySelectorAll('.saved-dataset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      selected.has(idx) ? selected.delete(idx) : selected.add(idx);
      btn.classList.toggle('active', selected.has(idx));
      _load();
    });
  });
}

// ── On data loaded ─────────────────────────────────────────────────────────
function _onDataLoaded() {
  _populateProgramaFilter();
  _populateProyectoFilter();
  _applyFilters();
  $('dashboard').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('programaSection').style.display = '';
  $('proyectoSection').style.display = '';
}

function _applyFilters() {
  state.filtered = state.raw.filter(r => {
    if (filters.programas.size && !filters.programas.has(r['Programa'])) return false;
    if (filters.proyecto && r['Proyecto'] !== filters.proyecto) return false;
    return true;
  });
  _render();
}

// ── Filtro Programa ────────────────────────────────────────────────────────
function _populateProgramaFilter() {
  const programas = [...new Set(state.raw.map(r => r['Programa']))]
    .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));

  const cont = $('programaFilter');
  cont.innerHTML = programas.map(p => `
    <button class="prog-chip" data-prog="${p}" style="border-color:${PROGRAM_COLORS[p] ?? '#94a3b8'}">${p}</button>
  `).join('');

  cont.querySelectorAll('.prog-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.prog;
      if (filters.programas.has(p)) {
        filters.programas.delete(p);
        btn.classList.remove('active');
      } else {
        filters.programas.add(p);
        btn.classList.add('active');
      }
      _applyFilters();
    });
  });
}

// ── Filtro Proyecto ────────────────────────────────────────────────────────
function _populateProyectoFilter() {
  const proyectos = [...new Set(state.raw.map(r => r['Proyecto']))].sort();
  const sel = $('proyectoSelect');
  sel.innerHTML = '<option value="">Todos los proyectos</option>' +
    proyectos.map(p => `<option value="${p}">${p}</option>`).join('');
  sel.value = '';
  filters.proyecto = null;

  sel.addEventListener('change', () => {
    filters.proyecto = sel.value || null;
    _applyFilters();
  });
}

// ── KPIs ───────────────────────────────────────────────────────────────────
function _renderKpis() {
  const periodos  = [...new Set(state.filtered.map(r => r['Período Key']))].sort();
  const proyectos = new Set(state.filtered.map(r => r['Proyecto']));
  const lastPer   = state.filtered.filter(r => r['Período Key'] === periodos[periodos.length - 1]);

  const avgRent = _avg(lastPer.map(r => r['Arriendo UF']).filter(v => v != null));
  const avgVac  = _avg(lastPer.map(r => r['Vacancia (%)']).filter(v => v != null));

  $('kpiProyectos').textContent  = proyectos.size;
  $('kpiPeriodos').textContent   = periodos.length;
  $('kpiUltimoPer').textContent  = periodos[periodos.length - 1] ?? '—';
  $('kpiArriendoUF').textContent = avgRent != null ? avgRent.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' UF' : '—';
  $('kpiVacancia').textContent   = avgVac  != null ? avgVac.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%' : '—';
}

// ── Gráficos ───────────────────────────────────────────────────────────────
let _chartRent = null;
let _chartVac  = null;

function _buildSeriesByPrograma(metrica) {
  const periodos = [...new Set(state.filtered.map(r => r['Período Key']))].sort();
  const programas = [...new Set(state.filtered.map(r => r['Programa']))]
    .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));

  const datasets = programas.map(prog => {
    const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
    const data  = periodos.map(per => {
      const vals = state.filtered
        .filter(r => r['Período Key'] === per && r['Programa'] === prog && r[metrica] != null)
        .map(r => r[metrica]);
      return vals.length ? _avg(vals) : null;
    });
    return {
      label:           prog,
      data,
      borderColor:     color,
      backgroundColor: color + '22',
      borderWidth:     2,
      pointRadius:     3,
      tension:         0.3,
      spanGaps:        true,
    };
  });

  return { periodos, datasets };
}

function _renderCharts() {
  const { periodos: p1, datasets: ds1 } = _buildSeriesByPrograma('Arriendo UF');
  const { periodos: p2, datasets: ds2 } = _buildSeriesByPrograma('Vacancia (%)');

  const commonOpts = (yLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: {
        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '—'}`
      }}
    },
    scales: {
      x: { ticks: { font: { size: 10 } } },
      y: { title: { display: true, text: yLabel }, ticks: { font: { size: 10 } } }
    }
  });

  if (_chartRent) _chartRent.destroy();
  _chartRent = new Chart($('chartRent'), {
    type: 'line',
    data: { labels: p1, datasets: ds1 },
    options: commonOpts('Arriendo UF'),
  });

  if (_chartVac) _chartVac.destroy();
  _chartVac = new Chart($('chartVac'), {
    type: 'line',
    data: { labels: p2, datasets: ds2 },
    options: commonOpts('Vacancia (%)'),
  });
}

function _render() {
  _renderKpis();
  _renderCharts();
}

// ── Init ───────────────────────────────────────────────────────────────────
_renderDatasets();
