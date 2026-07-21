import { $, $$ } from '../core/utils.js';
import { resetFilters } from '../core/filters.js';
import { exportCsv } from '../core/export.js';
import { initFilterIO } from '../core/filter-io.js';
import { initTiposIO } from '../core/tipos-io.js';
import { state, FILTERS, KPIS, MAP, PROYECTOS_METRICS, SVP, DISTRIB_COLS, COMPARATIVA, CSV_FILENAME, PROY_GROUP, onDataLoaded } from './data.js';
import { mp, initMpPanel } from './miProyecto.js';
import { queryArea, flattenEntities, calcAreaKm2 } from './api.js';
import * as RQ from './recurringQueries.js';

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
    if (tab === 'proyectos')    renderProyectos(_state, PROYECTOS_METRICS, null, PROY_GROUP);
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
    if (t === 'proyectos')    of.renderProyectos(state, PROYECTOS_METRICS, null, PROY_GROUP);
    if (t === 'svp')          of.renderSvp(state, SVP, mp);
    if (t === 'distribucion') of.renderDistrib(state, DISTRIB_COLS, mp);
    if (t === 'comparativa')  of.renderComparativa(state, COMPARATIVA, null);
  });
});

// ── Agrupar por (tab Proyectos) ─────────────────────────────────────────────
const PROY_GROUPBY_CANDIDATES = {
  submercado:  ['submercado'],
  propietario: ['propietario'],
  edificio:    ['nombre'],
};
document.getElementById('proyGroupBy')?.addEventListener('change', e => {
  PROY_GROUP.projectCandidates = PROY_GROUPBY_CANDIDATES[e.target.value] ?? ['submercado'];
  if (!state.filtered.length) return;
  const of = window._of;
  if (of && document.querySelector('.tab.active')?.dataset.tab === 'proyectos') {
    of.renderProyectos(state, PROYECTOS_METRICS, null, PROY_GROUP);
  }
});

// ── Visual options toggle panels ──────────────────────────────────────────
document.querySelectorAll('.ctrl-opts-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.opts);
    if (!target) return;
    const open = target.classList.toggle('open');
    btn.classList.toggle('active', open);
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

// ── Tipos IO ──────────────────────────────────────────────────────────────
import('./miProyecto.js').then(({ getTiposState, applyTiposState }) => {
  initTiposIO({
    visorId:    'oficinas',
    visorLabel: 'Oficinas',
    getState:   getTiposState,
    applyState: applyTiposState,
    panelEl:    document.getElementById('mpPanelBody'),
  });
});

// ── Exportar CSV ───────────────────────────────────────────────────────────
$('#exportCsvBtn')?.addEventListener('click', () => {
  exportCsv(state, CSV_FILENAME);
});

// ── Consulta Inciti por área y por comuna ─────────────────────────────────
{
  const SNAP_PX = 15;
  const STYLE_VERTEX  = { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 };
  const STYLE_FIRST   = { radius: 7, color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1, weight: 2 };
  const STYLE_EDGE    = { color: '#3b82f6', weight: 2, opacity: 0.9 };
  const STYLE_RUBBER  = { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '5,5' };
  const STYLE_POLYGON = { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 };

  const COMUNAS_RM = [
    "Cerrillos","Cerro Navia","Conchalí","El Bosque","Estación Central","Huechuraba",
    "Independencia","La Cisterna","La Florida","La Granja","La Pintana","La Reina",
    "Las Condes","Lo Barnechea","Lo Espejo","Lo Prado","Macul","Maipú","Ñuñoa",
    "Pedro Aguirre Cerda","Peñalolén","Providencia","Pudahuel","Quilicura","Quinta Normal",
    "Recoleta","Renca","San Joaquín","San Miguel","San Ramón","Santiago","Vitacura",
    "Puente Alto","Pirque","San José de Maipo","San Bernardo","Buin","Calera de Tango",
    "Paine","Colina","Lampa","Tiltil","Melipilla","Alhué","Curacaví","María Pinto",
    "San Pedro","Talagante","El Monte","Isla de Maipo","Padre Hurtado","Peñaflor",
  ].sort();

  let areaMap = null, drawState = 'idle', vertices = [], currentRawEntities = [], lastScreen = 'dropzone';
  let vertexMarkers = [], edgePolyline = null, rubberLine = null, areaPoly = null;

  // Consultas recurrentes: id de la consulta activa (si el flujo actual vino
  // de un bloque de "Consultas Recurrentes"), y si estamos dibujando un
  // polígono para guardarlo en una consulta (nueva o edición) en vez de
  // solo para una consulta puntual.
  let activeRQId  = null;
  let drawForRQId = null; // id de la consulta cuyo polígono se está (re)dibujando

  const dropzone         = document.getElementById('dropzone');
  const drawContainer    = document.getElementById('areaDrawContainer');
  const previewContainer = document.getElementById('incitiPreview');
  const comunaContainer  = document.getElementById('comunaQueryContainer');
  const rqContainer      = document.getElementById('recurringQueriesContainer');
  const rqFormOverlay    = document.getElementById('rqFormOverlay');
  const rqLoadingOverlay = document.getElementById('rqLoadingOverlay');
  const rqLoadingStatus  = document.getElementById('rqLoadingStatus');
  const dashboard        = document.getElementById('dashboard');
  const statusEl         = document.getElementById('areaDrawStatus');
  const btnDraw          = document.getElementById('areaBtnDraw');
  const btnClear         = document.getElementById('areaBtnClear');
  const btnClosePoly     = document.getElementById('areaBtnClosePoly');
  const btnQuery         = document.getElementById('areaBtnQuery');
  const btnCancel        = document.getElementById('areaBtnCancel');
  const comunaSelect     = document.getElementById('comunaSelectInput');
  const comunaBtnQuery   = document.getElementById('comunaBtnQuery');
  const comunaBtnCancel  = document.getElementById('comunaBtnCancel');

  if (comunaSelect && comunaSelect.children.length <= 1) {
    COMUNAS_RM.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      comunaSelect.appendChild(opt);
    });
  }

  function _showRQLoading(msg) {
    rqLoadingOverlay?.classList.remove('hidden');
    if (rqLoadingStatus) rqLoadingStatus.textContent = msg;
  }
  function _hideRQLoading() {
    rqLoadingOverlay?.classList.add('hidden');
  }

  function _showScreen(screen) {
    [dropzone, drawContainer, previewContainer, dashboard, rqContainer].forEach(el => el?.classList.add('hidden'));
    comunaContainer?.classList.add('hidden');
    _hideRQLoading();
    if (screen === 'dropzone')  dropzone?.classList.remove('hidden');
    if (screen === 'dashboard') dashboard?.classList.remove('hidden');
    if (screen === 'recurring') { rqContainer?.classList.remove('hidden'); _renderRecurringQueries(); }
    if (screen === 'draw') {
      drawContainer?.classList.remove('hidden');
      _initMapIfNeeded();
      _setState('idle');
    }
    if (screen === 'comuna') {
      drawContainer?.classList.remove('hidden');
      _initMapIfNeeded();
      _clearAll();
      comunaContainer?.classList.remove('hidden');
      _setStatus('Selecciona una comuna y presiona <strong>Consultar</strong>.');
    }
    if (screen === 'preview') previewContainer?.classList.remove('hidden');
  }

  function _setStatus(text, type = '') {
    if (statusEl) {
      statusEl.className = `area-draw-status${type ? ' ' + type : ''}`;
      statusEl.innerHTML = text;
    }
    if (rqLoadingStatus && !rqLoadingOverlay?.classList.contains('hidden')) {
      rqLoadingStatus.textContent = text.replace(/<[^>]+>/g, '');
    }
  }

  function _setState(next) {
    drawState = next;
    if (!btnDraw) return;
    btnDraw.disabled      = next !== 'idle';
    btnClear.disabled     = next === 'idle';
    btnClosePoly.disabled = next !== 'drawing' || vertices.length < 3;
    btnQuery.disabled     = next !== 'complete';
    drawContainer.classList.toggle('drawing-active', next === 'drawing');
    if (next === 'idle') {
      _setStatus('Haz clic en <strong>Dibujar zona</strong> para comenzar.');
    } else if (next === 'drawing') {
      const n = vertices.length;
      _setStatus(n === 0
        ? 'Haz clic en el mapa para agregar el primer vértice.'
        : `<strong>${n} vértice${n !== 1 ? 's' : ''}</strong>${n >= 3 ? ' · Clic en el primer punto o <em>Cerrar polígono</em>.' : ' · Sigue agregando (mínimo 3).'}`);
    } else if (next === 'complete') {
      const areaKm2 = calcAreaKm2(vertices.map(([lat, lng]) => ({ lat, lng })));
      _setStatus(`<strong>Área: ${areaKm2.toFixed(1)} km²</strong> · Zona lista. Haz clic en <strong>Consultar Inciti</strong>.`);
    }
  }

  function _clearTempLayers() {
    if (!areaMap) return;
    vertexMarkers.forEach(m => areaMap.removeLayer(m)); vertexMarkers = [];
    if (edgePolyline) { areaMap.removeLayer(edgePolyline); edgePolyline = null; }
    if (rubberLine)   { areaMap.removeLayer(rubberLine);   rubberLine   = null; }
  }

  function _clearAll() {
    _clearTempLayers();
    if (areaPoly && areaMap) { areaMap.removeLayer(areaPoly); areaPoly = null; }
    vertices = [];
    _setState('idle');
  }

  function _closePoly() {
    if (vertices.length < 3) return;
    _clearTempLayers();
    areaPoly = L.polygon(vertices, STYLE_POLYGON).addTo(areaMap);
    areaMap.fitBounds(areaPoly.getBounds(), { padding: [40, 40] });
    _setState('complete');
  }

  function _initMapIfNeeded() {
    if (!areaMap) {
      areaMap = L.map('areaDrawMap', { doubleClickZoom: false }).setView([-33.45, -70.65], 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
      }).addTo(areaMap);

      areaMap.on('click', e => {
        if (drawState !== 'drawing') return;
        const latlng = [e.latlng.lat, e.latlng.lng];
        if (vertices.length >= 3) {
          const fp = areaMap.latLngToContainerPoint(vertices[0]);
          const cp = areaMap.latLngToContainerPoint(latlng);
          if (fp.distanceTo(cp) < SNAP_PX) { _closePoly(); return; }
        }
        vertices.push(latlng);
        vertexMarkers.push(L.circleMarker(latlng, vertices.length === 1 ? STYLE_FIRST : STYLE_VERTEX).addTo(areaMap));
        if (edgePolyline) areaMap.removeLayer(edgePolyline);
        if (vertices.length > 1) edgePolyline = L.polyline(vertices, STYLE_EDGE).addTo(areaMap);
        _setState('drawing');
      });

      areaMap.on('mousemove', e => {
        if (drawState !== 'drawing' || vertices.length === 0) return;
        const cursor = [e.latlng.lat, e.latlng.lng];
        if (rubberLine) areaMap.removeLayer(rubberLine);
        rubberLine = L.polyline([vertices[vertices.length - 1], cursor], STYLE_RUBBER).addTo(areaMap);
      });
    } else {
      areaMap.invalidateSize();
    }
  }

  async function _runQuery(polygonInciti) {
    const wasRQFlow = !!(activeRQId || drawForRQId);
    _setStatus('Procesando área de consulta...', 'loading');
    // Si este polígono se dibujó para guardarlo en una consulta recurrente
    // (nueva o "redibujar área"), lo persistimos antes de consultar Inciti,
    // para no perderlo si la consulta falla.
    if (drawForRQId) {
      RQ.updateQuery(drawForRQId, { polygon: polygonInciti });
      activeRQId  = drawForRQId;
      drawForRQId = null;
    }
    try {
      const entities = await queryArea({ polygons: [polygonInciti], onProgress: msg => _setStatus(msg, 'loading') });
      currentRawEntities = entities;
      const rq = activeRQId ? RQ.getQuery(activeRQId) : null;
      _buildPreviewPanel(entities, rq?.rememberedSelection ?? null);
      _showScreen('preview');
    } catch (err) {
      console.error('[Inciti/oficinas] Error:', err);
      if (wasRQFlow) {
        _hideRQLoading();
        alert(`Error consultando Inciti: ${err.message}`);
        activeRQId = null; drawForRQId = null;
        _showScreen('recurring');
      } else {
        _setStatus(`Error: ${err.message}`, 'error');
        if (btnQuery)      btnQuery.disabled      = false;
        if (comunaBtnQuery) comunaBtnQuery.disabled = false;
      }
    }
  }

  function _buildPreviewPanel(entities, preselectedKeys = null) {
    const txtCount = document.getElementById('previewCountText');
    if (txtCount) txtCount.textContent = `Inciti encontró ${entities.length} proyecto${entities.length !== 1 ? 's' : ''} de oficinas`;

    const fName    = document.getElementById('prevFilterName');
    const fCommune = document.getElementById('prevFilterCommune');
    const fOwner   = document.getElementById('prevFilterOwner');

    const communes = [...new Set(entities.map(e => e.location?.commune || e.location?.comuna || ''))].filter(Boolean).sort();
    const submercados = [...new Set(entities.map(e => e.corridor || ''))].filter(Boolean).sort();

    if (fCommune) fCommune.innerHTML = '<option value="">Todas las comunas</option>' + communes.map(c => `<option value="${c}">${c}</option>`).join('');
    if (fOwner)   fOwner.innerHTML   = '<option value="">Todos los submercados</option>' + submercados.map(o => `<option value="${o}">${o}</option>`).join('');
    if (fName)    fName.value = '';

    const rememberedSet = preselectedKeys ? new Set(preselectedKeys) : null;
    const selectionMap = new Map();
    entities.forEach(e => {
      const key = String(e.id || e.name);
      selectionMap.set(key, rememberedSet ? rememberedSet.has(key) : true);
    });

    function _renderTableRows() {
      const tbody   = document.getElementById('previewTableBody');
      if (!tbody) return;
      const nameVal = fName?.value.toLowerCase().trim() || '';
      const commVal = fCommune?.value || '';
      const ownVal  = fOwner?.value   || '';
      const filtered = entities.filter(e => {
        const cName = (e.name || '').toLowerCase().includes(nameVal);
        const cComm = !commVal || (e.location?.commune || e.location?.comuna || '') === commVal;
        const cOwn  = !ownVal  || (e.corridor || '') === ownVal;
        return cName && cComm && cOwn;
      });
      tbody.innerHTML = filtered.map(e => {
        const key = String(e.id || e.name);
        const chk = selectionMap.get(key) ? 'checked' : '';
        return `<tr>
          <td><input type="checkbox" class="prev-item-check" data-id="${key}" ${chk} /></td>
          <td><strong>${e.name || 'Sin nombre'}</strong></td>
          <td>${e.location?.commune || e.location?.comuna || '—'}</td>
          <td>${e.corridor || '—'}</td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.prev-item-check').forEach(chk => {
        chk.addEventListener('change', () => selectionMap.set(String(chk.dataset.id), chk.checked));
      });
    }

    [fName, fCommune, fOwner].forEach(el => el?.addEventListener('input', _renderTableRows));

    const selectAll = document.getElementById('prevSelectAll');
    if (selectAll) {
      selectAll.checked = [...selectionMap.values()].every(Boolean);
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.prev-item-check').forEach(chk => {
          chk.checked = selectAll.checked;
          selectionMap.set(String(chk.dataset.id), selectAll.checked);
        });
      });
    }

    _renderTableRows();

    const btnLoad = document.getElementById('previewBtnLoad');
    if (btnLoad) {
      btnLoad.onclick = () => {
        const selected = entities.filter(e => selectionMap.get(String(e.id || e.name)) === true);
        if (!selected.length) { alert('Debes seleccionar al menos un proyecto de oficinas para cargar.'); return; }
        const rows = flattenEntities(selected);
        if (!rows.length) {
          console.warn('[Inciti/oficinas] flattenEntities devolvió 0 filas. Entidades:', selected);
          alert('Los proyectos seleccionados no tienen datos disponibles. Revisa la consola del navegador.');
          return;
        }
        const fileNameEl = document.getElementById('fileName');
        if (fileNameEl) fileNameEl.textContent = `Inciti · ${selected.length} oficinas (${rows.length} registros)`;

        // Si el flujo vino de una consulta recurrente, recordar qué quedó
        // marcado esta vez para preseleccionarlo la próxima (modificable).
        if (activeRQId) {
          const checkedKeys = [...selectionMap.entries()].filter(([, v]) => v).map(([k]) => k);
          RQ.updateQuery(activeRQId, { rememberedSelection: checkedKeys, lastRunAt: new Date().toISOString() });
          activeRQId = null;
        }

        _showScreen('dashboard');
        _clearAll();
        onDataLoaded(rows);
      };
    }
  }

  document.getElementById('btnAreaQuery')?.addEventListener('click',  () => { activeRQId = null; drawForRQId = null; lastScreen = 'draw';   _showScreen('draw');   });
  document.getElementById('btnComunaQuery')?.addEventListener('click', () => { activeRQId = null; drawForRQId = null; lastScreen = 'comuna'; _showScreen('comuna'); });
  btnCancel?.addEventListener('click', () => {
    const target = (activeRQId || drawForRQId) ? 'recurring' : 'dropzone';
    activeRQId = null; drawForRQId = null;
    _showScreen(target);
  });
  document.getElementById('previewBtnCancel')?.addEventListener('click', () => {
    activeRQId = null; drawForRQId = null;
    _showScreen(lastScreen);
  });
  btnDraw?.addEventListener('click',      () => { _clearAll(); _setState('drawing'); });
  btnClear?.addEventListener('click',     _clearAll);
  btnClosePoly?.addEventListener('click', _closePoly);

  btnQuery?.addEventListener('click', async () => {
    if (drawState !== 'complete' || vertices.length < 3) return;
    btnQuery.disabled = true;
    await _runQuery(vertices.map(([lat, lng]) => ({ lat, lng })));
  });

  comunaSelect?.addEventListener('change', () => {
    if (comunaBtnQuery) comunaBtnQuery.disabled = !comunaSelect.value;
  });
  comunaBtnCancel?.addEventListener('click', () => {
    const target = activeRQId ? 'recurring' : 'dropzone';
    activeRQId = null;
    _showScreen(target);
  });

  async function _resolveComunaPolygon(comuna) {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(comuna)},+Región+Metropolitana,+Chile&format=json&polygon_geojson=1&limit=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) throw new Error('No se pudo conectar con el servicio geográfico.');
    const data = await res.json();
    if (!data?.length || !data[0].geojson) throw new Error(`No se encontró el contorno de ${comuna}.`);
    const geojson = data[0].geojson;
    let rawCoords = [];
    if (geojson.type === 'Polygon') {
      rawCoords = geojson.coordinates[0];
    } else if (geojson.type === 'MultiPolygon') {
      let maxLen = 0;
      geojson.coordinates.forEach(poly => { if (poly[0].length > maxLen) { maxLen = poly[0].length; rawCoords = poly[0]; } });
    } else {
      throw new Error('Formato geográfico no compatible.');
    }
    let polygon_inciti = rawCoords.map(coord => ({ lat: coord[1], lng: coord[0] }));
    if (polygon_inciti.length > 0) {
      const first = polygon_inciti[0], last = polygon_inciti[polygon_inciti.length - 1];
      if (first.lat !== last.lat || first.lng !== last.lng) polygon_inciti.push({ ...first });
    }
    if (polygon_inciti.length > 80) {
      const step = Math.ceil(polygon_inciti.length / 80);
      const simplified = [];
      for (let i = 0; i < polygon_inciti.length - 1; i += step) simplified.push(polygon_inciti[i]);
      simplified.push(polygon_inciti[polygon_inciti.length - 1]);
      polygon_inciti = simplified;
    }
    return polygon_inciti;
  }

  comunaBtnQuery?.addEventListener('click', async () => {
    const comuna = comunaSelect.value;
    if (!comuna) return;
    comunaBtnQuery.disabled = true;
    _setStatus(`Buscando límites geográficos de ${comuna}…`, 'loading');
    try {
      const polygon_inciti = await _resolveComunaPolygon(comuna);
      _clearAll();
      vertices = polygon_inciti.map(v => [v.lat, v.lng]);
      areaPoly = L.polygon(vertices, STYLE_POLYGON).addTo(areaMap);
      areaMap.fitBounds(areaPoly.getBounds(), { padding: [20, 20] });
      await _runQuery(polygon_inciti);
    } catch (err) {
      console.error('[Oficinas/Comuna] Error:', err);
      _setStatus(`Error: ${err.message}`, 'error');
      comunaBtnQuery.disabled = false;
    }
  });

  // ── Consultas Recurrentes ──────────────────────────────────────────────
  async function _runComunaRQ(rq) {
    activeRQId = rq.id;
    _showRQLoading(`Buscando límites geográficos de ${rq.comuna}…`);
    try {
      const polygon_inciti = await _resolveComunaPolygon(rq.comuna);
      await _runQuery(polygon_inciti);
    } catch (err) {
      console.error('[RQ Comuna] Error:', err);
      _hideRQLoading();
      alert(`Error consultando ${rq.comuna}: ${err.message}`);
      activeRQId = null;
      _showScreen('recurring');
    }
  }

  function _runPolygonRQ(rq) {
    if (rq.polygon?.length >= 3) {
      activeRQId = rq.id;
      _showRQLoading(`Consultando ${rq.label}…`);
      _runQuery(rq.polygon);
    } else {
      drawForRQId = rq.id;
      lastScreen = 'recurring';
      _showScreen('draw');
      _clearAll();
      _setState('drawing');
    }
  }

  function _fmtRQDate(iso) {
    if (!iso) return 'Nunca consultada';
    const d = new Date(iso);
    return `Última consulta: ${d.toLocaleDateString('es-CL')}`;
  }

  function _renderRecurringQueries() {
    const grid = document.getElementById('rqGrid');
    if (!grid) return;
    const queries = RQ.getQueries();
    grid.innerHTML = queries.map(rq => {
      const typeLabel = rq.type === 'comuna' ? 'Comuna' : 'Área propia';
      const needsDraw = rq.type === 'polygon' && !(rq.polygon?.length >= 3);
      const remembered = rq.rememberedSelection?.length
        ? ` · ${rq.rememberedSelection.length} recordados`
        : '';
      return `
        <div class="rq-card" data-id="${rq.id}">
          <span class="rq-card-type">${typeLabel}</span>
          <h3>${rq.label}</h3>
          <p class="rq-card-meta">${_fmtRQDate(rq.lastRunAt)}${remembered}</p>
          <div class="rq-card-actions">
            <button type="button" class="area-btn primary rq-btn-run">${needsDraw ? 'Dibujar área' : 'Consultar'}</button>
            ${rq.type === 'polygon' && !needsDraw ? '<button type="button" class="area-btn rq-btn-redraw">Redibujar área</button>' : ''}
            <button type="button" class="area-btn rq-btn-edit">Editar</button>
            <button type="button" class="area-btn cancel rq-btn-delete">Eliminar</button>
          </div>
        </div>
      `;
    }).join('') + `<button type="button" class="rq-card-add" id="rqAddCard">+ Nueva consulta</button>`;

    grid.querySelectorAll('.rq-card').forEach(card => {
      const id = card.dataset.id;
      const rq = RQ.getQuery(id);
      if (!rq) return;
      card.querySelector('.rq-btn-run')?.addEventListener('click', () => {
        if (rq.type === 'comuna') _runComunaRQ(rq);
        else _runPolygonRQ(rq);
      });
      card.querySelector('.rq-btn-redraw')?.addEventListener('click', () => {
        drawForRQId = rq.id;
        lastScreen = 'recurring';
        _showScreen('draw');
        _clearAll();
        _setState('drawing');
      });
      card.querySelector('.rq-btn-edit')?.addEventListener('click', () => _openRQForm(rq));
      card.querySelector('.rq-btn-delete')?.addEventListener('click', () => {
        if (!confirm(`¿Eliminar la consulta recurrente "${rq.label}"?`)) return;
        RQ.deleteQuery(id);
        _renderRecurringQueries();
      });
    });
    grid.querySelector('#rqAddCard')?.addEventListener('click', () => _openRQForm(null));
  }

  // ── Formulario alta/edición de consultas recurrentes ──
  const rqFormLabel        = document.getElementById('rqFormLabel');
  const rqFormType         = () => document.querySelector('input[name="rqFormType"]:checked')?.value ?? 'comuna';
  const rqFormComunaRow    = document.getElementById('rqFormComunaRow');
  const rqFormPolygonRow   = document.getElementById('rqFormPolygonRow');
  const rqFormComunaSelect = document.getElementById('rqFormComunaSelect');
  let _editingRQId = null;

  if (rqFormComunaSelect && rqFormComunaSelect.children.length <= 1) {
    COMUNAS_RM.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      rqFormComunaSelect.appendChild(opt);
    });
  }

  function _syncRQFormTypeUI() {
    const isComuna = rqFormType() === 'comuna';
    rqFormComunaRow?.classList.toggle('hidden', !isComuna);
    rqFormPolygonRow?.classList.toggle('hidden', isComuna);
  }
  document.querySelectorAll('input[name="rqFormType"]').forEach(r => r.addEventListener('change', _syncRQFormTypeUI));

  function _openRQForm(rq) {
    _editingRQId = rq?.id ?? null;
    document.getElementById('rqFormTitle').textContent = rq ? 'Editar consulta recurrente' : 'Nueva consulta recurrente';
    rqFormLabel.value = rq?.label ?? '';
    const type = rq?.type ?? 'comuna';
    document.querySelector(`input[name="rqFormType"][value="${type}"]`).checked = true;
    rqFormComunaSelect.value = rq?.comuna ?? '';
    _syncRQFormTypeUI();
    rqFormOverlay?.classList.remove('hidden');
  }

  function _closeRQForm() {
    rqFormOverlay?.classList.add('hidden');
    _editingRQId = null;
  }

  document.getElementById('rqFormCancel')?.addEventListener('click', _closeRQForm);

  document.getElementById('rqFormSave')?.addEventListener('click', () => {
    const label = rqFormLabel.value.trim();
    if (!label) { alert('Ponle un nombre a la consulta.'); return; }
    const type = rqFormType();
    if (type === 'comuna' && !rqFormComunaSelect.value) { alert('Selecciona una comuna.'); return; }

    if (_editingRQId) {
      const patch = { label, type };
      if (type === 'comuna') { patch.comuna = rqFormComunaSelect.value; patch.polygon = null; }
      else { patch.comuna = null; }
      RQ.updateQuery(_editingRQId, patch);
      _closeRQForm();
      _showScreen('recurring');
    } else {
      const entry = RQ.addQuery({
        label, type,
        comuna:  type === 'comuna'  ? rqFormComunaSelect.value : null,
        polygon: null,
      });
      _closeRQForm();
      if (type === 'polygon') {
        _runPolygonRQ(entry);
      } else {
        _showScreen('recurring');
      }
    }
  });

  document.getElementById('btnRecurringQuery')?.addEventListener('click', () => {
    lastScreen = 'recurring';
    _showScreen('recurring');
  });
  document.getElementById('rqAddBtn')?.addEventListener('click', () => _openRQForm(null));
  document.getElementById('rqBackBtn')?.addEventListener('click', () => _showScreen(state.raw.length ? 'dashboard' : 'dropzone'));
}
