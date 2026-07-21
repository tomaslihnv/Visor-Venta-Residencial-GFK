import { fetchPois } from './api.js';

// ── Configuración de categorías POI ──────────────────────────────────────
const GROUP_CONFIG = {
  park:        { label: 'Parques',       color: '#22c55e' },
  school:      { label: 'Colegios',      color: '#f59e0b' },
  university:  { label: 'Universidad',   color: '#0891b2' },
  supermarket: { label: 'Supermercados', color: '#8b5cf6' },
  mall:        { label: 'Mall',          color: '#a855f7' },
  pharmacy:    { label: 'Farmacias',     color: '#ec4899' },
  salud:       { label: 'Salud',         color: '#06b6d4' },
  fuel:        { label: 'Combustible',   color: '#f97316' },
  bank:        { label: 'Bancos',        color: '#3b82f6' },
  retail:      { label: 'Retail',        color: '#84cc16' },
  police:      { label: 'Comisaría',     color: '#334155' },
};
const GROUP_ORDER = ['park', 'school', 'university', 'supermarket', 'mall',
                     'pharmacy', 'salud', 'fuel', 'bank', 'retail', 'police'];

// ── Capas base disponibles ────────────────────────────────────────────────
const BASEMAPS = {
  streets: {
    label: 'Calles (OSM)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  voyager: {
    label: 'Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
  },
  light: {
    label: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
  },
  dark: {
    label: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
  },
  satellite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
  },
  hybrid: {
    label: 'Satélite + calles',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    overlayUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
  },
  topo: {
    label: 'Topográfico',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
  },
};

// ── Estado del dibujo ─────────────────────────────────────────────────────
const SNAP_PX = 15; // píxeles para cerrar el polígono al hacer clic en el primer vértice

let drawState = 'idle'; // 'idle' | 'drawing' | 'complete'
let vertices  = [];     // [[lat, lng], ...]

// POI layers
let poiLayerGroups = {};  // group -> L.layerGroup

// Mapa base activo
let currentBase    = null;
let currentOverlay = null;

// Panel resumen sobre el mapa
let summaryPanel = null;

// Capas Leaflet temporales
let vertexMarkers = [];
let edgePolyline  = null;
let rubberLine    = null; // segmento dinámico cursor→último vértice
let polygon       = null;
let snapMarker    = null; // indicador visual de "puedes cerrar aquí"

// ── Inicializar mapa ──────────────────────────────────────────────────────
const map = L.map('barrioMap', {
  doubleClickZoom:     false,
  zoomSnap:             0.1,
  zoomDelta:            0.1,
  wheelPxPerZoomLevel:  400,
}).setView([-33.45, -70.65], 13);

_setBasemap('streets');

// ── Referencias DOM ───────────────────────────────────────────────────────
const btnDraw        = document.getElementById('btnDraw');
const btnClear       = document.getElementById('btnClear');
const btnClose       = document.getElementById('btnClose');
const btnQuery       = document.getElementById('btnQuery');
const instruction    = document.getElementById('barrioInstruction');
const instructionTxt = document.getElementById('barrioInstructionText');
const resultsPanel   = document.getElementById('barrioResults');
const mapWrap        = document.getElementById('barrioMapWrap');

// ── Mapa base ─────────────────────────────────────────────────────────────
function _setBasemap(key) {
  if (currentBase)    { map.removeLayer(currentBase);    currentBase    = null; }
  if (currentOverlay) { map.removeLayer(currentOverlay); currentOverlay = null; }

  const bm = BASEMAPS[key];
  if (!bm) return;

  currentBase = L.tileLayer(bm.url, {
    attribution: bm.attribution,
    maxZoom: 19,
    crossOrigin: 'anonymous',
  }).addTo(map);

  if (bm.overlayUrl) {
    currentOverlay = L.tileLayer(bm.overlayUrl, {
      attribution: '',
      maxZoom: 19,
      crossOrigin: 'anonymous',
    }).addTo(map);
  }
}

// ── Helpers visuales ──────────────────────────────────────────────────────
const STYLE_VERTEX  = { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 };
const STYLE_FIRST   = { radius: 7, color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1, weight: 2 };
const STYLE_EDGE    = { color: '#3b82f6', weight: 2, opacity: 0.9 };
const STYLE_RUBBER  = { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '5,5' };
const STYLE_POLYGON = { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 };

function _addVertexMarker(latlng, isFirst = false) {
  const style = isFirst ? STYLE_FIRST : STYLE_VERTEX;
  const m = L.circleMarker(latlng, style).addTo(map);
  vertexMarkers.push(m);
  return m;
}

function _updateEdge() {
  if (edgePolyline) map.removeLayer(edgePolyline);
  if (vertices.length > 1) {
    edgePolyline = L.polyline(vertices, STYLE_EDGE).addTo(map);
  }
}

function _clearTempLayers() {
  vertexMarkers.forEach(m => map.removeLayer(m));
  vertexMarkers = [];
  if (edgePolyline) { map.removeLayer(edgePolyline); edgePolyline = null; }
  if (rubberLine)   { map.removeLayer(rubberLine);   rubberLine   = null; }
  if (snapMarker)   { map.removeLayer(snapMarker);   snapMarker   = null; }
}

function _clearPolygon() {
  if (polygon) { map.removeLayer(polygon); polygon = null; }
}

// ── Máquina de estados ────────────────────────────────────────────────────
function _setState(next) {
  drawState = next;
  mapWrap.classList.toggle('drawing', next === 'drawing');

  btnDraw.disabled  = next === 'drawing' || next === 'complete';
  btnClear.disabled = next === 'idle';
  btnClose.disabled = next !== 'drawing' || vertices.length < 3;
  btnQuery.disabled = next !== 'complete';

  if (next === 'idle') {
    _setInstruction('idle');
  } else if (next === 'drawing') {
    _setInstruction('drawing');
  } else if (next === 'complete') {
    _setInstruction('ready');
  }
}

function _setInstruction(type, extra = {}) {
  instruction.className = `barrio-instruction ${type === 'idle' ? '' : type}`.trim();
  const icons = { idle: '✏️', drawing: '📍', ready: '✅', loading: '' };

  const iconEl = instruction.querySelector('.barrio-instruction-icon');
  if (type === 'loading') {
    iconEl.innerHTML = '<span class="barrio-spinner"></span>';
  } else {
    iconEl.textContent = icons[type] ?? '✏️';
  }

  if (type === 'idle') {
    instructionTxt.innerHTML = 'Haz clic en <strong>Dibujar zona</strong> y luego marca los vértices en el mapa. Cierra el polígono haciendo clic sobre el primer punto.';
  } else if (type === 'drawing') {
    const n = vertices.length;
    instructionTxt.innerHTML = n === 0
      ? 'Haz clic en el mapa para agregar el primer vértice.'
      : `<span class="vertex-count">${n} vértice${n !== 1 ? 's' : ''}</span> · ${n >= 3 ? 'Clic en el <strong>primer punto</strong> o usa <strong>Cerrar polígono</strong> para terminar.' : 'Sigue agregando vértices (mínimo 3).'}`;
  } else if (type === 'ready') {
    instructionTxt.innerHTML = `<strong>${vertices.length} vértices</strong> · Zona lista. Haz clic en <strong>Consultar POIs</strong> para analizar el barrio.`;
  } else if (type === 'loading') {
    instructionTxt.innerHTML = extra.text ?? 'Consultando Inciti…';
  }
}

// ── Dibujo ────────────────────────────────────────────────────────────────
function startDraw() {
  _clearTempLayers();
  _clearPolygon();
  vertices = [];
  _setState('drawing');
}

function closePoly() {
  if (vertices.length < 3) return;
  _clearTempLayers();

  polygon = L.polygon(vertices, STYLE_POLYGON).addTo(map);
  map.fitBounds(polygon.getBounds(), { padding: [30, 30] });
  _setState('complete');
}

function clearAll() {
  _clearTempLayers();
  _clearPolygon();
  vertices = [];
  _setState('idle');
  _setResults(null);
}

// ── Eventos del mapa ──────────────────────────────────────────────────────
map.on('click', (e) => {
  if (drawState !== 'drawing') return;

  const latlng = [e.latlng.lat, e.latlng.lng];

  // Comprobar si el clic está cerca del primer vértice para cerrar
  if (vertices.length >= 3) {
    const firstPt  = map.latLngToContainerPoint(vertices[0]);
    const clickPt  = map.latLngToContainerPoint(latlng);
    if (firstPt.distanceTo(clickPt) < SNAP_PX) {
      closePoly();
      return;
    }
  }

  vertices.push(latlng);
  _addVertexMarker(latlng, vertices.length === 1);
  _updateEdge();
  _setState('drawing'); // refresca botones e instrucción
});

map.on('mousemove', (e) => {
  if (drawState !== 'drawing' || vertices.length === 0) return;

  const cursor = [e.latlng.lat, e.latlng.lng];
  if (rubberLine) map.removeLayer(rubberLine);
  rubberLine = L.polyline([vertices[vertices.length - 1], cursor], STYLE_RUBBER).addTo(map);

  // Snap visual: resaltar primer vértice cuando el cursor está cerca
  if (vertices.length >= 3) {
    const firstPt  = map.latLngToContainerPoint(vertices[0]);
    const cursorPt = map.latLngToContainerPoint(cursor);
    const nearFirst = firstPt.distanceTo(cursorPt) < SNAP_PX;

    if (nearFirst && !snapMarker) {
      if (vertexMarkers[0]) vertexMarkers[0].setStyle(STYLE_FIRST);
    } else if (!nearFirst && snapMarker === null && vertexMarkers[0]) {
      vertexMarkers[0].setStyle(STYLE_VERTEX);
    }
  }
});

// ESC cancela el dibujo
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawState === 'drawing') clearAll();
});

// ── Botones ───────────────────────────────────────────────────────────────
btnDraw.addEventListener('click',  startDraw);
btnClear.addEventListener('click', clearAll);
btnClose.addEventListener('click', closePoly);

btnQuery.addEventListener('click', async () => {
  if (drawState !== 'complete' || vertices.length < 3) return;

  const polygon_inciti = vertices.map(([lat, lng]) => ({ lat, lng }));

  _setInstruction('loading', { text: 'Consultando POIs del barrio…' });
  btnQuery.disabled = true;

  try {
    const payload = await fetchPois(polygon_inciti, {
      onProgress: (msg) => _setInstruction('loading', { text: msg }),
    });

    // Mostrar respuesta cruda para explorar la estructura
    _setResults(payload);
    _setInstruction('ready');
  } catch (err) {
    console.error('[barrio] Error al consultar POIs:', err);
    _setResults(null, err.message);
    _setInstruction('ready');
  } finally {
    btnQuery.disabled = false;
  }
});

// ── POI — marcadores en el mapa ───────────────────────────────────────────
function _clearPois() {
  Object.values(poiLayerGroups).forEach(lg => lg.remove());
  poiLayerGroups = {};
  if (summaryPanel) { summaryPanel.remove(); summaryPanel = null; }
}

function _renderPois(poi) {
  _clearPois();
  const { items, byGroup } = poi;

  // Un LayerGroup por categoría
  Object.keys(byGroup).forEach(group => {
    poiLayerGroups[group] = L.layerGroup().addTo(map);
  });

  items.forEach(item => {
    if (!item.lat || !item.lng) return;
    const cfg = GROUP_CONFIG[item.group] ?? { label: item.group, color: '#94a3b8' };
    const m = L.circleMarker([item.lat, item.lng], {
      radius: 7,
      color: '#fff',
      weight: 1.5,
      fillColor: cfg.color,
      fillOpacity: 0.85,
    });
    m._poiName  = item.name || '';
    m._poiColor = cfg.color;
    if (item.name) {
      m.bindTooltip(item.name, { permanent: false, direction: 'top', offset: [0, -5] });
    }
    poiLayerGroups[item.group]?.addLayer(m);
  });
}

function _toggleGroup(group, visible) {
  const lg = poiLayerGroups[group];
  if (!lg) return;
  if (visible) lg.addTo(map); else lg.remove();
}

function _setGroupLabelsVisible(group, visible) {
  poiLayerGroups[group]?.eachLayer(m => {
    if (!m._poiName) return;
    m.unbindTooltip();
    const content = visible
      ? `<span class="poi-label-dot" style="background:${m._poiColor}"></span>${m._poiName}`
      : m._poiName;
    m.bindTooltip(content, {
      permanent: visible,
      direction: 'top',
      offset: [0, -10],
      className: visible ? 'poi-label' : '',
    });
  });
}

// ── POI — panel de leyenda en el sidebar ─────────────────────────────────
function _buildPoiPanel(poi) {
  const { total, byGroup } = poi;
  const maxCount = Math.max(...Object.values(byGroup).filter(Boolean));
  const activeGroups = GROUP_ORDER.filter(g => (byGroup[g] ?? 0) > 0);

  const rows = activeGroups.map(group => {
    const cfg   = GROUP_CONFIG[group] ?? { label: group, color: '#94a3b8' };
    const count = byGroup[group] ?? 0;
    const pct   = maxCount > 0 ? ((count / maxCount) * 100).toFixed(0) : 0;
    return `
      <div class="poi-cat-row">
        <label class="poi-cat-label-wrap">
          <input type="checkbox" class="poi-cat-check" data-group="${group}" checked />
          <span class="poi-cat-dot" style="background:${cfg.color}"></span>
          <span class="poi-cat-name">${cfg.label}</span>
          <span class="poi-cat-count">${count}</span>
        </label>
        <div class="poi-cat-extra">
          <div class="poi-cat-controls">
            <input type="range" class="poi-cat-opacity" data-group="${group}"
                   min="0.1" max="1" step="0.05" value="0.85"
                   style="accent-color:${cfg.color}" />
            <label class="poi-cat-labels-wrap">
              <input type="checkbox" class="poi-cat-labels" data-group="${group}" />
              <span>Etiquetas</span>
            </label>
          </div>
          <div class="poi-cat-bar">
            <div class="poi-cat-bar-fill" style="width:${pct}%;background:${cfg.color}"></div>
          </div>
        </div>
      </div>`;
  }).join('');

  resultsPanel.innerHTML = `
    <div class="poi-summary">
      <span class="poi-summary-total">${total}</span>
      <span class="poi-summary-label">POIs en la zona</span>
    </div>
    <div class="poi-controls">
      <div class="poi-toggle-row">
        <label class="poi-labels-wrap">
          <input type="checkbox" id="poiSummaryToggle" checked />
          <span>Resumen en mapa</span>
        </label>
      </div>
      <div class="poi-toggle-row">
        <button class="poi-toggle-btn" id="poiShowAll">Mostrar todos</button>
        <button class="poi-toggle-btn" id="poiHideAll">Ocultar todos</button>
      </div>
    </div>
    <div class="poi-legend" id="poiLegend">${rows}</div>`;

  // Toggle resumen en mapa
  document.getElementById('poiSummaryToggle').addEventListener('change', (e) => {
    if (summaryPanel) summaryPanel.style.display = e.target.checked ? '' : 'none';
  });

  // Mostrar / ocultar todos
  document.getElementById('poiShowAll').addEventListener('click', () => {
    document.querySelectorAll('.poi-cat-check').forEach(cb => {
      cb.checked = true;
      _toggleGroup(cb.dataset.group, true);
    });
  });
  document.getElementById('poiHideAll').addEventListener('click', () => {
    document.querySelectorAll('.poi-cat-check').forEach(cb => {
      cb.checked = false;
      _toggleGroup(cb.dataset.group, false);
    });
  });

  // Visibilidad y etiquetas por categoría (delegación en el legend)
  document.getElementById('poiLegend').addEventListener('change', (e) => {
    const { group } = e.target.dataset;
    if (e.target.classList.contains('poi-cat-check')) {
      _toggleGroup(group, e.target.checked);
    }
    if (e.target.classList.contains('poi-cat-labels')) {
      _setGroupLabelsVisible(group, e.target.checked);
    }
  });

  // Opacidad por categoría — actualiza marcadores y fila del resumen
  document.getElementById('poiLegend').addEventListener('input', (e) => {
    if (!e.target.classList.contains('poi-cat-opacity')) return;
    const { group } = e.target.dataset;
    const op = +e.target.value;
    poiLayerGroups[group]?.eachLayer(m => {
      m.setStyle({ fillOpacity: op, opacity: Math.min(op * 1.5, 1) });
    });
    if (summaryPanel) {
      const row = summaryPanel.querySelector(`.bs-row[data-group="${group}"]`);
      if (row) row.style.opacity = op;
    }
  });
}

// ── Panel resumen flotante sobre el mapa ─────────────────────────────────
function _buildSummaryPanel(poi) {
  if (summaryPanel) { summaryPanel.remove(); summaryPanel = null; }

  const { total, byGroup } = poi;
  const activeGroups = GROUP_ORDER.filter(g => (byGroup[g] ?? 0) > 0);

  const rows = activeGroups.map(group => {
    const cfg = GROUP_CONFIG[group] ?? { label: group, color: '#94a3b8' };
    return `
      <div class="bs-row" data-group="${group}">
        <span class="bs-dot" style="background:${cfg.color}"></span>
        <span class="bs-name">${cfg.label}</span>
        <span class="bs-count">${byGroup[group]}</span>
      </div>`;
  }).join('');

  summaryPanel = document.createElement('div');
  summaryPanel.className = 'barrio-summary';
  summaryPanel.innerHTML = `
    <div class="bs-header">
      <div>
        <span class="bs-total">${total}</span>
        <span class="bs-subtitle">POIs en la zona</span>
      </div>
      <button class="bs-close" title="Cerrar">✕</button>
    </div>
    <div class="bs-divider"></div>
    <div class="bs-rows">${rows}</div>`;

  mapWrap.appendChild(summaryPanel);

  summaryPanel.querySelector('.bs-close').addEventListener('click', () => {
    summaryPanel.style.display = 'none';
    const toggle = document.getElementById('poiSummaryToggle');
    if (toggle) toggle.checked = false;
  });
}

// ── Panel de resultados ───────────────────────────────────────────────────
function _setResults(payload, errorMsg = null) {
  if (errorMsg) {
    resultsPanel.innerHTML = `
      <p class="barrio-results-title">Error</p>
      <p style="font-size:13px;color:#ef4444;">${errorMsg}</p>`;
    return;
  }

  if (!payload) {
    _clearPois();
    resultsPanel.innerHTML = '<p class="barrio-results-empty">Los resultados de la API aparecerán aquí.</p>';
    return;
  }

  console.log('[barrio] Respuesta completa de la API:', payload);

  if (payload.poi?.items?.length) {
    _renderPois(payload.poi);
    _buildPoiPanel(payload.poi);
    _buildSummaryPanel(payload.poi);
  } else {
    resultsPanel.innerHTML = '<p class="barrio-results-empty">No se encontraron POIs en la zona.</p>';
  }
}

// Selector de mapa base
document.getElementById('barrioBasemap').addEventListener('change', (e) => {
  _setBasemap(e.target.value);
});

// Estado inicial
_setState('idle');
