import { $, $$ } from '../core/utils.js';
import { resetFilters } from '../core/filters.js';
import { exportCsv }   from '../core/export.js';
import { state, FILTERS, KPIS, PROYECTOS_METRICS, SVP, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME } from './data.js';

// ── Mi Proyecto change → re-render pestaña activa ─────────────────────────
document.addEventListener('mpchange', async () => {
  if (!state.filtered.length) return;
  const tab = $('.tab.active')?.dataset.tab;
  const { mp } = await import('./miProyecto.js');
  if (tab === 'comparativa') {
    const { renderComparativa } = await import('../core/comparativa.js');
    renderComparativa(state, COMPARATIVA, mp);
  } else if (tab === 'mapa') {
    const { renderMap } = await import('../core/map.js');
    renderMap(state, MAP, mp);
  } else if (tab === 'distribucion') {
    const { renderDistrib } = await import('../core/chart-distrib.js');
    renderDistrib(state, DISTRIB_COLS, mp);
  } else if (tab === 'svp') {
    const { renderSvp } = await import('../core/chart-svp.js');
    renderSvp(state, SVP, mp);
  } else if (tab === 'proyectos') {
    const { renderProyectos } = await import('../core/chart-proyectos.js');
    renderProyectos(state, PROYECTOS_METRICS, mp, { projectCandidates: MAP.projectCandidates });
  }
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
  const { mp } = await import('./miProyecto.js');
  const { renderKpis }  = await import('../core/kpis.js');
  const { renderTable } = await import('../core/table.js');

  const onChange = async _state => {
    renderKpis(_state.filtered, _state.raw.length, KPIS);
    renderTable(_state, { hiddenCols: [] });
    const tab = $('.tab.active')?.dataset.tab;
    const mpCurrent = (await import('./miProyecto.js')).mp;
    if (tab === 'distribucion') (await import('../core/chart-distrib.js')).renderDistrib(_state, DISTRIB_COLS, mpCurrent);
    if (tab === 'svp')          (await import('../core/chart-svp.js')).renderSvp(_state, SVP, mpCurrent);
    if (tab === 'proyectos')    (await import('../core/chart-proyectos.js')).renderProyectos(_state, PROYECTOS_METRICS, mpCurrent, { projectCandidates: MAP.projectCandidates });
    if (tab === 'comparativa')  (await import('../core/comparativa.js')).renderComparativa(_state, COMPARATIVA, mpCurrent);
    if (tab === 'mapa')         (await import('../core/map.js')).renderMap(_state, MAP, mpCurrent);
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
    const { mp } = await import('./miProyecto.js');

    switch (tab.dataset.tab) {
      case 'comparativa':
        (await import('../core/comparativa.js')).renderComparativa(state, COMPARATIVA, mp);
        break;
      case 'distribucion':
        (await import('../core/chart-distrib.js')).renderDistrib(state, DISTRIB_COLS, mp);
        break;
      case 'mapa':
        (await import('../core/map.js')).renderMap(state, MAP, mp);
        break;
      case 'svp':
        (await import('../core/chart-svp.js')).renderSvp(state, SVP, mp);
        break;
      case 'proyectos':
        (await import('../core/chart-proyectos.js')).renderProyectos(state, PROYECTOS_METRICS, mp, { projectCandidates: MAP.projectCandidates });
        break;
    }
  });
});

// ── Copiar tabla comparativa ───────────────────────────────────────────────
$('#exportCompBtn')?.addEventListener('click', async () => {
  const btn = $('#exportCompBtn');
  const { copyComparativaHtml } = await import('../core/comparativa.js');
  const ok = await copyComparativaHtml();
  if (ok && btn) {
    const prev = btn.textContent;
    btn.textContent = '¡Copiado!'; btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
  }
});

// ── Exportar CSV ───────────────────────────────────────────────────────────
$('#exportCsvBtn')?.addEventListener('click', () => {
  exportCsv(state, CSV_FILENAME);
});
