import { state } from './data.js';
import { $, fmt } from './utils.js';

// ============== Cache y estado ==============
const cache = new Map();
const geoStatus = { total: 0, done: 0, running: false };
let mapMode = 'general'; // 'general' | 'precio'

// ============== Helpers ==============
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function findAddressCol() {
  const keywords = ['direccion', 'address', 'domicilio', 'ubicacion', 'calle'];
  return state.columns.find(c => keywords.some(k => norm(c.name).includes(k)));
}

function findUfm2Col() {
  return state.columns.find(c => norm(c.name).includes('uf/m') || norm(c.name).includes('uf / m'))?.name ?? null;
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
let mapInitialized = false;
let legendControl = null;
let countControl = null;

function initLeafletMap() {
  leafletMap = L.map('map');
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

  // Botones de modo
  document.querySelectorAll('.map-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mapMode = btn.dataset.mode;
      renderMap();
    });
  });
}

export function renderMap() {
  const col = findAddressCol();
  const placeholder = document.querySelector('.map-placeholder');
  const wrapper = document.getElementById('mapWrapper');

  refreshStatus();

  if (!col) {
    placeholder.classList.remove('hidden');
    wrapper.classList.add('hidden');
    return;
  }

  // Agrupar filas filtradas por dirección única → un marcador por edificio
  const buildings = new Map();
  for (const r of state.filtered) {
    const addr = String(r[col.name] ?? '').trim();
    const coords = cache.get(addr);
    if (!coords) continue;
    if (!buildings.has(addr)) buildings.set(addr, { ...coords, rows: [] });
    buildings.get(addr).rows.push(r);
  }
  const points = [...buildings.values()];

  if (!points.length) {
    placeholder.classList.remove('hidden');
    wrapper.classList.add('hidden');
    const p = placeholder.querySelector('p');
    if (p) p.textContent = geoStatus.running
      ? 'Geocodificando direcciones, aguarda un momento...'
      : 'No se encontraron coordenadas para las direcciones en los datos filtrados.';
    return;
  }

  placeholder.classList.add('hidden');
  wrapper.classList.remove('hidden');

  if (!leafletMap) initLeafletMap();

  markersLayer.clearLayers();

  const ufm2Col = findUfm2Col();
  const inPriceMode = mapMode === 'precio' && ufm2Col;

  // Calcular rango de precios para la escala de color
  let priceMin = 0, priceMax = 1;
  if (inPriceMode) {
    const allPrices = points.flatMap(p =>
      p.rows.map(r => Number(r[ufm2Col])).filter(v => !isNaN(v))
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
      const prices = rows.map(r => Number(r[ufm2Col])).filter(v => !isNaN(v));
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
      const color = avg !== null ? priceToColor(avg, priceMin, priceMax) : '#94a3b8';
      marker = L.circleMarker([lat, lng], {
        radius: 9,
        fillColor: color,
        color: 'rgba(0,0,0,0.25)',
        weight: 1,
        fillOpacity: 0.92,
      });
    } else {
      marker = L.marker([lat, lng]);
    }

    marker.bindPopup(buildPopup(rows[0]), { maxWidth: 340 });
    marker.addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // Leyenda
  if (inPriceMode) {
    if (!legendControl._map) legendControl.addTo(leafletMap);
    const minEl = document.getElementById('legLblMin');
    const maxEl = document.getElementById('legLblMax');
    if (minEl) minEl.textContent = `${fmt(priceMin)} UF/m²`;
    if (maxEl) maxEl.textContent = `${fmt(priceMax)} UF/m²`;
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
}

// ============== Popup ==============
const POPUP_FIELDS = ['Edificio', 'Propietario', 'Estado', 'Oferta total', '% Vendido', 'Vel. Venta (un./mes)', 'Promedio útil', 'Ticket UF', 'UF/m²'];

function buildPopup(row) {
  const n = s => norm(s).replace(/\s+/g, ' ').trim();
  const rowsHtml = POPUP_FIELDS.map(field => {
    const col = state.columns.find(c => n(c.name) === n(field));
    if (!col) return '';
    const v = row[col.name];
    if (v === '' || v == null) return '';
    return `<tr><td class="pp-key">${col.name}</td><td class="pp-val">${v}</td></tr>`;
  }).join('');
  return `<table class="map-popup">${rowsHtml}</table>`;
}
