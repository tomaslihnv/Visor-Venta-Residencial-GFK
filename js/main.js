import { $, $$ } from './utils.js';
import { resetFilters } from './filters.js';
import { initFilterIO } from './core/filter-io.js';
import { queryArea, flattenEntities, calcAreaKm2 } from './api.js';
import { state, onDataLoaded } from './data.js';

// Re-renderizar la pestaña activa cuando cambia Mi Proyecto
document.addEventListener('mpchange', () => {
  const activeTab = $('.tab.active')?.dataset.tab;
  if (activeTab === 'comparativa') {
    import('./comparativa.js').then(({ renderComparativa }) => renderComparativa());
  } else if (activeTab === 'mapa') {
    import('./map.js').then(({ renderMap }) => renderMap());
  } else if (activeTab === 'distribucion') {
    import('./chart.js').then(({ renderDistrib }) => renderDistrib());
  } else if (activeTab === 'svp') {
    import('./chart.js').then(({ renderSupVsPrecio }) => renderSupVsPrecio());
  } else if (activeTab === 'proyectos') {
    import('./chart.js').then(({ renderProyectos }) => renderProyectos());
  }
});

// ============== Filtros collapse ==============
$('#filtrosPanelHeader')?.addEventListener('click', () => {
  const body    = $('#filtrosPanelBody');
  const chevron = $('#filtrosChevron');
  body?.classList.toggle('mp-collapsed');
  if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
});

// ============== Reset ==============
$('#resetBtn').addEventListener('click', resetFilters);

// ============== Tabs ==============
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    if (tab.dataset.tab === 'comparativa') {
      import('./comparativa.js').then(({ renderComparativa }) => renderComparativa());
    }
    if (tab.dataset.tab === 'distribucion') {
      import('./chart.js').then(({ renderDistrib }) => renderDistrib());
    }
    if (tab.dataset.tab === 'mapa') {
      import('./map.js').then(({ renderMap }) => renderMap());
    }
    if (tab.dataset.tab === 'svp') {
      import('./chart.js').then(({ renderSupVsPrecio }) => renderSupVsPrecio());
    }
    if (tab.dataset.tab === 'proyectos') {
      import('./chart.js').then(({ renderProyectos }) => renderProyectos());
    }
  });
});

// ============== Copiar tabla comparativa ==============
$('#exportCompBtn').addEventListener('click', async () => {
  const btn = $('#exportCompBtn');
  const { copyComparativaHtml } = await import('./comparativa.js');
  const ok = await copyComparativaHtml();
  if (ok) {
    const prev = btn.textContent;
    btn.textContent = '¡Copiado!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
  }
});

// ============== Filter IO ==============
import('./filters.js').then(({ getFilterState, applyFilterState }) => {
  initFilterIO({
    visorId:    'venta',
    getState:   getFilterState,
    applyState: applyFilterState,
    panelEl:    document.getElementById('filtrosPanelBody'),
  });
});

// ============== Visual options toggle panels ==============
document.querySelectorAll('.ctrl-opts-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.opts);
    if (!target) return;
    const open = target.classList.toggle('open');
    btn.classList.toggle('active', open);
  });
});

// ── Consulta Inciti por área / comuna ────────────────────────────────────────
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
    "San Pedro","Talagante","El Monte","Isla de Maipo","Padre Hurtado","Peñaflor"
  ].sort();

  let areaMap = null, drawState = 'idle', vertices = [], lastScreen = 'dropzone';
  let vertexMarkers = [], edgePolyline = null, rubberLine = null, areaPoly = null;

  const dropzone        = document.getElementById('dropzone');
  const drawContainer   = document.getElementById('areaDrawContainer');
  const previewContainer= document.getElementById('incitiPreview');
  const comunaContainer = document.getElementById('comunaQueryContainer');
  const dashboard       = document.getElementById('dashboard');
  const statusEl        = document.getElementById('areaDrawStatus');
  const btnDraw         = document.getElementById('areaBtnDraw');
  const btnClear        = document.getElementById('areaBtnClear');
  const btnClosePoly    = document.getElementById('areaBtnClosePoly');
  const btnQuery        = document.getElementById('areaBtnQuery');
  const btnCancel       = document.getElementById('areaBtnCancel');
  const comunaSelect    = document.getElementById('comunaSelectInput');
  const comunaBtnQuery  = document.getElementById('comunaBtnQuery');
  const comunaBtnCancel = document.getElementById('comunaBtnCancel');

  if (comunaSelect && comunaSelect.children.length <= 1) {
    COMUNAS_RM.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; comunaSelect.appendChild(o); });
  }

  function _showScreen(screen) {
    [dropzone, drawContainer, previewContainer, dashboard].forEach(el => el?.classList.add('hidden'));
    comunaContainer?.classList.add('hidden');
    if (screen === 'dropzone')  dropzone?.classList.remove('hidden');
    if (screen === 'dashboard') dashboard?.classList.remove('hidden');
    if (screen === 'draw')   { drawContainer?.classList.remove('hidden'); _initMapIfNeeded(); _setState('idle'); }
    if (screen === 'comuna') { drawContainer?.classList.remove('hidden'); _initMapIfNeeded(); _clearAll(); comunaContainer?.classList.remove('hidden'); _setStatus('Selecciona una comuna y presiona <strong>Consultar</strong>.'); }
    if (screen === 'preview') previewContainer?.classList.remove('hidden');
  }

  function _setStatus(text, type = '') {
    if (!statusEl) return;
    statusEl.className = `area-draw-status${type ? ' ' + type : ''}`;
    statusEl.innerHTML = text;
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
      _setStatus(n === 0 ? 'Haz clic en el mapa para agregar el primer vértice.'
        : `<strong>${n} vértice${n !== 1 ? 's' : ''}</strong>${n >= 3 ? ' · Clic en el primer punto o <em>Cerrar polígono</em>.' : ' · Sigue agregando (mínimo 3).'}`);
    } else if (next === 'complete') {
      const km2 = calcAreaKm2(vertices.map(([lat, lng]) => ({ lat, lng })));
      _setStatus(`<strong>Área: ${km2.toFixed(1)} km²</strong> (${vertices.length} vértices) · Haz clic en <strong>Consultar Inciti</strong>.`);
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
    _setStatus('Procesando área de consulta...', 'loading');
    try {
      const entities = await queryArea({ polygons: [polygonInciti], onProgress: msg => _setStatus(msg, 'loading') });
      _buildPreviewPanel(entities);
      _showScreen('preview');
    } catch (err) {
      console.error('[Inciti/venta] Error:', err);
      _setStatus(`Error: ${err.message}`, 'error');
      if (btnQuery) btnQuery.disabled = false;
      if (comunaBtnQuery) comunaBtnQuery.disabled = false;
    }
  }

  function _buildPreviewPanel(entities) {
    const txtCount = document.getElementById('previewCountText');
    if (txtCount) txtCount.textContent = `Inciti encontró ${entities.length} proyectos de venta residencial`;

    const fCommune = document.getElementById('prevFilterCommune');
    const fOwner   = document.getElementById('prevFilterOwner');
    const fName    = document.getElementById('prevFilterName');

    const communes = [...new Set(entities.map(e => e.location?.commune || e.location?.comuna || ''))].filter(Boolean).sort();
    const owners   = [...new Set(entities.map(e => e.developer || e.owner || ''))].filter(Boolean).sort();

    if (fCommune) fCommune.innerHTML = '<option value="">Todas las comunas</option>' + communes.map(c => `<option value="${c}">${c}</option>`).join('');
    if (fOwner)   fOwner.innerHTML   = '<option value="">Todas las inmobiliarias</option>' + owners.map(o => `<option value="${o}">${o}</option>`).join('');
    if (fName) fName.value = '';

    const selectionMap = new Map();
    entities.forEach(e => selectionMap.set(String(e.id || e.name), true));

    function _renderTableRows() {
      const tbody = document.getElementById('previewTableBody');
      if (!tbody) return;
      const nameVal = fName?.value.toLowerCase().trim() || '';
      const commVal = fCommune?.value || '';
      const ownVal  = fOwner?.value || '';
      const filtered = entities.filter(e => {
        const cName = (e.name || '').toLowerCase().includes(nameVal);
        const cComm = !commVal || (e.location?.commune || e.location?.comuna || '') === commVal;
        const cOwn  = !ownVal  || (e.developer || e.owner || '') === ownVal;
        return cName && cComm && cOwn;
      });
      tbody.innerHTML = filtered.map(e => {
        const key = String(e.id || e.name);
        const chk = selectionMap.get(key) ? 'checked' : '';
        return `<tr>
          <td style="padding:8px 12px;"><input type="checkbox" class="prev-item-check" data-id="${key}" ${chk} /></td>
          <td style="padding:8px 12px;"><strong>${e.name || '—'}</strong></td>
          <td style="padding:8px 12px;">${e.location?.commune || e.location?.comuna || '—'}</td>
          <td style="padding:8px 12px;">${e.developer || e.owner || '—'}</td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.prev-item-check').forEach(c => {
        c.addEventListener('change', () => selectionMap.set(String(c.dataset.id), c.checked));
      });
    }

    [fName, fCommune, fOwner].forEach(el => el?.addEventListener('input', _renderTableRows));

    const selectAll = document.getElementById('prevSelectAll');
    if (selectAll) {
      selectAll.checked = true;
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.prev-item-check').forEach(c => {
          c.checked = selectAll.checked;
          selectionMap.set(String(c.dataset.id), selectAll.checked);
        });
      });
    }

    _renderTableRows();

    const btnLoad = document.getElementById('previewBtnLoad');
    if (btnLoad) {
      btnLoad.onclick = () => {
        const selected = entities.filter(e => selectionMap.get(String(e.id || e.name)) === true);
        if (!selected.length) { alert('Debes seleccionar al menos un proyecto para cargar.'); return; }
        const rows = flattenEntities(selected);
        if (!rows.length) {
          console.warn('[Inciti/venta] flattenEntities devolvió 0 filas. Entidades:', selected);
          alert('Los proyectos seleccionados no tienen datos de venta disponibles. Revisa la consola del navegador.');
          return;
        }
        const allowedNames = new Set(selected.map(e => e.name).filter(Boolean));
        if (state && state.raw && state.raw.length > 0) {
          state.raw = state.raw.filter(r => allowedNames.has(r['Edificio']));
          state.filtered = [...state.raw];
        }
        const fileNameEl = document.getElementById('fileName');
        if (fileNameEl) fileNameEl.textContent = `Inciti · ${selected.length} proyectos (${rows.length} registros)`;
        _showScreen('dashboard');
        _clearAll();
        onDataLoaded(rows);
      };
    }
  }

  document.getElementById('btnAreaQuery')?.addEventListener('click', () => { lastScreen = 'draw'; _showScreen('draw'); });
  document.getElementById('btnComunaQuery')?.addEventListener('click', () => { lastScreen = 'comuna'; _showScreen('comuna'); });
  btnCancel?.addEventListener('click', () => _showScreen('dropzone'));
  document.getElementById('previewBtnCancel')?.addEventListener('click', () => _showScreen(lastScreen));
  btnDraw?.addEventListener('click', () => { _clearAll(); _setState('drawing'); });
  btnClear?.addEventListener('click', _clearAll);
  btnClosePoly?.addEventListener('click', _closePoly);
  btnQuery?.addEventListener('click', async () => {
    if (drawState !== 'complete' || vertices.length < 3) return;
    btnQuery.disabled = true;
    await _runQuery(vertices.map(([lat, lng]) => ({ lat, lng })));
  });

  comunaSelect?.addEventListener('change', () => { if (comunaBtnQuery) comunaBtnQuery.disabled = !comunaSelect.value; });
  comunaBtnCancel?.addEventListener('click', () => _showScreen('dropzone'));
  comunaBtnQuery?.addEventListener('click', async () => {
    const comuna = comunaSelect.value;
    if (!comuna) return;
    comunaBtnQuery.disabled = true;
    _setStatus(`Buscando límites geográficos de ${comuna}…`, 'loading');
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(comuna)},+Región+Metropolitana,+Chile&format=json&polygon_geojson=1&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      if (!res.ok) throw new Error('No se pudo conectar con el servicio geográfico.');
      const data = await res.json();
      if (!data?.length || !data[0].geojson) throw new Error(`No se encontró el contorno para la comuna de ${comuna}.`);
      const geojson = data[0].geojson;
      let rawCoords = [];
      if (geojson.type === 'Polygon') {
        rawCoords = geojson.coordinates[0];
      } else if (geojson.type === 'MultiPolygon') {
        let maxLen = 0;
        geojson.coordinates.forEach(poly => { if (poly[0].length > maxLen) { maxLen = poly[0].length; rawCoords = poly[0]; } });
      } else {
        throw new Error('El formato geográfico retornado no es compatible.');
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
      _clearAll();
      vertices = polygon_inciti.map(v => [v.lat, v.lng]);
      areaPoly = L.polygon(vertices, STYLE_POLYGON).addTo(areaMap);
      areaMap.fitBounds(areaPoly.getBounds(), { padding: [20, 20] });
      await _runQuery(polygon_inciti);
    } catch (err) {
      console.error('[Comuna/venta] Error:', err);
      _setStatus(`Error: ${err.message}`, 'error');
      comunaBtnQuery.disabled = false;
    }
  });
}

// ============== Exportar ==============
$('#exportCsvBtn').addEventListener('click', () => {
  import('./data.js').then(({ state }) => {
    if (state.filtered.length === 0) return;
    const cols = state.columns.map(c => c.name);
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const lines = [cols.join(',')];
    for (const r of state.filtered) {
      lines.push(cols.map(c => escape(r[c])).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `datos_filtrados_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

