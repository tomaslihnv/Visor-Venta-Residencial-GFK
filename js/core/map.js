import { fmt, norm } from './utils.js';

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

export function resetMapOnLoad() {
  _mapInitialized = false;
  geoStatus.total = 0; geoStatus.done = 0; geoStatus.running = false;
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

function _initLeafletMap(state, mapConfig, mp) {
  leafletMap   = L.map('map');
  _initRankingResize();

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors', maxZoom: 19,
  }).addTo(leafletMap);

  markersLayer = L.layerGroup().addTo(leafletMap);

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

  // Mode buttons
  document.querySelectorAll('.map-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.remove('active'));
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

  const bounds = [];
  for (const point of points) {
    const { lat, lng, rows } = point;
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
      marker = L.marker([lat, lng]);
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
      html: `<div class="mp-map-marker" title="${String(nombre).replace(/"/g, '&quot;')}">★</div>`,
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
}
