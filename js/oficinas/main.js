import { $, $$ } from '../core/utils.js';
import { resetFilters } from '../core/filters.js';
import { exportCsv } from '../core/export.js';
import { initFilterIO } from '../core/filter-io.js';
import { state, FILTERS, KPIS, MAP, PROYECTOS_METRICS, SVP, DISTRIB_COLS, COMPARATIVA, CSV_FILENAME } from './data.js';
import { mp, initMpPanel } from './miProyecto.js';

// Mostrar Mi Proyecto siempre, sin esperar datos
initMpPanel();

// ── Mi Proyecto change → re-render pestaña activa ─────────────────────────
document.addEventListener('mpchange', async () => {
  if (!state.filtered.length) return;
  const of = window._of;
  if (!of) return;
  const tab = document.querySelector('.tab.active')?.dataset.tab;
  if (tab === 'mapa')         of.renderMap(state, MAP, mp);
  if (tab === 'svp')          of.renderSvp(state, SVP, mp);
  if (tab === 'distribucion') of.renderDistrib(state, DISTRIB_COLS, mp);
});

// ── Filtros collapse ───────────────────────────────────────────────────────
$('#filtrosPanelHeader')?.addEventListener('click', () => {
  const body    = $('#filtrosPanelBody');
  const chevron = $('#filtrosChevron');
  body?.classList.toggle('mp-collapsed');
  if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
});

// ── Reset filtros ──────────────────────────────────────────────────────────
$('#resetBtn')?.addEventListener('click', async () => {
  if (!state.raw.length) return;
  const container = $('#filtersContainer');
  const { renderKpis }  = await import('../core/kpis.js');
  const { renderTable } = await import('../core/table.js');
  const { renderMap }   = await import('../core/map.js');
  const { renderProyectos } = await import('../core/chart-proyectos.js');
  const { renderSvp }       = await import('../core/chart-svp.js');
  const { renderDistrib }   = await import('../core/chart-distrib.js');
  const { renderComparativa } = await import('../core/comparativa.js');

  const onChange = _state => {
    renderKpis(_state.filtered, _state.raw.length, KPIS);
    renderTable(_state, { hiddenCols: ['__lat', '__lng'] });
    const tab = document.querySelector('.tab.active')?.dataset.tab;
    if (tab === 'mapa')         renderMap(_state, MAP, mp);
    if (tab === 'proyectos')    renderProyectos(_state, PROYECTOS_METRICS, null, { projectCandidates: ['corredor'] });
    if (tab === 'svp')          renderSvp(_state, SVP, mp);
    if (tab === 'distribucion') renderDistrib(_state, DISTRIB_COLS, mp);
    if (tab === 'comparativa')  renderComparativa(_state, COMPARATIVA, null);
  };

  resetFilters(FILTERS, state, container, onChange);
});

// ── Tabs ───────────────────────────────────────────────────────────────────
$$('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`.tab-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add('active');

    if (!state.filtered.length) return;
    const of = window._of;
    if (!of) return;

    const t = tab.dataset.tab;
    if (t === 'mapa')         of.renderMap(state, MAP, mp);
    if (t === 'proyectos')    of.renderProyectos(state, PROYECTOS_METRICS, null, { projectCandidates: ['corredor'] });
    if (t === 'svp')          of.renderSvp(state, SVP, mp);
    if (t === 'distribucion') of.renderDistrib(state, DISTRIB_COLS, mp);
    if (t === 'comparativa')  of.renderComparativa(state, COMPARATIVA, null);
  });
});

// ── Filter IO ─────────────────────────────────────────────────────────────
import('../core/filters.js').then(({ getFilterState, applyFilterState }) => {
  initFilterIO({
    visorId:    'oficinas',
    getState:   () => getFilterState(state),
    applyState: (data) => applyFilterState(data, state),
    panelEl:    document.getElementById('filtrosPanelBody'),
  });
});

// ── Exportar CSV ───────────────────────────────────────────────────────────
$('#exportCsvBtn')?.addEventListener('click', () => {
  exportCsv(state, CSV_FILENAME);
});
