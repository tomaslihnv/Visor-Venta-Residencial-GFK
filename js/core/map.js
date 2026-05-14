import { fmt, norm } from './utils.js';
import { reapplyFilters } from './filters.js';

// mapConfig: {
//   projectCandidates: string[]
//   heatOptions: [{ value, label, candidates }]   — metric options for heat mode
//   popupFields: [{ label, keys }]
//   rankingMetrics?: [{ key, label, candidates }]  — columns shown in ranking (default: heatOptions[0])
// }

const geocodeCache = new Map();
const geoStatus    = { total: 0, done: 0, running: false };
let   mapMode      = 'general';
let   heatMetric   = null;   // value of the active heatOption
let   leafletMap   = null;
let   markersLayer = null;
let   legendControl = null;
let   countControl  = null;
let   _mapInitialized = false;
let   _streetLayer    = null;
let   _satelliteLayer = null;
let   _isSatellite    = false;
let   _lastOrderedPoints = [];
let   _resumenInited  = false;

// Selección por polígono
let _selState         = null;
let _selMapConfig     = null;
let _selMode          = false;
let _selRect          = null;
let _selPanel         = null;
let _selPoints        = [];
let _lastPolyPoints   = [];
let _persistentPoly   = null;
let _rubberBand       = null;
let _firstVertexMarker = null;
let _projHistory      = [];

export function resetMapOnLoad() {
  _mapInitialized = false;
  geoStatus.total = 0; geoStatus.done = 0; geoStatus.running = false;
  _projHistory = [];
  _lastOrderedPoints = [];
  if (_persistentPoly) { _persistentPoly.remove(); _persistentPoly = null; }
  document.getElementById('mapClearPolyBtn')?.classList.add('hidden');
  document.getElementById('mapUndoBtn')?.classList.add('hidden');
}

// ── Coord helpers ─────────────────────────────────────────────────────────

function _hasDirectCoords(state) {
  return state.columns.some(c => c.name === '__lat');
}

function _findAddressCol(state) {
  const kw = ['direccion', 'address', 'domicilio', 'ubicacion', 'calle'];
  return state.columns.find(c => kw.some(k => norm(c.name).includes(k)));
}

function _collectPoints(state, mapConfig) {
  const buildings = new Map();
  const projCol   = state.columns.find(c =>
    mapConfig.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name;

  if (_hasDirectCoords(state)) {
    for (const r of state.filtered) {
      const lat = Number(r['__lat']), lng = Number(r['__lng']);
      if (isNaN(lat) || isNaN(lng)) continue;
      const key = projCol ? String(r[projCol] ?? '').trim() : `${lat},${lng}`;
      if (!key) continue;
      if (!buildings.has(key)) buildings.set(key, { lat, lng, rows: [] });
      buildings.get(key).rows.push(r);
    }
  } else {
    const col = _findAddressCol(state);
    if (col) {
      for (const r of state.filtered) {
        const addr   = String(r[col.name] ?? '').trim();
        const coords = geocodeCache.get(addr);
        if (!coords) continue;
        if (!buildings.has(addr)) buildings.set(addr, { ...coords, rows: [] });
        buildings.get(addr).rows.push(r);
      }
    }
  }
  return [...buildings.values()];
}

// ── Geocoding ─────────────────────────────────────────────────────────────

async function _fetchGeocode(addr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
  } catch { return null; }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _refreshStatus(state) {
  const el = document.getElementById('geocodeStatus');
  if (!el) return;
  if (_hasDirectCoords(state)) {
    el.className = 'geocode-status done';
    el.textContent = `Coordenadas directas del archivo (${state.raw.length} registros).`;
    return;
  }
  if (geoStatus.running) {
    el.className = 'geocode-status running';
    el.textContent = `Geocodificando: ${geoStatus.done} / ${geoStatus.total} direcciones...`;
  } else if (geoStatus.done > 0) {
    const found = [...geocodeCache.values()].filter(Boolean).length;
    el.className = 'geocode-status done';
    el.textContent = `${found} de ${geoStatus.total} direcciones ubicadas en el mapa.`;
  } else {
    el.className = 'geocode-status';
    el.textContent = '';
  }
}

export async function geocodeData(state, mapConfig, onDone) {
  if (_hasDirectCoords(state)) { _refreshStatus(state); if (onDone) onDone(); return; }
  const col = _findAddressCol(state);
  if (!col || geoStatus.running) return;

  const addrs   = [...new Set(state.raw.map(r => String(r[col.name] ?? '').trim()).filter(a => a.length > 3))];
  const pending = addrs.filter(a => !geocodeCache.has(a));
  if (!pending.length) { if (onDone) onDone(); return; }

  geoStatus.total = pending.length; geoStatus.done = 0; geoStatus.running = true;
  _refreshStatus(state);

  for (let i = 0; i < pending.length; i++) {
    geocodeCache.set(pending[i], await _fetchGeocode(pending[i]));
    geoStatus.done = i + 1;
    _refreshStatus(state);
    if (i < pending.length - 1) await _sleep(1100);
  }
  geoStatus.running = false;
  _refreshStatus(state);
  if (onDone) onDone();
}

// ── Color scale ───────────────────────────────────────────────────────────

function _priceToColor(value, min, max) {
  if (max === min) return '#94a3b8';
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  let r, g, b;
  if (t < 1 / 3) {
    const s = t * 3;
    r = Math.round(239 + (245 - 239) * s); g = Math.round(68  + (158 - 68)  * s); b = Math.round(68  + (11  - 68)  * s);
  } else if (t < 2 / 3) {
    const s = (t - 1 / 3) * 3;
    r = Math.round(245 + (34  - 245) * s); g = Math.round(158 + (197 - 158) * s); b = Math.round(11  + (94  - 11)  * s);
  } else {
    const s = (t - 2 / 3) * 3;
    r = Math.round(34  + (59  - 34)  * s); g = Math.round(197 + (130 - 197) * s); b = Math.round(94  + (246 - 94)  * s);
  }
  return `rgb(${r},${g},${b})`;
}

// ── Filter widget ─────────────────────────────────────────────────────────

export function updateFilterWidget(state, filterDefs) {
  const body = document.getElementById('mfwBody');
  if (!body) return;
  const widget = document.getElementById('mapFilterWidget');
  if (!widget || widget.classList.contains('hidden')) return;
  const defs = filterDefs ?? state?._filterDefs ?? [];
  const items = [];
  for (const def of defs) {
    if (def.type === 'multi') {
      const set = state?.filterValues?.[def.key];
      if (set?.size > 0) items.push({ label: def.label, value: [...set].join(', ') });
    } else if (def.type === 'slider') {
      const min = state?.filterValues?.[def.key + 'Min'];
      const max = state?.filterValues?.[def.key + 'Max'];
      if (min === null && max === null) continue;
      const ref = state?.filterRefs?.[def.key];
      const lo = min !== null ? (ref?.iMin?.value ?? min) : '—';
      const hi = max !== null ? (ref?.iMax?.value ?? max) : '—';
      items.push({ label: def.label, value: `${lo} – ${hi}` });
    }
  }
  body.innerHTML = items.length
    ? items.map(it => `<div class="mfw-row"><span class="mfw-label">${it.label}</span><span class="mfw-value">${it.value}</span></div>`).join('')
    : '<div class="mfw-empty">Sin filtros aplicados</div>';
}

function _initFilterWidget() {
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
      updateFilterWidget(_selState, _selState?._filterDefs);
    }
  });
}

// ── Selección por polígono ────────────────────────────────────────────────

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
  if (_persistentPoly) { _persistentPoly.remove(); _persistentPoly = null; }
  if (!_lastPolyPoints.length) return;
  _persistentPoly = L.polygon(_lastPolyPoints, {
    color: '#1e3a5f', weight: 2.5,
    fillColor: '#3b82f6', fillOpacity: 0.07,
    interactive: false,
  }).addTo(leafletMap);
  document.getElementById('mapClearPolyBtn')?.classList.remove('hidden');
}

function _cancelSel() {
  _selPoints = [];
  if (_rubberBand)         { _rubberBand.remove();         _rubberBand = null; }
  if (_firstVertexMarker)  { _firstVertexMarker.remove();  _firstVertexMarker = null; }
  if (_selRect)            { _selRect.remove();            _selRect = null; }
  if (_selPanel?.parentNode) _selPanel.parentNode.removeChild(_selPanel);
  _selPanel = null;
}

function _endSel() {
  _cancelSel();
  _selMode = false;
  document.getElementById('mapSelectBtn')?.classList.remove('active');
  if (leafletMap) {
    leafletMap.dragging.enable();
    leafletMap.getContainer().style.cursor = '';
  }
}

function _updateUndoBtn() {
  document.getElementById('mapUndoBtn')?.classList.toggle('hidden', _projHistory.length === 0);
}

function _saveProjSnapshot() {
  _projHistory.push(new Set(_selState?.excludedProjects ?? new Set()));
}

function _applyProjExclusion() {
  if (!_selState) return;
  reapplyFilters(_selState);
  _updateUndoBtn();
  updateFilterWidget(_selState, _selState._filterDefs);
}

function _closePolygon() {
  if (_selPoints.length < 3) { _cancelSel(); return; }
  if (_rubberBand)        { _rubberBand.remove();        _rubberBand = null; }
  if (_firstVertexMarker) { _firstVertexMarker.remove(); _firstVertexMarker = null; }
  if (_selRect)           { _selRect.remove();           _selRect = null; }

  _selRect = L.polygon(_selPoints, {
    color: '#2563eb', weight: 2, dashArray: '5 3',
    fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false,
  }).addTo(leafletMap);

  _lastPolyPoints = [..._selPoints];
  _selPoints = [];

  const projCol = _selState?.columns.find(c =>
    _selMapConfig?.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name;

  const inside = _collectPoints(_selState, _selMapConfig).filter(p =>
    _pointInPolygon(p.lat, p.lng, _lastPolyPoints)
  );
  const names = [...new Set(inside.flatMap(p =>
    p.rows.map(r => projCol ? String(r[projCol] ?? '').trim() : '').filter(Boolean)
  ))];

  if (!names.length) { _cancelSel(); return; }
  _showSelPanel(names, _selRect.getBounds());
}

function _showSelPanel(names, bounds) {
  if (_selPanel?.parentNode) _selPanel.parentNode.removeChild(_selPanel);

  const ne   = leafletMap.latLngToContainerPoint(bounds.getNorthEast());
  const cW   = leafletMap.getContainer().offsetWidth;
  const cH   = leafletMap.getContainer().offsetHeight;
  const panelW = 215;
  const left = Math.min(ne.x + 10, cW - panelW - 8);
  const top  = Math.max(Math.min(ne.y, cH - 160), 8);

  _selPanel = document.createElement('div');
  _selPanel.className = 'map-sel-panel';
  _selPanel.style.left = left + 'px';
  _selPanel.style.top  = top  + 'px';
  L.DomEvent.disableClickPropagation(_selPanel);
  _selPanel.innerHTML = `
    <div class="map-sel-count">${names.length} proyecto${names.length !== 1 ? 's' : ''} seleccionado${names.length !== 1 ? 's' : ''}</div>
    <button class="sel-btn sel-btn-keep"  id="selBtnMantener">Mantener solo estos</button>
    <button class="sel-btn sel-btn-excl"  id="selBtnExcluir">Excluir estos</button>
    <label class="sel-check-row">
      <input type="checkbox" id="selChkMark" checked>
      <span>Dejar zona marcada</span>
    </label>
    <button class="sel-btn sel-btn-ghost" id="selBtnCancelar">Cancelar</button>
  `;
  leafletMap.getContainer().appendChild(_selPanel);

  document.getElementById('selBtnMantener').addEventListener('click', () => {
    if (document.getElementById('selChkMark').checked) _setPersistentPoly();
    _saveProjSnapshot();
    if (!_selState.excludedProjects) _selState.excludedProjects = new Set();
    const keepSet = new Set(names.map(String));
    const projCol = _selState.columns.find(c =>
      _selMapConfig?.projectCandidates.some(k => norm(c.name).includes(norm(k)))
    )?.name;
    const allProjs = [...new Set(
      _selState.raw.map(r => projCol ? String(r[projCol] ?? '').trim() : '').filter(Boolean)
    )];
    _selState.excludedProjects.clear();
    for (const n of allProjs) {
      if (!keepSet.has(n)) _selState.excludedProjects.add(n);
    }
    _endSel();
    _applyProjExclusion();
  });

  document.getElementById('selBtnExcluir').addEventListener('click', () => {
    if (document.getElementById('selChkMark').checked) _setPersistentPoly();
    _saveProjSnapshot();
    if (!_selState.excludedProjects) _selState.excludedProjects = new Set();
    for (const n of names) _selState.excludedProjects.add(n);
    _endSel();
    _applyProjExclusion();
  });

  document.getElementById('selBtnCancelar').addEventListener('click', _cancelSel);
}

function _initSelectionMode() {
  const btn = document.getElementById('mapSelectBtn');
  if (!btn) return;

  document.getElementById('mapClearPolyBtn')?.addEventListener('click', () => {
    if (_persistentPoly) { _persistentPoly.remove(); _persistentPoly = null; }
    document.getElementById('mapClearPolyBtn')?.classList.add('hidden');
  });

  const undoBtn = document.getElementById('mapUndoBtn');
  undoBtn?.addEventListener('click', () => {
    if (!_projHistory.length) return;
    _selState.excludedProjects = _projHistory.pop();
    _applyProjExclusion();
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !undoBtn?.classList.contains('hidden')) {
      e.preventDefault();
      undoBtn?.click();
    }
  });

  btn.addEventListener('click', () => {
    _selMode = !_selMode;
    btn.classList.toggle('active', _selMode);
    if (_selMode) {
      leafletMap.doubleClickZoom.disable();
      leafletMap.getContainer().style.cursor = 'crosshair';
    } else {
      leafletMap.doubleClickZoom.enable();
      leafletMap.getContainer().style.cursor = '';
      _cancelSel();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _selMode) _endSel();
  });

  leafletMap.on('click', e => {
    if (!_selMode) return;
    if (_selPoints.length >= 3) {
      const firstPx = leafletMap.latLngToContainerPoint(_selPoints[0]);
      const clickPx = leafletMap.latLngToContainerPoint(e.latlng);
      if (Math.hypot(firstPx.x - clickPx.x, firstPx.y - clickPx.y) < 12) {
        _closePolygon();
        return;
      }
    }
    _selPoints.push(e.latlng);
    if (_selPoints.length === 1) {
      _firstVertexMarker = L.circleMarker(_selPoints[0], {
        radius: 6, color: '#2563eb', weight: 2.5,
        fillColor: '#fff', fillOpacity: 1, interactive: false,
      }).addTo(leafletMap);
    }
    if (_selRect) _selRect.setLatLngs(_selPoints);
    else _selRect = L.polyline(_selPoints, {
      color: '#2563eb', weight: 2.5, interactive: false,
    }).addTo(leafletMap);
  });

  leafletMap.on('mousemove', e => {
    if (!_selMode || !_selPoints.length) return;
    const last = _selPoints[_selPoints.length - 1];
    if (_rubberBand) _rubberBand.setLatLngs([last, e.latlng]);
    else _rubberBand = L.polyline([last, e.latlng], {
      color: '#2563eb', weight: 1.5, dashArray: '5 4',
      interactive: false, opacity: 0.6,
    }).addTo(leafletMap);
    if (_selPoints.length >= 3 && _firstVertexMarker) {
      const firstPx = leafletMap.latLngToContainerPoint(_selPoints[0]);
      const movePx  = leafletMap.latLngToContainerPoint(e.latlng);
      const near    = Math.hypot(firstPx.x - movePx.x, firstPx.y - movePx.y) < 12;
      _firstVertexMarker.setStyle({ fillColor: near ? '#2563eb' : '#fff', radius: near ? 9 : 6 });
      leafletMap.getContainer().style.cursor = near ? 'pointer' : 'crosshair';
    }
  });

  leafletMap.on('dblclick', e => {
    if (!_selMode || _selPoints.length < 4) return;
    L.DomEvent.stopPropagation(e);
    _selPoints.pop();
    _closePolygon();
  });
}

// ── Leaflet init ──────────────────────────────────────────────────────────

function _initRankingResize() {
  const resizer = document.getElementById('mapRankingResizer');
  const ranking = document.getElementById('mapRanking');
  if (!resizer || !ranking) return;
  let startX, startWidth;
  resizer.addEventListener('mousedown', e => {
    startX = e.clientX; startWidth = ranking.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    const onMove = e => {
      ranking.style.width = Math.max(180, Math.min(680, startWidth + (startX - e.clientX))) + 'px';
      leafletMap?.invalidateSize();
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

async function _copyMapTable(state, mapConfig) {
  if (!_lastOrderedPoints.length) return;

  const projCol = state.columns.find(c =>
    mapConfig.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name;
  const propCol = state.columns.find(c => ['corredor', 'propietario', 'owner'].some(k => norm(c.name).includes(k)))?.name;
  const activeHeat = mapConfig.heatOptions?.find(o => o.value === heatMetric) ?? mapConfig.heatOptions?.[0];
  const heatColName = activeHeat
    ? state.columns.find(c => activeHeat.candidates.some(k => norm(c.name).includes(norm(k))))?.name
    : null;
  const ufm2ColName = mapConfig.heatOptions?.[0]
    ? state.columns.find(c => mapConfig.heatOptions[0].candidates.some(k => norm(c.name).includes(norm(k))))?.name
    : null;

  const fmtU = v => v != null ? v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';

  const rows = _lastOrderedPoints.map((pt, i) => {
    const proj = projCol ? String(pt.rows[0]?.[projCol] ?? '—') : '—';
    const prop = propCol ? String(pt.rows[0]?.[propCol] ?? '—') : '—';
    let heat = null;
    if (heatColName) {
      const vals = pt.rows.map(r => Number(r[heatColName])).filter(v => !isNaN(v) && v > 0);
      if (vals.length) heat = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return { n: i + 1, proj, prop, heat };
  });

  const heatVals = rows.filter(r => r.heat != null).map(r => r.heat);
  const avgHeat = heatVals.length ? heatVals.reduce((a, b) => a + b, 0) / heatVals.length : null;
  const heatLabel = activeHeat?.label ?? 'Métrica';

  const TH  = 'background:#1e3a5f;color:#fff;font-weight:700;font-size:8pt;padding:6px 10px;border:1px solid #1e3a5f;white-space:nowrap;font-family:Roboto,Arial,sans-serif;text-align:left;';
  const THR = TH + 'text-align:right;';
  const TD  = 'font-size:8pt;padding:6px 10px;border:1px solid #e5e7eb;white-space:nowrap;font-family:Roboto,Arial,sans-serif;color:#0f172a;';
  const TDR = TD + 'text-align:right;';
  const TF  = TD + 'font-weight:700;background:#f8fafc;';
  const TFR = TF + 'text-align:right;';

  const bodyHtml = rows.map(r => `<tr>
    <td style="${TD}">${r.n}</td>
    <td style="${TD}">${r.proj}</td>
    <td style="${TD}">${r.prop}</td>
    <td style="${TDR}">${fmtU(r.heat)}</td>
  </tr>`).join('');

  const footHtml = `<tr>
    <td style="${TF}" colspan="3">Promedio</td>
    <td style="${TFR}">${fmtU(avgHeat)}</td>
  </tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
  <table style="border-collapse:collapse;font-family:Roboto,Arial,sans-serif;font-size:8pt;">
    <thead><tr>
      <th style="${TH}">N°</th>
      <th style="${TH}">Proyecto</th>
      <th style="${TH}">Corredor</th>
      <th style="${THR}">${heatLabel}</th>
    </tr></thead>
    <tbody>${bodyHtml}</tbody>
    <tfoot>${footHtml}</tfoot>
  </table></body></html>`;

  await navigator.clipboard.write([
    new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
  ]);
}

function _updateResumenWidget(state, mapConfig) {
  const body = document.getElementById('mapResumenBody');
  if (!body) return;
  const widget = document.getElementById('mapResumenWidget');
  if (!widget || widget.classList.contains('hidden')) return;

  const activeHeat = mapConfig.heatOptions?.find(o => o.value === heatMetric) ?? mapConfig.heatOptions?.[0];
  const heatColName = activeHeat
    ? state.columns.find(c => activeHeat.candidates.some(k => norm(c.name).includes(norm(k))))?.name
    : null;

  const fmtU = v => v != null ? v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  const fmtN = v => Math.round(v).toLocaleString('es-CL');

  const projCol = state.columns.find(c =>
    mapConfig.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name;

  const byProj = {};
  let heatSum = 0, heatCount = 0;
  for (const r of state.filtered) {
    const proj = projCol ? String(r[projCol] ?? '').trim() : null;
    if (proj) byProj[proj] = true;
    if (heatColName) {
      const v = Number(r[heatColName]);
      if (!isNaN(v) && v > 0) { heatSum += v; heatCount++; }
    }
  }

  const totalProy = Object.keys(byProj).length;
  const avgHeat = heatCount ? heatSum / heatCount : null;

  body.innerHTML = `
    <div class="mfw-row" style="border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:4px;">
      <span class="mfw-label" style="font-weight:700">Proyectos</span>
      <span class="mfw-value" style="font-weight:700">${fmtN(totalProy)}</span>
    </div>
    <div class="mfw-row">
      <span class="mfw-label">Unidades</span>
      <span class="mfw-value">${fmtN(state.filtered.length)}</span>
    </div>
    ${avgHeat != null ? `<div class="mfw-row">
      <span class="mfw-label">${activeHeat?.label ?? 'Métrica'} prom.</span>
      <span class="mfw-value">${fmtU(avgHeat)}</span>
    </div>` : ''}
  `;
}

function _initResumenWidget(state, mapConfig) {
  const toggleBtn = document.getElementById('mapResumenWidgetBtn');
  if (!toggleBtn || _resumenInited) return;
  _resumenInited = true;

  const widget = document.createElement('div');
  widget.id = 'mapResumenWidget';
  widget.className = 'map-filter-widget hidden';
  widget.innerHTML = `
    <div class="mfw-header" id="mapResumenHeader">
      <span>Resumen</span>
      <button class="mfw-close" id="mapResumenClose">&#xD7;</button>
    </div>
    <div class="mfw-body" id="mapResumenBody"></div>
  `;
  leafletMap.getContainer().appendChild(widget);
  L.DomEvent.disableClickPropagation(widget);
  L.DomEvent.disableScrollPropagation(widget);

  const header = document.getElementById('mapResumenHeader');
  header.addEventListener('mousedown', e => {
    if (e.target.id === 'mapResumenClose') return;
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

  document.getElementById('mapResumenClose').addEventListener('click', () => {
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
        widget.style.top  = '90px';
      }
      _updateResumenWidget(state, mapConfig);
    }
  });
}

function _initLeafletMap(state, mapConfig, mp) {
  _selState     = state;
  _selMapConfig = mapConfig;
  state._projCol = state.columns.find(c =>
    mapConfig.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name ?? null;
  leafletMap = L.map('map', { zoomSnap: 0.5, wheelPxPerZoomLevel: 350 });
  _initRankingResize();

  _streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19,
    crossOrigin: 'anonymous',
  });
  _satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
    crossOrigin: 'anonymous',
  });
  _streetLayer.addTo(leafletMap);

  markersLayer = L.layerGroup().addTo(leafletMap);

  document.getElementById('mapSatelliteBtn')?.addEventListener('click', () => {
    _isSatellite = !_isSatellite;
    if (_isSatellite) {
      leafletMap.removeLayer(_streetLayer);
      _satelliteLayer.addTo(leafletMap);
      _satelliteLayer.bringToBack();
    } else {
      leafletMap.removeLayer(_satelliteLayer);
      _streetLayer.addTo(leafletMap);
      _streetLayer.bringToBack();
    }
    document.getElementById('mapSatelliteBtn')?.classList.toggle('active', _isSatellite);
  });

  document.getElementById('mapTableExportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('mapTableExportBtn');
    btn.textContent = 'Copiando…';
    btn.disabled = true;
    try {
      await _copyMapTable(state, mapConfig);
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar tabla'; btn.disabled = false; }, 2000);
    } catch (err) {
      console.error(err);
      btn.textContent = 'Copiar tabla';
      btn.disabled = false;
    }
  });

  legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-price-legend'); div.id = 'mapPriceLegend';
    div.innerHTML = `<span class="leg-lbl" id="legLblMin">—</span><div class="leg-bar"></div><span class="leg-lbl" id="legLblMax">—</span>`;
    return div;
  };

  countControl = L.control({ position: 'bottomright' });
  countControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-count-ctrl'); div.id = 'mapCountCtrl'; return div;
  };
  countControl.addTo(leafletMap);

  // Mode buttons (only General / De calor — buttons with data-mode)
  document.querySelectorAll('.map-mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mapMode = btn.dataset.mode;
      const pills = document.getElementById('heatMetricPills');
      if (pills) pills.classList.toggle('hidden', mapMode !== 'precio');
      renderMap(state, mapConfig, mp);
    });
  });

  // Heat metric buttons
  document.querySelectorAll('.heat-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.heat-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      heatMetric = btn.dataset.metric;
      renderMap(state, mapConfig, mp);
    });
  });

  // Init default heat metric from config
  if (!heatMetric && mapConfig.heatOptions?.length) {
    heatMetric = mapConfig.heatOptions[0].value;
  }

  _initSelectionMode();
  _initFilterWidget();
  _initResumenWidget(state, mapConfig);
}

// ── Popup ─────────────────────────────────────────────────────────────────

function _findPopupCol(keys, state) {
  return state.columns.find(c => keys.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

function _buildPopup(row, mapConfig, state) {
  const esc = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rowsHtml = mapConfig.popupFields.map(field => {
    const colName = _findPopupCol(field.keys, state);
    if (!colName) return '';
    const raw = row[colName];
    if (raw === '' || raw == null) return '';
    let val;
    if (field.format) {
      val = field.format(raw);
    } else if (typeof raw === 'number' || !isNaN(Number(raw))) {
      val = fmt(raw);
    } else if (String(raw).startsWith('http')) {
      val = `<a href="${esc(raw)}" target="_blank" rel="noopener">Ver</a>`;
    } else {
      val = esc(String(raw));
    }
    return `<tr><td class="pp-key">${field.label}</td><td class="pp-val">${val}</td></tr>`;
  }).join('');
  return `<table class="map-popup">${rowsHtml}</table>`;
}

// ── Ranking ───────────────────────────────────────────────────────────────

function _renderRanking(state, mapConfig) {
  const el = document.getElementById('mapRanking');
  if (!el) return;

  const projCol = state.columns.find(c =>
    mapConfig.projectCandidates.some(k => norm(c.name).includes(norm(k)))
  )?.name;
  if (!projCol) { el.innerHTML = ''; return; }

  const activeHeat = mapConfig.heatOptions?.find(o => o.value === heatMetric) ?? mapConfig.heatOptions?.[0];
  const heatColName = activeHeat
    ? state.columns.find(c => activeHeat.candidates.some(k => norm(c.name).includes(norm(k))))?.name
    : null;

  const byProj = {};
  for (const r of state.filtered) {
    const proj = String(r[projCol] ?? '').trim();
    if (!proj) continue;
    if (!byProj[proj]) byProj[proj] = { metrics: {} };
    for (const opt of (mapConfig.heatOptions ?? [])) {
      const cn = state.columns.find(c => opt.candidates.some(k => norm(c.name).includes(norm(k))))?.name;
      if (!cn) continue;
      if (!byProj[proj].metrics[opt.value]) byProj[proj].metrics[opt.value] = [];
      const v = Number(r[cn]);
      if (!isNaN(v) && v > 0) byProj[proj].metrics[opt.value].push(v);
    }
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const buildings = Object.entries(byProj)
    .map(([proj, d]) => ({
      proj,
      metrics: Object.fromEntries(
        Object.entries(d.metrics).map(([k, arr]) => [k, avg(arr)])
      ),
    }))
    .filter(b => b.metrics[heatMetric] !== null && b.metrics[heatMetric] !== undefined)
    .sort((a, b) => (b.metrics[heatMetric] ?? 0) - (a.metrics[heatMetric] ?? 0));

  const rankLabel = activeHeat ? `${activeHeat.label} ↓` : '↓';
  el.innerHTML = `<div class="map-ranking-title">Proyectos (${buildings.length}) &nbsp;·&nbsp; ${rankLabel}</div>`;

  buildings.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'map-ranking-item';
    const metricsHtml = (mapConfig.heatOptions ?? [])
      .filter(o => b.metrics[o.value] != null)
      .map(o => {
        const v = b.metrics[o.value];
        const formatted = v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
        return `<div class="rk-metric${o.value === heatMetric ? ' rk-ufm2' : ''}"><span>${o.label} </span>${formatted}</div>`;
      }).join('');
    item.innerHTML = `<span class="rk-pos">#${i + 1}</span><div class="rk-name">${b.proj}</div><div class="rk-metrics">${metricsHtml}</div>`;
    el.appendChild(item);
  });
}

// ── Main render ───────────────────────────────────────────────────────────

export function renderMap(state, mapConfig, mp) {
  const placeholder = document.querySelector('.map-placeholder');
  const wrapper     = document.getElementById('mapWrapper');

  _refreshStatus(state);

  const points    = _collectPoints(state, mapConfig);
  const mpHasPoint = mp?.inMapa && mp.proyecto && mp.geocoords;

  if (!points.length && !mpHasPoint) {
    placeholder?.classList.remove('hidden');
    wrapper?.classList.add('hidden');
    const p = placeholder?.querySelector('p');
    if (p) {
      if (_hasDirectCoords(state)) {
        p.textContent = 'No se encontraron coordenadas válidas en los datos filtrados.';
      } else {
        const col = _findAddressCol(state);
        p.textContent = col
          ? (geoStatus.running ? 'Geocodificando, aguarda...' : 'No se encontraron coordenadas para las direcciones filtradas.')
          : 'No se detectaron coordenadas ni columna de dirección en los datos.';
      }
    }
    return;
  }

  placeholder?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  const activeHeat  = mapConfig.heatOptions?.find(o => o.value === heatMetric) ?? mapConfig.heatOptions?.[0];
  const heatColName = activeHeat
    ? state.columns.find(c => activeHeat.candidates.some(k => norm(c.name).includes(norm(k))))?.name
    : null;
  const inPriceMode = mapMode === 'precio' && heatColName;
  wrapper?.classList.toggle('dark-mode', !!inPriceMode);

  if (!leafletMap) _initLeafletMap(state, mapConfig, mp);
  markersLayer.clearLayers();

  let priceMin = 0, priceMax = 1;
  if (inPriceMode) {
    const all = points.flatMap(p => p.rows.map(r => Number(r[heatColName])).filter(v => !isNaN(v) && v > 0));
    if (all.length) { priceMin = Math.min(...all); priceMax = Math.max(...all); }
  }

  const orderedPoints = inPriceMode
    ? points
    : [...points].sort((a, b) => {
        const dLng = a.lng - b.lng;
        return Math.abs(dLng) > 0.0001 ? dLng : b.lat - a.lat;
      });

  _lastOrderedPoints = inPriceMode ? [] : orderedPoints;

  const bounds = [];
  for (let i = 0; i < orderedPoints.length; i++) {
    const { lat, lng, rows } = orderedPoints[i];
    let marker;
    if (inPriceMode) {
      const prices = rows.map(r => Number(r[heatColName])).filter(v => !isNaN(v) && v > 0);
      const avg    = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
      const color  = avg !== null ? _priceToColor(avg, priceMin, priceMax) : '#60a5fa';
      marker = L.circleMarker([lat, lng], {
        radius: 9, fillColor: color, color: '#ffffff',
        weight: 1.5, fillOpacity: 0.96, opacity: 1, className: 'price-marker',
      });
    } else {
      const numIcon = L.divIcon({
        className: '',
        html: `<div class="num-marker">${i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
      });
      marker = L.marker([lat, lng], { icon: numIcon });
    }
    marker.bindPopup(_buildPopup(rows[0], mapConfig, state), { maxWidth: 340 });
    marker.addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // Mi Proyecto marker
  if (mpHasPoint) {
    const { lat, lng } = mp.geocoords;
    const nombre = mp.proyecto || 'Mi Proyecto';
    const mpIcon = L.divIcon({
      className: '',
      html: `<div class="mp-map-marker" title="${String(nombre).replace(/"/g, '&quot;')}"><svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="16" fill="#fff" stroke="#96323C" stroke-width="2.5"/><polyline points="8,23 18,13 28,23" fill="none" stroke="#96323C" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,
      iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
    });
    const esc = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let popHtml = `<table class="map-popup"><tr><td class="pp-key">Proyecto</td><td class="pp-val"><strong>${esc(nombre)}</strong></td></tr>`;
    if (mp.tipologias?.length > 0) {
      for (const t of mp.tipologias) {
        if (!t.nombre) continue;
        const parts = [
          t.sup    != null ? `${t.sup} m² útil`  : null,
          t.ufm2   != null ? `${t.ufm2} UF/m²`   : null,
          t.renta  != null ? `${t.renta} UF`      : null,
        ].filter(Boolean);
        popHtml += `<tr><td class="pp-key">${esc(t.nombre)}</td><td class="pp-val">${parts.join(' · ') || '—'}</td></tr>`;
      }
    } else {
      const parts = [
        mp.arriendo != null ? `${mp.arriendo} UF arriendo` : null,
        mp.ufm2     != null ? `${mp.ufm2} UF/m²`          : null,
        mp.stock    != null ? `Stock: ${mp.stock}`         : null,
        mp.vacancia != null ? `Vacancia: ${mp.vacancia}%`  : null,
      ].filter(Boolean);
      if (parts.length) popHtml += `<tr><td colspan="2" class="pp-val">${parts.join(' · ')}</td></tr>`;
    }
    popHtml += `</table>`;
    L.marker([lat, lng], { icon: mpIcon, zIndexOffset: 1000 })
      .bindPopup(popHtml, { maxWidth: 340 })
      .addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // Legend
  if (inPriceMode) {
    if (!legendControl._map) legendControl.addTo(leafletMap);
    const minEl = document.getElementById('legLblMin');
    const maxEl = document.getElementById('legLblMax');
    if (minEl) minEl.textContent = `${fmt(priceMin)} ${activeHeat.label}`;
    if (maxEl) maxEl.textContent = `${fmt(priceMax)} ${activeHeat.label}`;
  } else {
    if (legendControl._map) legendControl.remove();
  }

  // Counter
  const countEl = document.getElementById('mapCountCtrl');
  if (countEl) countEl.textContent = `Mostrando ${points.length} proyecto${points.length !== 1 ? 's' : ''}`;

  if (!_mapInitialized) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
    _mapInitialized = true;
  }
  setTimeout(() => leafletMap?.invalidateSize(), 150);

  _renderRanking(state, mapConfig);
  _updateResumenWidget(state, mapConfig);
}
