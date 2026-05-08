import { state } from './data.js'; // Ajusta la ruta si renombraste el archivo a data.js
import { $, fmt } from './utils.js';
import { mp } from './miProyecto.js';

// ============== Cache y estado ==============
const cache = new Map();
const geoStatus = { total: 0, done: 0, running: false };
let mapMode    = 'general'; // 'general' | 'precio'
let heatMetric = 'ufm2';   // 'ufm2' | 'renta'
let mapInitialized = false;

export function resetMapOnLoad() {
  mapInitialized = false;
  geoStatus.total = 0;
  geoStatus.done = 0;
  geoStatus.running = false;
  lastPolyPoints = [];
  if (persistentPoly) { persistentPoly.remove(); persistentPoly = null; }
  document.getElementById('mapClearPolyBtn')?.classList.add('hidden');
  document.getElementById('mapUndoBtn')?.classList.add('hidden');
}

// ============== Helpers ==============
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function findAddressCol() {
  const keywords = ['direccion', 'address', 'domicilio', 'ubicacion', 'calle'];
  return state.columns.find(c => keywords.some(k => norm(c.name).includes(k)));
}

function hasDirectCoords() {
  return state.columns.some(c => c.name === '__lat');
}

function collectPoints(rows) {
  const buildings = new Map();
  if (hasDirectCoords()) {
    // Para renta, la agrupación principal es por 'Proyecto'
    const proyCol = state.columns.find(c =>
      ['proyecto', 'edificio', 'nombre', 'building'].some(k => norm(c.name).includes(k))
    )?.name;
    for (const r of rows) {
      const lat = Number(r['__lat']);
      const lng = Number(r['__lng']);
      if (isNaN(lat) || isNaN(lng)) continue;
      const key = proyCol ? String(r[proyCol] ?? '').trim() : `${lat},${lng}`;
      if (!key) continue;
      if (!buildings.has(key)) buildings.set(key, { lat, lng, rows: [] });
      buildings.get(key).rows.push(r);
    }
  } else {
    const col = findAddressCol();
    if (col) {
      for (const r of rows) {
        const addr = String(r[col.name] ?? '').trim();
        const coords = cache.get(addr);
        if (!coords) continue;
        if (!buildings.has(addr)) buildings.set(addr, { ...coords, rows: [] });
        buildings.get(addr).rows.push(r);
      }
    }
  }
  return [...buildings.values()];
}

function findUfm2Col() {
  return state.columns.find(c => norm(c.name).includes('uf/m') || norm(c.name).includes('uf / m'))?.name ?? null;
}

function findRentaCol() {
  return state.columns.find(c => norm(c.name).includes('renta uf') || norm(c.name).includes('precio (uf'))?.name ?? null;
}

function getHeatCol() {
  return heatMetric === 'renta' ? findRentaCol() : findUfm2Col();
}

function getHeatLabel() {
  return heatMetric === 'renta' ? 'Renta UF' : 'UF/m²';
}

// Color gradiente rojo (barato) → amarillo → verde → azul (caro)
function priceToColor(value, min, max) {
  if (max === min) return '#94a3b8';
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  let r, g, b;
  if (t < 1 / 3) {
    const s = t * 3;
    r = Math.round(239 + (245 - 239) * s);
    g = Math.round(68  + (158 - 68)  * s);
    b = Math.round(68  + (11  - 68)  * s);
  } else if (t < 2 / 3) {
    const s = (t - 1 / 3) * 3;
    r = Math.round(245 + (34  - 245) * s);
    g = Math.round(158 + (197 - 158) * s);
    b = Math.round(11  + (94  - 11)  * s);
  } else {
    const s = (t - 2 / 3) * 3;
    r = Math.round(34  + (59  - 34)  * s);
    g = Math.round(197 + (130 - 197) * s);
    b = Math.round(94  + (246 - 94)  * s);
  }
  return `rgb(${r},${g},${b})`;
}

async function fetchGeocode(addr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============== Geocodificación ==============
export async function geocodeData() {
  if (hasDirectCoords()) { refreshStatus(); return; }
  const col = findAddressCol();
  if (!col || geoStatus.running) return;

  const addrs = [...new Set(
    state.raw.map(r => String(r[col.name] ?? '').trim()).filter(a => a.length > 3)
  )];
  const pending = addrs.filter(a => !cache.has(a));
  if (!pending.length) return;

  geoStatus.total = pending.length;
  geoStatus.done = 0;
  geoStatus.running = true;
  refreshStatus();

  for (let i = 0; i < pending.length; i++) {
    cache.set(pending[i], await fetchGeocode(pending[i]));
    geoStatus.done = i + 1;
    refreshStatus();
    if (i < pending.length - 1) await sleep(1100);
  }

  geoStatus.running = false;
  refreshStatus();
  if ($('.tab.active')?.dataset?.tab === 'mapa') renderMap();
}

function refreshStatus() {
  const el = document.getElementById('geocodeStatus');
  if (!el) return;
  if (hasDirectCoords()) {
    el.className = 'geocode-status done';
    el.textContent = `Coordenadas directas del archivo (${state.raw.length} propiedades).`;
    return;
  }
  if (geoStatus.running) {
    el.className = 'geocode-status running';
    el.textContent = `Geocodificando: ${geoStatus.done} / ${geoStatus.total} direcciones...`;
  } else if (geoStatus.done > 0) {
    const found = [...cache.values()].filter(Boolean).length;
    el.className = 'geocode-status done';
    el.textContent = `${found} de ${geoStatus.total} direcciones ubicadas en el mapa.`;
  } else {
    el.className = 'geocode-status';
    el.textContent = '';
  }
}

// ============== Mapa ==============
let leafletMap = null;
let markersLayer = null;
let legendControl = null;
let countControl = null;

// Selección por polígono (vértices con clic)
let selMode           = false;
let selRect           = null;
let selPanel          = null;
let selPoints         = [];
let lastPolyPoints    = [];
let persistentPoly    = null;
let rubberBand        = null;
let firstVertexMarker = null;

function initRankingResize() {
  const resizer = document.getElementById('mapRankingResizer');
  const ranking = document.getElementById('mapRanking');
  if (!resizer || !ranking) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', e => {
    startX     = e.clientX;
    startWidth = ranking.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = e => {
      const newWidth = Math.max(180, Math.min(680, startWidth + (startX - e.clientX)));
      ranking.style.width = newWidth + 'px';
      if (leafletMap) leafletMap.invalidateSize();
    };

    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ============== Widget de filtros activos ==============
export function updateFilterWidget() {
  const body = document.getElementById('mfwBody');
  if (!body) return;
  const widget = document.getElementById('mapFilterWidget');
  if (!widget || widget.classList.contains('hidden')) return;
  import('./filters.js').then(({ getActiveFiltersSummary }) => {
    const items = getActiveFiltersSummary();
    body.innerHTML = items.length
      ? items.map(it => `<div class="mfw-row"><span class="mfw-label">${it.label}</span><span class="mfw-value">${it.value}</span></div>`).join('')
      : '<div class="mfw-empty">Sin filtros aplicados</div>';
  });
}

function initFilterWidget() {
  const toggleBtn = document.getElementById('mapFilterWidgetBtn');
  if (!toggleBtn) return;

  const widget = document.createElement('div');
  widget.id = 'mapFilterWidget';
  widget.className = 'map-filter-widget hidden';
  widget.innerHTML = `
    <div class="mfw-header" id="mfwHeader">
      <span>Filtros activos</span>
      <button class="mfw-close" id="mfwClose" title="Cerrar">&#xD7;</button>
    </div>
    <div class="mfw-body" id="mfwBody"></div>
  `;
  leafletMap.getContainer().appendChild(widget);
  L.DomEvent.disableClickPropagation(widget);
  L.DomEvent.disableScrollPropagation(widget);

  const header = document.getElementById('mfwHeader');
  header.addEventListener('mousedown', e => {
    if (e.target.id === 'mfwClose') return;
    const startX = e.clientX, startY = e.clientY;
    const startL = parseInt(widget.style.left) || 0;
    const startT = parseInt(widget.style.top)  || 0;
    document.body.style.userSelect = 'none';
    const onMove = e => {
      widget.style.left = (startL + e.clientX - startX) + 'px';
      widget.style.top  = (startT + e.clientY - startY) + 'px';
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
  });

  document.getElementById('mfwClose').addEventListener('click', () => {
    widget.classList.add('hidden');
    toggleBtn.classList.remove('active');
  });

  toggleBtn.addEventListener('click', () => {
    const nowHidden = widget.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !nowHidden);
    if (!nowHidden) {
      if (!widget.style.left) {
        const cW = leafletMap.getContainer().offsetWidth;
        widget.style.left = (cW - 230) + 'px';
        widget.style.top  = '48px';
      }
      updateFilterWidget();
    }
  });
}

// ============== Selección por polígono libre ==============
function _pointInPolygon(lat, lng, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng, yi = pts[i].lat;
    const xj = pts[j].lng, yj = pts[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function _setPersistentPoly() {
  if (persistentPoly) { persistentPoly.remove(); persistentPoly = null; }
  if (!lastPolyPoints.length) return;
  persistentPoly = L.polygon(lastPolyPoints, {
    color: '#1e3a5f', weight: 2.5,
    fillColor: '#3b82f6', fillOpacity: 0.07,
    interactive: false,
  }).addTo(leafletMap);
  const clearBtn = document.getElementById('mapClearPolyBtn');
  if (clearBtn) clearBtn.classList.remove('hidden');
}

function _cancelSel() {
  selPoints = [];
  if (rubberBand)        { rubberBand.remove();        rubberBand = null; }
  if (firstVertexMarker) { firstVertexMarker.remove(); firstVertexMarker = null; }
  if (selRect)           { selRect.remove();           selRect = null; }
  if (selPanel && selPanel.parentNode) selPanel.parentNode.removeChild(selPanel);
  selPanel = null;
}

function _endSel() {
  _cancelSel();
  selMode = false;
  const btn = document.getElementById('mapSelectBtn');
  if (btn) btn.classList.remove('active');
  if (leafletMap) {
    leafletMap.dragging.enable();
    leafletMap.getContainer().style.cursor = '';
  }
}

function _updateUndoBtn() {
  import('./filters.js').then(({ hasProyectoHistory }) => {
    const btn = document.getElementById('mapUndoBtn');
    if (btn) btn.classList.toggle('hidden', !hasProyectoHistory());
  });
}

function _closePolygon() {
  if (selPoints.length < 3) { _cancelSel(); return; }
  if (rubberBand)        { rubberBand.remove();        rubberBand = null; }
  if (firstVertexMarker) { firstVertexMarker.remove(); firstVertexMarker = null; }
  if (selRect)           { selRect.remove();           selRect = null; }

  selRect = L.polygon(selPoints, {
    color: '#2563eb', weight: 2, dashArray: '5 3',
    fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false,
  }).addTo(leafletMap);

  lastPolyPoints = [...selPoints];
  selPoints = [];

  const proyCol = state.columns.find(c =>
    ['proyecto', 'edificio', 'nombre', 'building'].some(k => norm(c.name).includes(k))
  )?.name;

  const inside = collectPoints(state.filtered).filter(p =>
    _pointInPolygon(p.lat, p.lng, lastPolyPoints)
  );
  const names = [...new Set(inside.flatMap(p =>
    p.rows.map(r => proyCol ? String(r[proyCol] ?? '').trim() : '').filter(Boolean)
  ))];

  if (!names.length) { _cancelSel(); return; }
  _showSelPanel(names, selRect.getBounds());
}

function _showSelPanel(names, bounds) {
  if (selPanel && selPanel.parentNode) selPanel.parentNode.removeChild(selPanel);

  const ne   = leafletMap.latLngToContainerPoint(bounds.getNorthEast());
  const cW   = leafletMap.getContainer().offsetWidth;
  const cH   = leafletMap.getContainer().offsetHeight;
  const panelW = 215;
  const left = Math.min(ne.x + 10, cW - panelW - 8);
  const top  = Math.max(Math.min(ne.y, cH - 160), 8);

  selPanel = document.createElement('div');
  selPanel.className = 'map-sel-panel';
  selPanel.style.left = left + 'px';
  selPanel.style.top  = top  + 'px';
  L.DomEvent.disableClickPropagation(selPanel);
  selPanel.innerHTML = `
    <div class="map-sel-count">${names.length} proyecto${names.length !== 1 ? 's' : ''} seleccionado${names.length !== 1 ? 's' : ''}</div>
    <button class="sel-btn sel-btn-keep"  id="selBtnMantener">Mantener solo estos</button>
    <button class="sel-btn sel-btn-excl"  id="selBtnExcluir">Excluir estos</button>
    <label class="sel-check-row">
      <input type="checkbox" id="selChkMark" checked>
      <span>Dejar zona marcada</span>
    </label>
    <button class="sel-btn sel-btn-ghost" id="selBtnCancelar">Cancelar</button>
  `;
  leafletMap.getContainer().appendChild(selPanel);

  const applyAction = async (fn) => {
    if (document.getElementById('selChkMark').checked) _setPersistentPoly();
    await fn();
    _endSel();
    _updateUndoBtn();
  };

  document.getElementById('selBtnMantener').addEventListener('click', () =>
    applyAction(async () => {
      const { keepOnlyProyectos } = await import('./filters.js');
      keepOnlyProyectos(names);
    })
  );
  document.getElementById('selBtnExcluir').addEventListener('click', () =>
    applyAction(async () => {
      const { excludeProyectos } = await import('./filters.js');
      excludeProyectos(names);
    })
  );
  document.getElementById('selBtnCancelar').addEventListener('click', _cancelSel);
}

function initSelectionMode() {
  const btn = document.getElementById('mapSelectBtn');
  if (!btn) return;

  const clearPolyBtn = document.getElementById('mapClearPolyBtn');
  clearPolyBtn?.addEventListener('click', () => {
    if (persistentPoly) { persistentPoly.remove(); persistentPoly = null; }
    clearPolyBtn.classList.add('hidden');
  });

  const undoBtn = document.getElementById('mapUndoBtn');
  undoBtn?.addEventListener('click', async () => {
    const { undoProyectoFilter } = await import('./filters.js');
    const hasMore = undoProyectoFilter();
    undoBtn.classList.toggle('hidden', !hasMore);
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !undoBtn?.classList.contains('hidden')) {
      e.preventDefault();
      undoBtn?.click();
    }
  });

  btn.addEventListener('click', () => {
    selMode = !selMode;
    btn.classList.toggle('active', selMode);
    if (selMode) {
      leafletMap.doubleClickZoom.disable();
      leafletMap.getContainer().style.cursor = 'crosshair';
    } else {
      leafletMap.doubleClickZoom.enable();
      leafletMap.getContainer().style.cursor = '';
      _cancelSel();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selMode) _endSel();
  });

  leafletMap.on('click', e => {
    if (!selMode) return;
    if (selPoints.length >= 3) {
      const firstPx = leafletMap.latLngToContainerPoint(selPoints[0]);
      const clickPx = leafletMap.latLngToContainerPoint(e.latlng);
      if (Math.hypot(firstPx.x - clickPx.x, firstPx.y - clickPx.y) < 12) {
        _closePolygon();
        return;
      }
    }
    selPoints.push(e.latlng);
    if (selPoints.length === 1) {
      firstVertexMarker = L.circleMarker(selPoints[0], {
        radius: 6, color: '#2563eb', weight: 2.5,
        fillColor: '#fff', fillOpacity: 1, interactive: false,
      }).addTo(leafletMap);
    }
    if (selRect) selRect.setLatLngs(selPoints);
    else selRect = L.polyline(selPoints, {
      color: '#2563eb', weight: 2.5, interactive: false,
    }).addTo(leafletMap);
  });

  leafletMap.on('mousemove', e => {
    if (!selMode || !selPoints.length) return;
    const last = selPoints[selPoints.length - 1];
    if (rubberBand) rubberBand.setLatLngs([last, e.latlng]);
    else rubberBand = L.polyline([last, e.latlng], {
      color: '#2563eb', weight: 1.5, dashArray: '5 4',
      interactive: false, opacity: 0.6,
    }).addTo(leafletMap);
    if (selPoints.length >= 3 && firstVertexMarker) {
      const firstPx = leafletMap.latLngToContainerPoint(selPoints[0]);
      const movePx  = leafletMap.latLngToContainerPoint(e.latlng);
      const near    = Math.hypot(firstPx.x - movePx.x, firstPx.y - movePx.y) < 12;
      firstVertexMarker.setStyle({ fillColor: near ? '#2563eb' : '#fff', radius: near ? 9 : 6 });
      leafletMap.getContainer().style.cursor = near ? 'pointer' : 'crosshair';
    }
  });

  leafletMap.on('dblclick', e => {
    if (!selMode || selPoints.length < 4) return;
    L.DomEvent.stopPropagation(e);
    selPoints.pop();
    _closePolygon();
  });
}

function initLeafletMap() {
  leafletMap = L.map('map');
  initRankingResize();
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(leafletMap);
  markersLayer = L.layerGroup().addTo(leafletMap);

  // Control leyenda (bottom-left)
  legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-price-legend');
    div.id = 'mapPriceLegend';
    div.innerHTML = `<span class="leg-lbl" id="legLblMin">—</span><div class="leg-bar"></div><span class="leg-lbl" id="legLblMax">—</span>`;
    return div;
  };

  // Control contador (bottom-right)
  countControl = L.control({ position: 'bottomright' });
  countControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-count-ctrl');
    div.id = 'mapCountCtrl';
    return div;
  };
  countControl.addTo(leafletMap);

  // Botones de modo (solo General / De calor — los que tienen data-mode)
  document.querySelectorAll('.map-mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mapMode = btn.dataset.mode;
      const pills = document.getElementById('heatMetricPills');
      if (pills) pills.classList.toggle('hidden', mapMode !== 'precio');
      renderMap();
    });
  });

  // Botones de métrica de calor
  document.querySelectorAll('.heat-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.heat-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      heatMetric = btn.dataset.metric;
      renderMap();
    });
  });

  initSelectionMode();
  initFilterWidget();
}

export function renderMap() {
  const placeholder = document.querySelector('.map-placeholder');
  const wrapper = document.getElementById('mapWrapper');

  refreshStatus();

  const points = collectPoints(state.filtered);
  const mpHasPoint = mp.inMapa && (mp.proyecto || mp.edificio) && mp.geocoords;

  if (!points.length && !mpHasPoint) {
    placeholder.classList.remove('hidden');
    wrapper.classList.add('hidden');
    const p = placeholder.querySelector('p');
    if (p) {
      if (hasDirectCoords()) {
        p.textContent = 'No se encontraron coordenadas válidas en los datos filtrados.';
      } else {
        const col = findAddressCol();
        p.textContent = col
          ? (geoStatus.running ? 'Geocodificando direcciones, aguarda un momento...' : 'No se encontraron coordenadas para las direcciones en los datos filtrados.')
          : 'Aún no detecté direcciones válidas en tus datos. Cuando incluyas una columna llamada Dirección (o similar), las propiedades aparecerán en el mapa.';
      }
    }
    return;
  }

  placeholder.classList.add('hidden');
  wrapper.classList.remove('hidden');

  const heatCol     = getHeatCol();
  const heatLabel   = getHeatLabel();
  const inPriceMode = mapMode === 'precio' && heatCol;
  wrapper.classList.toggle('dark-mode', inPriceMode);

  if (!leafletMap) initLeafletMap();
  markersLayer.clearLayers();

  // Calcular rango de precios para la escala de color
  let priceMin = 0, priceMax = 1;
  if (inPriceMode) {
    const allPrices = points.flatMap(p =>
      p.rows.map(r => Number(r[heatCol])).filter(v => !isNaN(v) && v > 0)
    );
    if (allPrices.length) {
      priceMin = Math.min(...allPrices);
      priceMax = Math.max(...allPrices);
    }
  }

  const bounds = [];
  for (const point of points) {
    const { lat, lng, rows } = point;
    let marker;

    if (inPriceMode) {
      const prices = rows.map(r => Number(r[heatCol])).filter(v => !isNaN(v) && v > 0);
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
      const color = avg !== null ? priceToColor(avg, priceMin, priceMax) : '#60a5fa';
      marker = L.circleMarker([lat, lng], {
        radius: 9,
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.96,
        opacity: 1,
        className: 'price-marker',
      });
    } else {
      marker = L.marker([lat, lng]);
    }

    marker.bindPopup(buildPopup(rows[0]), { maxWidth: 340 });
    marker.addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // ── Marcador Mi Proyecto (adaptado para Renta) ──
  if (mpHasPoint) {
    const { lat, lng } = mp.geocoords;
    const nombreProy = mp.proyecto || mp.edificio || 'Mi Proyecto';
    const mpIcon = L.divIcon({
      className: '',
      html: `<div class="mp-map-marker" title="${String(nombreProy).replace(/"/g, '&quot;')}">★</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20],
    });
    const escH = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let popHtml = `<table class="map-popup">
      <tr><td class="pp-key">Proyecto</td><td class="pp-val"><strong>${escH(nombreProy)}</strong></td></tr>`;
    
    for (const t of mp.tipologias) {
      if (!t.nombre) continue;
      const parts = [
        t.sup    != null ? `${t.sup} m² útil`   : null,
        t.ufm2   != null ? `${t.ufm2} UF/m²`    : null,
        t.renta  != null ? `${t.renta} UF renta`: null, // Adaptado de 'ticket' a 'renta'
      ].filter(Boolean);
      popHtml += `<tr><td class="pp-key">${escH(t.nombre)}</td><td class="pp-val">${parts.join(' · ') || '—'}</td></tr>`;
    }
    popHtml += `</table>`;
    L.marker([lat, lng], { icon: mpIcon, zIndexOffset: 1000 })
      .bindPopup(popHtml, { maxWidth: 340 })
      .addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // Leyenda
  if (inPriceMode) {
    if (!legendControl._map) legendControl.addTo(leafletMap);
    const minEl = document.getElementById('legLblMin');
    const maxEl = document.getElementById('legLblMax');
    if (minEl) minEl.textContent = `${fmt(priceMin)} ${heatLabel}`;
    if (maxEl) maxEl.textContent = `${fmt(priceMax)} ${heatLabel}`;
  } else {
    if (legendControl._map) legendControl.remove();
  }

  // Contador
  const countEl = document.getElementById('mapCountCtrl');
  if (countEl) countEl.textContent = `Mostrando ${points.length} proyecto${points.length !== 1 ? 's' : ''}`;

  if (!mapInitialized) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
    mapInitialized = true;
  }
  setTimeout(() => leafletMap.invalidateSize(), 150);

  renderRanking();
}

// ============== Ranking lateral (Adaptado para Renta) ==============
function renderRanking() {
  const el = document.getElementById('mapRanking');
  if (!el) return;

  const proyCol  = state.columns.find(c => ['proyecto', 'edificio', 'nombre', 'building'].some(k => norm(c.name).includes(k)))?.name;
  const tipoCol  = state.columns.find(c => ['tipo', 'propiedad'].some(k => norm(c.name).includes(k)))?.name;
  const supCol   = state.columns.find(c =>
    c.type === 'number' && ['útil', 'util', 'sup. út', 'sup út'].some(k => norm(c.name).includes(norm(k)))
  )?.name;
  const ufm2ColN = findUfm2Col();
  const rentaCol = state.columns.find(c => ['renta uf', 'precio', 'renta'].some(k => norm(c.name).includes(k)))?.name;

  const rankByRenta = heatMetric === 'renta';

  if (!proyCol) { el.innerHTML = ''; return; }

  const byProy = {};
  for (const r of state.filtered) {
    const proy = String(r[proyCol] ?? '').trim();
    if (!proy) continue;
    if (!byProy[proy]) byProy[proy] = { tipo: tipoCol ? r[tipoCol] : null, sups: [], ufm2s: [], rentas: [] };

    const sup   = Number(r[supCol]);
    const ufm2  = Number(r[ufm2ColN]);
    const renta = Number(r[rentaCol]);

    if (supCol   && !isNaN(sup)   && sup > 0)  byProy[proy].sups.push(sup);
    if (ufm2ColN && !isNaN(ufm2)  && ufm2 > 0) byProy[proy].ufm2s.push(ufm2);
    if (rentaCol && !isNaN(renta) && renta > 0) byProy[proy].rentas.push(renta);
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const buildings = Object.entries(byProy)
    .map(([proy, d]) => ({
      proy,
      tipo:  d.tipo,
      sup:   avg(d.sups),
      ufm2:  avg(d.ufm2s),
      renta: avg(d.rentas),
    }))
    .filter(b => rankByRenta ? b.renta !== null : b.ufm2 !== null)
    .sort((a, b) => rankByRenta ? b.renta - a.renta : b.ufm2 - a.ufm2);

  const rankLabel = rankByRenta ? 'Renta UF ↓' : 'UF/<span style="text-transform:none">m²</span> ↓';
  el.innerHTML = `<div class="map-ranking-title">Proyectos (${buildings.length}) &nbsp;·&nbsp; ${rankLabel}</div>`;

  buildings.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'map-ranking-item';
    item.innerHTML = `
      <span class="rk-pos">#${i + 1}</span>
      <div class="rk-name">${b.proy}</div>
      ${b.tipo ? `<div class="rk-prop">${b.tipo}</div>` : ''}
      <div class="rk-metrics">
        ${b.sup   !== null ? `<div class="rk-metric"><span>m² útil </span>${b.sup.toLocaleString('es-CL', { maximumFractionDigits: 1 })}</div>` : ''}
        ${b.renta !== null ? `<div class="rk-metric"><span>Renta </span>${Math.round(b.renta).toLocaleString('es-CL')} UF</div>` : ''}
        ${b.ufm2  !== null ? `<div class="rk-metric rk-ufm2">${b.ufm2.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/m²</div>` : ''}
      </div>`;
    el.appendChild(item);
  });
}

// ============== Popup (Adaptado para Renta) ==============
const POPUP_FIELDS = [
  { label: 'Proyecto', keys: ['proyecto', 'nombre'] },
  { label: 'Tipo', keys: ['tipo', 'tipo de propiedad'] },
  { label: 'Operación', keys: ['operación', 'operacion'] },
  { label: 'Tipología', keys: ['tipología', 'tipologia', 'dormitorios'] },
  { label: 'Útil (m²)', keys: ['útil', 'promedio útil', 'sup útil', 'útil (m²)'] },
  { label: 'Terraza (m²)', keys: ['terraza', 'terraza (m²)'] },
  { label: 'UF/m²', keys: ['uf/m²', 'uf/m2', 'uf / m', 'uf/m'] },
  { label: 'Renta UF', keys: ['renta uf', 'precio', 'renta', 'precio (uf)'] },
  { label: 'Gastos Comunes', keys: ['gastos comunes', 'ggcc', 'gastos comunes (uf)'] },
  { label: 'Link', keys: ['link', 'url', 'enlace'] },
];

function parsePopupNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  const text = String(value).trim().replace(/\s+/g, '');
  if (text === '') return NaN;
  const normalized = text.replace(/\./g, '').replace(/,/g, '.');
  return Number(normalized);
}

function formatPopupValue(label, value) {
  const num = parsePopupNumber(value);
  
  if (label === 'UF/m²') {
    if (!Number.isFinite(num)) return `<strong>${String(value)}</strong>`;
    return `<strong>${num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>`;
  }
  if (label === 'Renta UF') {
    if (!Number.isFinite(num)) return fmt(value);
    return num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' UF';
  }
  if (label === 'Gastos Comunes') {
    if (!Number.isFinite(num)) return fmt(value);
    // Mostrar sin decimales si es número entero, o con 1 decimal.
    return num.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' UF';
  }
  if (label === 'Útil (m²)' || label === 'Terraza (m²)') {
    if (!Number.isFinite(num)) return fmt(value);
    return `${num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²`;
  }
  if (label === 'Link') {
    if (typeof value === 'string' && value.startsWith('http')) {
      return `<a href="${value}" target="_blank" rel="noopener noreferrer">Ver publicación</a>`;
    }
  }
  return fmt(value);
}

function findPopupColumn(keys) {
  const normalizedKeys = keys.map(k => norm(k));
  const col = state.columns.find(c => normalizedKeys.some(key => norm(c.name).includes(key)));
  return col?.name ?? null;
}

function buildPopup(row) {
  const rowsHtml = POPUP_FIELDS.map(field => {
    const colName = findPopupColumn(field.keys);
    if (!colName) return '';
    const rawValue = row[colName];
    if (rawValue === '' || rawValue == null) return '';
    const formatted = formatPopupValue(field.label, rawValue);
    return `<tr><td class="pp-key">${field.label}</td><td class="pp-val">${formatted}</td></tr>`;
  }).join('');
  return `<table class="map-popup">${rowsHtml}</table>`;
}