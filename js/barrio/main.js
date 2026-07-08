import { fetchPois } from './api.js';

// ── Estado del dibujo ─────────────────────────────────────────────────────
const SNAP_PX = 15; // píxeles para cerrar el polígono al hacer clic en el primer vértice

let drawState = 'idle'; // 'idle' | 'drawing' | 'complete'
let vertices  = [];     // [[lat, lng], ...]

// Capas Leaflet temporales
let vertexMarkers = [];
let edgePolyline  = null;
let rubberLine    = null; // segmento dinámico cursor→último vértice
let polygon       = null;
let snapMarker    = null; // indicador visual de "puedes cerrar aquí"

// ── Inicializar mapa ──────────────────────────────────────────────────────
const map = L.map('barrioMap', { doubleClickZoom: false }).setView([-33.45, -70.65], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// ── Referencias DOM ───────────────────────────────────────────────────────
const btnDraw        = document.getElementById('btnDraw');
const btnClear       = document.getElementById('btnClear');
const btnClose       = document.getElementById('btnClose');
const btnQuery       = document.getElementById('btnQuery');
const instruction    = document.getElementById('barrioInstruction');
const instructionTxt = document.getElementById('barrioInstructionText');
const resultsPanel   = document.getElementById('barrioResults');
const mapWrap        = document.getElementById('barrioMapWrap');

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

// ── Panel de resultados ───────────────────────────────────────────────────
function _setResults(payload, errorMsg = null) {
  if (errorMsg) {
    resultsPanel.innerHTML = `
      <p class="barrio-results-title">Error</p>
      <p style="font-size:13px;color:#ef4444;">${errorMsg}</p>`;
    return;
  }

  if (!payload) {
    resultsPanel.innerHTML = '<p class="barrio-results-empty">Los resultados de la API aparecerán aquí.</p>';
    return;
  }

  const json = JSON.stringify(payload, null, 2);

  // Log en consola para inspección cómoda
  console.log('[barrio] Respuesta completa de la API:', payload);

  resultsPanel.innerHTML = `
    <p class="barrio-results-title">Respuesta API Inciti</p>
    <button class="barrio-copy-btn" id="btnCopyJson">Copiar JSON</button>
    <pre class="barrio-raw-json">${_esc(json)}</pre>`;

  document.getElementById('btnCopyJson').addEventListener('click', async () => {
    await navigator.clipboard.writeText(json);
    const btn = document.getElementById('btnCopyJson');
    const prev = btn.textContent;
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = prev; }, 1800);
  });
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Estado inicial
_setState('idle');
