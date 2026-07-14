import { $, $$ } from '../core/utils.js';
import { resetFilters } from '../core/filters.js';
import { exportCsv, exportJson } from '../core/export.js';
import { initFilterIO } from '../core/filter-io.js';
import { state, FILTERS, KPIS, PROYECTOS_METRICS, SVP, CRUZ, DISTRIB_COLS, MAP, COMPARATIVA, CSV_FILENAME, onDataLoaded } from './data.js';
import { initMpPanel } from './miProyecto.js';
import { queryArea, flattenEntities, calcAreaKm2 } from './api.js';

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

// ── Consulta Inciti por área (mapa inline) ────────────────────────────────
// ── Core de Integración Multifamily: Área, Particionamiento, Previsualización y Comunas ──
{
  const SNAP_PX = 15;
  const STYLE_VERTEX  = { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 };
  const STYLE_FIRST   = { radius: 7, color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1, weight: 2 };
  const STYLE_EDGE    = { color: '#3b82f6', weight: 2, opacity: 0.9 };
  const STYLE_RUBBER  = { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '5,5' };
  const STYLE_POLYGON = { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 };

  // Comunas de la Región Metropolitana para el Selector Dinámico
  const COMUNAS_RM = [
    "Cerrillos", "Cerro Navia", "Conchalí", "El Bosque", "Estación Central", "Huechuraba", 
    "Independencia", "La Cisterna", "La Florida", "La Granja", "La Pintana", "La Reina", 
    "Las Condes", "Lo Barnechea", "Lo Espejo", "Lo Prado", "Macul", "Maipú", "Ñuñoa", 
    "Pedro Aguirre Cerda", "Peñalolén", "Providencia", "Pudahuel", "Quilicura", "Quinta Normal", 
    "Recoleta", "Renca", "San Joaquín", "San Miguel", "San Ramón", "Santiago", "Vitacura",
    "Puente Alto", "Pirque", "San José de Maipo", "San Bernardo", "Buin", "Calera de Tango", 
    "Paine", "Colina", "Lampa", "Tiltil", "Melipilla", "Alhué", "Curacaví", "María Pinto", 
    "San Pedro", "Talagante", "El Monte", "Isla de Maipo", "Padre Hurtado", "Peñaflor"
  ].sort();

  let areaMap = null, drawState = 'idle', vertices = [], currentRawEntities = [], lastScreen = 'dropzone';
  let vertexMarkers = [], edgePolyline = null, rubberLine = null, areaPoly = null;

  // DOM Elements
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

  // Rellenar Selector de Comunas
  if (comunaSelect && comunaSelect.children.length <= 1) {
    COMUNAS_RM.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      comunaSelect.appendChild(opt);
    });
  }

  // Administrador de pantallas unificado
  function _showScreen(screen) {
    [dropzone, drawContainer, previewContainer, dashboard].forEach(el => el?.classList.add('hidden'));
    comunaContainer?.classList.add('hidden');

    if (screen === 'dropzone') dropzone?.classList.remove('hidden');
    if (screen === 'dashboard') dashboard?.classList.remove('hidden');
    
    if (screen === 'draw') {
      drawContainer?.classList.remove('hidden');
      _initMapIfNeeded();
      _setState('idle');
    }
    if (screen === 'comuna') {
      drawContainer?.classList.remove('hidden'); // Reutiliza el background del mapa
      _initMapIfNeeded();
      _clearAll();
      comunaContainer?.classList.remove('hidden');
      _setStatus('Selecciona una comuna y presiona <strong>Consultar</strong>.');
    }
    if (screen === 'preview') {
      previewContainer?.classList.remove('hidden');
    }
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
      _setStatus(n === 0
        ? 'Haz clic en el mapa para agregar el primer vértice.'
        : `<strong>${n} vértice${n !== 1 ? 's' : ''}</strong>${n >= 3 ? ' · Clic en el primer punto o <em>Cerrar polígono</em>.' : ' · Sigue agregando (mínimo 3).'}`);
    } else if (next === 'complete') {
      const areaKm2 = calcAreaKm2(vertices.map(([lat, lng]) => ({ lat, lng })));
      _setStatus(`<strong>Área: ${areaKm2.toFixed(1)} km²</strong> (${vertices.length} vértices) · Zona lista. Haz clic en <strong>Consultar Inciti</strong>.`);
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

      areaMap.on('click', (e) => {
        if (drawState !== 'drawing') return;
        const latlng = [e.latlng.lat, e.latlng.lng];
        if (vertices.length >= 3) {
          const fp = areaMap.latLngToContainerPoint(vertices[0]);
          const cp = areaMap.latLngToContainerPoint(latlng);
          if (fp.distanceTo(cp) < SNAP_PX) { _closePoly(); return; }
        }
        vertices.push(latlng);
        vertexMarkers.push(
          L.circleMarker(latlng, vertices.length === 1 ? STYLE_FIRST : STYLE_VERTEX).addTo(areaMap)
        );
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
    } else {
      areaMap.invalidateSize();
    }
  }

  // ── Lógica de Orquestación de Consultas ──
  async function _runQuery(polygonInciti) {
    _setStatus('Procesando área de consulta...', 'loading');
    try {
      const entities = await queryArea({
        polygons: [polygonInciti],
        onProgress: msg => _setStatus(msg, 'loading')
      });
      currentRawEntities = entities;
      _buildPreviewPanel(entities);
      _showScreen('preview');
    } catch (err) {
      console.error('[Inciti Flow] Error:', err);
      _setStatus(`Error: ${err.message}`, 'error');
      if (btnQuery) btnQuery.disabled = false;
      if (comunaBtnQuery) comunaBtnQuery.disabled = false;
    }
  }

  // ── Render y Filtros Dinámicos del Panel Preview (Corregido con String Keys) ──
  function _buildPreviewPanel(entities) {
    const txtCount = document.getElementById('previewCountText');
    if (txtCount) txtCount.textContent = `Inciti encontró ${entities.length} multifamily`;

    const fCommune = document.getElementById('prevFilterCommune');
    const fOwner   = document.getElementById('prevFilterOwner');
    const fAdmin   = document.getElementById('prevFilterAdmin');
    const fName    = document.getElementById('prevFilterName');

    // Extraer universos únicos para filtros dropdown
    const communes = [...new Set(entities.map(e => e.location?.commune || e.location?.comuna || ''))].filter(Boolean).sort();
    const owners   = [...new Set(entities.map(e => e.owner || ''))].filter(Boolean).sort();
    const admins   = [...new Set(entities.map(e => e.administrator || ''))].filter(Boolean).sort();

    if (fCommune) fCommune.innerHTML = '<option value="">Todas las comunas</option>' + communes.map(c => `<option value="${c}">${c}</option>`).join('');
    if (fOwner) fOwner.innerHTML = '<option value="">Todos los dueños</option>' + owners.map(o => `<option value="${o}">${o}</option>`).join('');
    if (fAdmin) fAdmin.innerHTML = '<option value="">Todos los administradores</option>' + admins.map(a => `<option value="${a}">${a}</option>`).join('');
    if (fName) fName.value = '';

    // Estado local de selección: Forzamos la llave a ser estrictamente un STRING
    const selectionMap = new Map();
    entities.forEach(e => {
      const key = String(e.id || e.name);
      selectionMap.set(key, true);
    });

    function _renderTableRows() {
      const tbody = document.getElementById('previewTableBody');
      if (!tbody) return;

      const nameVal = fName?.value.toLowerCase().trim() || '';
      const commVal = fCommune?.value || '';
      const ownVal  = fOwner?.value || '';
      const admVal  = fAdmin?.value || '';

      const filtered = entities.filter(e => {
        const cName = (e.name || '').toLowerCase().includes(nameVal);
        const cComm = !commVal || (e.location?.commune || e.location?.comuna || '') === commVal;
        const cOwn  = !ownVal  || (e.owner || '') === ownVal;
        const cAdm  = !admVal  || (e.administrator || '') === admVal;
        return cName && cComm && cOwn && cAdm;
      });

      tbody.innerHTML = filtered.map(e => {
        const key = String(e.id || e.name); // Forzado a String
        const isChecked = selectionMap.get(key) ? 'checked' : '';
        return `
          <tr>
            <td><input type="checkbox" class="prev-item-check" data-id="${key}" ${isChecked} /></td>
            <td><strong>${e.name || 'Sin nombre'}</strong></td>
            <td>${e.location?.commune || e.location?.comuna || '—'}</td>
            <td>${e.owner || '—'}</td>
            <td>${e.administrator || '—'}</td>
          </tr>
        `;
      }).join('');

      // Escuchadores de los checkboxes individuales
      tbody.querySelectorAll('.prev-item-check').forEach(chk => {
        chk.addEventListener('change', () => {
          // chk.dataset.id siempre es un String, calza perfecto con nuestro selectionMap
          selectionMap.set(String(chk.dataset.id), chk.checked);
        });
      });
    }

    // Eventos reactivos para filtros
    [fName, fCommune, fOwner, fAdmin].forEach(el => el?.addEventListener('input', _renderTableRows));

    // Checkbox Maestro (Seleccionar Todos)
    const selectAll = document.getElementById('prevSelectAll');
    if (selectAll) {
      selectAll.checked = true;
      selectAll.addEventListener('change', () => {
        const itemChecks = document.querySelectorAll('.prev-item-check');
        itemChecks.forEach(chk => {
          chk.checked = selectAll.checked;
          selectionMap.set(String(chk.dataset.id), selectAll.checked);
        });
      });
    }

    _renderTableRows();

    // Evento del botón Cargar
    const btnLoad = document.getElementById('previewBtnLoad');
    if (btnLoad) {
      btnLoad.onclick = () => {
        // Filtrar usando estrictamente String(e.id || e.name)
        const selectedEntities = entities.filter(e => {
          const key = String(e.id || e.name);
          return selectionMap.get(key) === true; 
        });

        if (!selectedEntities.length) {
          alert('Debes seleccionar al menos un proyecto multifamily para cargar.');
          return;
        }

        const rows = flattenEntities(selectedEntities);

        if (state && typeof state === 'object') {
          const allowedProjectNames = new Set(selectedEntities.map(e => e.name).filter(Boolean));
          
          state.excludedProjects = new Set();
          entities.forEach(e => {
            if (e.name && !allowedProjectNames.has(e.name)) {
              state.excludedProjects.add(e.name);
            }
          });

          if (state.raw && state.raw.length > 0) {
            state.raw = state.raw.filter(r => allowedProjectNames.has(r['Proyecto']));
            state.filtered = [...state.raw];
          }
        }

        const fileNameEl = document.getElementById('fileName');
        if (fileNameEl) {
          fileNameEl.textContent = `Inciti · ${selectedEntities.length} proyectos (${rows.length} registros)`;
        }

        _showScreen('dashboard');
        _clearAll();
        
        onDataLoaded(rows);
      };
    }
  }

  // ── Eventos de Navegación del Panel Superior ──
  document.getElementById('btnAreaQuery')?.addEventListener('click', () => {
    lastScreen = 'draw';
    _showScreen('draw');
  });

  document.getElementById('btnComunaQuery')?.addEventListener('click', () => {
    lastScreen = 'comuna';
    _showScreen('comuna');
  });

  btnCancel?.addEventListener('click', () => _showScreen('dropzone'));
  document.getElementById('previewBtnCancel')?.addEventListener('click', () => _showScreen(lastScreen));

  // Controles de dibujo manual
  btnDraw?.addEventListener('click',      () => { _clearAll(); _setState('drawing'); });
  btnClear?.addEventListener('click',     _clearAll);
  btnClosePoly?.addEventListener('click', _closePoly);

  btnQuery?.addEventListener('click', async () => {
    if (drawState !== 'complete' || vertices.length < 3) return;
    btnQuery.disabled = true;
    const polygon_inciti = vertices.map(([lat, lng]) => ({ lat, lng }));
    await _runQuery(polygon_inciti);
  });

  // ── Flujo Consultar por Comuna (Nominatim OpenStreetMap) ──
  comunaSelect?.addEventListener('change', () => {
    if (comunaBtnQuery) comunaBtnQuery.disabled = !comunaSelect.value;
  });

  comunaBtnCancel?.addEventListener('click', () => _showScreen('dropzone'));

  comunaBtnQuery?.addEventListener('click', async () => {
    const comuna = comunaSelect.value;
    if (!comuna) return;

    comunaBtnQuery.disabled = true;
    _setStatus(`Buscando límites geográficos de ${comuna}…`, 'loading');

    try {
      // Query enfocada en Chile para asegurar exactitud
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(comuna)},+Región+Metropolitana,+Chile&format=json&polygon_geojson=1&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      if (!res.ok) throw new Error('No se pudo conectar con el servicio geográfico.');

      const data = await res.json();
      if (!data || !data.length || !data[0].geojson) {
        throw new Error(`No se encontró el contorno oficial para la comuna de ${comuna}.`);
      }

      const geojson = data[0].geojson;
      let rawCoords = [];

      if (geojson.type === 'Polygon') {
        rawCoords = geojson.coordinates[0];
      } else if (geojson.type === 'MultiPolygon') {
        // Tomar el anillo con más vértices en caso de islas geográficas
        let maxLen = 0;
        geojson.coordinates.forEach(poly => {
          if (poly[0].length > maxLen) {
            maxLen = poly[0].length;
            rawCoords = poly[0];
          }
        });
      } else {
        throw new Error('El formato geográfico retornado no es compatible.');
      }

      // Convertir a formato Inciti { lat, lng }
      let polygon_inciti = rawCoords.map(coord => ({ lat: coord[1], lng: coord[0] }));

      // Cerrar polígono si Nominatim no lo entrega cerrado explícitamente
      if (polygon_inciti.length > 0) {
        const first = polygon_inciti[0];
        const last = polygon_inciti[polygon_inciti.length - 1];
        if (first.lat !== last.lat || first.lng !== last.lng) {
          polygon_inciti.push({ ...first });
        }
      }

      // Simplificación algorítmica para cumplir la restricción estricta de < 100 vértices de Inciti
      if (polygon_inciti.length > 80) {
        const step = Math.ceil(polygon_inciti.length / 80);
        const simplified = [];
        for (let i = 0; i < polygon_inciti.length - 1; i += step) {
          simplified.push(polygon_inciti[i]);
        }
        simplified.push(polygon_inciti[polygon_inciti.length - 1]); // Asegurar cierre
        polygon_inciti = simplified;
      }

      // Renderizar el contorno recuperado en el mapa para feedback visual del analista
      _clearAll();
      vertices = polygon_inciti.map(v => [v.lat, v.lng]);
      areaPoly = L.polygon(vertices, STYLE_POLYGON).addTo(areaMap);
      areaMap.fitBounds(areaPoly.getBounds(), { padding: [20, 20] });

      // Ejecutar consulta principal pasándole la lógica automática de grillas/particiones
      await _runQuery(polygon_inciti);

    } catch (err) {
      console.error('[Comuna Flow] Error:', err);
      _setStatus(`Error Comuna: ${err.message}`, 'error');
      comunaBtnQuery.disabled = false;
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
