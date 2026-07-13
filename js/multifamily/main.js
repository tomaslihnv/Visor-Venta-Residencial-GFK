import { $, $$ } from '../core/utils.js';
import { resetFilters } from '../core/filters.js';
import { exportCsv, exportJson } from '../core/export.js';
import { initFilterIO } from '../core/filter-io.js';
import { state, FILTERS, KPIS, PROYECTOS_METRICS, SVP, CRUZ, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME, onDataLoaded } from './data.js';
import { initMpPanel } from './miProyecto.js';
import { fetchMultifamily } from './api.js';

// Mostrar Mi Proyecto siempre, sin esperar a que carguen datos
initMpPanel();

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
  } else if (tab === 'cruz') {
    const { renderCruz } = await import('../core/chart-cruz.js');
    renderCruz(state, CRUZ, mp);
  } else if (tab === 'proyectos') {
    await window._mf.renderProyectos(state, mp);
  }
});

// ── Filtros collapse ───────────────────────────────────────────────────────
$('#filtrosPanelHeader')?.addEventListener('click', () => {
  const body    = $('#filtrosPanelBody');
  const chevron = $('#filtrosChevron');
  body?.classList.toggle('mp-collapsed');
  if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
});

// ── Datasets guardados collapse ────────────────────────────────────────────
$('#savedDatasetsPanelHeader')?.addEventListener('click', () => {
  const body    = $('#savedDatasetsPanelBody');
  const chevron = $('#savedDatasetsChevron');
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
    if (tab === 'cruz')         (await import('../core/chart-cruz.js')).renderCruz(_state, CRUZ, mpCurrent);
    if (tab === 'proyectos')    await window._mf.renderProyectos(_state, mpCurrent);
    if (tab === 'comparativa')  (await import('../core/comparativa.js')).renderComparativa(_state, COMPARATIVA, mpCurrent);
    if (tab === 'mapa')         (await import('../core/map.js')).renderMap(_state, MAP, mpCurrent);
  };

  state.excludedProjects = new Set();
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
      case 'historico':
        (await import('./historico.js')).renderHistorico();
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
      case 'cruz':
        (await import('../core/chart-cruz.js')).renderCruz(state, CRUZ, mp);
        break;
      case 'proyectos':
        await window._mf.renderProyectos(state, mp);
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

// ── Filter IO ─────────────────────────────────────────────────────────────
import('../core/filters.js').then(({ getFilterState, applyFilterState }) => {
  initFilterIO({
    visorId:    'multifamily',
    getState:   () => getFilterState(state),
    applyState: (data) => applyFilterState(data, state),
    panelEl:    document.getElementById('filtrosPanelBody'),
  });
});

// ── Exportar CSV ───────────────────────────────────────────────────────────
$('#exportCsvBtn')?.addEventListener('click', () => {
  exportCsv(state, CSV_FILENAME);
});

// ── Visual options toggle panels ───────────────────────────────────────────
document.querySelectorAll('.ctrl-opts-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.opts);
    if (!target) return;
    const open = target.classList.toggle('open');
    btn.classList.toggle('active', open);
  });
});

// ── Modal: consulta Inciti por área ───────────────────────────────────────
{
  const SNAP_PX = 15;
  const STYLE_VERTEX  = { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 };
  const STYLE_FIRST   = { radius: 7, color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1, weight: 2 };
  const STYLE_EDGE    = { color: '#3b82f6', weight: 2, opacity: 0.9 };
  const STYLE_RUBBER  = { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '5,5' };
  const STYLE_POLYGON = { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 };

  let areaMap = null, drawState = 'idle', vertices = [];
  let vertexMarkers = [], edgePolyline = null, rubberLine = null, polygon = null;

  const modal        = document.getElementById('areaModal');
  const statusEl     = document.getElementById('areaModalStatus');
  const btnDraw      = document.getElementById('areaBtnDraw');
  const btnClear     = document.getElementById('areaBtnClear');
  const btnClosePoly = document.getElementById('areaBtnClosePoly');
  const btnQuery     = document.getElementById('areaBtnQuery');

  function _setStatus(text, type = '') {
    statusEl.className = `area-modal-status${type ? ' ' + type : ''}`;
    statusEl.innerHTML = text;
  }

  function _setState(next) {
    drawState = next;
    btnDraw.disabled      = next !== 'idle';
    btnClear.disabled     = next === 'idle';
    btnClosePoly.disabled = next !== 'drawing' || vertices.length < 3;
    btnQuery.disabled     = next !== 'complete';

    if (next === 'idle') {
      _setStatus('Haz clic en <strong>Dibujar zona</strong> y luego marca vértices en el mapa.');
    } else if (next === 'drawing') {
      const n = vertices.length;
      _setStatus(n === 0
        ? 'Haz clic en el mapa para agregar el primer vértice.'
        : `<strong>${n} vértice${n !== 1 ? 's' : ''}</strong>${n >= 3 ? ' · Clic en el primer punto o usa Cerrar polígono.' : ' · Sigue agregando vértices (mínimo 3).'}`);
    } else if (next === 'complete') {
      _setStatus(`<strong>${vertices.length} vértices</strong> · Zona lista. Haz clic en <strong>Consultar Inciti</strong>.`);
    }
  }

  function _clearTempLayers() {
    vertexMarkers.forEach(m => areaMap.removeLayer(m)); vertexMarkers = [];
    if (edgePolyline) { areaMap.removeLayer(edgePolyline); edgePolyline = null; }
    if (rubberLine)   { areaMap.removeLayer(rubberLine);   rubberLine   = null; }
  }

  function _clearPolygon() {
    if (polygon) { areaMap.removeLayer(polygon); polygon = null; }
  }

  function _clearAll() {
    _clearTempLayers(); _clearPolygon(); vertices = []; _setState('idle');
  }

  function _closePoly() {
    if (vertices.length < 3) return;
    _clearTempLayers();
    polygon = L.polygon(vertices, STYLE_POLYGON).addTo(areaMap);
    areaMap.fitBounds(polygon.getBounds(), { padding: [30, 30] });
    _setState('complete');
  }

  function _initMap() {
    areaMap = L.map('areaQueryMap', { doubleClickZoom: false }).setView([-33.45, -70.65], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(areaMap);

    areaMap.on('click', (e) => {
      if (drawState !== 'drawing') return;
      const latlng = [e.latlng.lat, e.latlng.lng];
      if (vertices.length >= 3) {
        const fp = areaMap.latLngToContainerPoint(vertices[0]);
        const cp = areaMap.latLngToContainerPoint(latlng);
        if (fp.distanceTo(cp) < SNAP_PX) { _closePoly(); return; }
      }
      vertices.push(latlng);
      const isFirst = vertices.length === 1;
      vertexMarkers.push(L.circleMarker(latlng, isFirst ? STYLE_FIRST : STYLE_VERTEX).addTo(areaMap));
      if (edgePolyline) areaMap.removeLayer(edgePolyline);
      if (vertices.length > 1) edgePolyline = L.polyline(vertices, STYLE_EDGE).addTo(areaMap);
      _setState('drawing');
    });

    areaMap.on('mousemove', (e) => {
      if (drawState !== 'drawing' || vertices.length === 0) return;
      const cursor = [e.latlng.lat, e.latlng.lng];
      if (rubberLine) areaMap.removeLayer(rubberLine);
      rubberLine = L.polyline([vertices[vertices.length - 1], cursor], STYLE_RUBBER).addTo(areaMap);
    });
  }

  // Abrir modal
  document.getElementById('btnAreaQuery')?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    if (!areaMap) {
      _initMap();
    } else {
      areaMap.invalidateSize();
    }
  });

  // Cerrar modal
  document.getElementById('areaModalClose')?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // Botones de dibujo
  btnDraw?.addEventListener('click',      () => { _clearAll(); _setState('drawing'); });
  btnClear?.addEventListener('click',     () => _clearAll());
  btnClosePoly?.addEventListener('click', () => _closePoly());

  // Consultar Inciti
  btnQuery?.addEventListener('click', async () => {
    if (drawState !== 'complete' || vertices.length < 3) return;
    const polygon_inciti = vertices.map(([lat, lng]) => ({ lat, lng }));

    btnQuery.disabled = true;
    btnClear.disabled = true;
    _setStatus('Consultando Inciti…', 'loading');

    try {
      const rows = await fetchMultifamily({
        polygons: [polygon_inciti],
        onProgress: msg => _setStatus(msg, 'loading'),
      });

      const fileNameEl = document.getElementById('fileName');
      if (fileNameEl) fileNameEl.textContent = `Inciti · ${rows.length} registros`;

      modal.classList.add('hidden');
      onDataLoaded(rows);
    } catch (err) {
      console.error('[multifamily/area] Error:', err);
      _setStatus(`Error: ${err.message}`, 'error');
      btnClear.disabled  = false;
      btnQuery.disabled  = false;
    }
  });
}

// ── Guardar JSON (para data/multifamily/) ──────────────────────────────────
$('#saveJsonBtn')?.addEventListener('click', () => {
  if (!state.raw.length) { alert('Cargá un Excel primero.'); return; }
  const name = prompt('Nombre del archivo (sin extensión):', CSV_FILENAME);
  if (!name) return;
  const safeName = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  if (!safeName) return;
  exportJson(state, safeName);
});
