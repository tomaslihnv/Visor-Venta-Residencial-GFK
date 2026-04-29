import { state } from './data.js';
import { $ } from './utils.js';

// ============== Cache y estado de geocodificacion ==============
const cache = new Map(); // address -> {lat, lng} | null
const geoStatus = { total: 0, done: 0, running: false };

// ============== Helpers ==============
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function findAddressCol() {
  const keywords = ['direccion', 'address', 'domicilio', 'ubicacion', 'calle'];
  return state.columns.find(c => keywords.some(k => norm(c.name).includes(k)));
}

async function fetchGeocode(addr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============== Geocodificacion ==============
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
    if (i < pending.length - 1) await sleep(1100); // respetar rate limit de Nominatim
  }

  geoStatus.running = false;
  refreshStatus();

  // Si el tab mapa esta activo, renderizar automaticamente
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

export function renderMap() {
  const col = findAddressCol();
  const placeholder = document.querySelector('.map-placeholder');
  const mapEl = $('#map');

  refreshStatus();

  if (!col) {
    placeholder.classList.remove('hidden');
    mapEl.classList.add('hidden');
    return;
  }

  const points = state.filtered
    .map(r => {
      const addr = String(r[col.name] ?? '').trim();
      const coords = cache.get(addr);
      return coords ? { row: r, ...coords } : null;
    })
    .filter(Boolean);

  if (!points.length) {
    placeholder.classList.remove('hidden');
    mapEl.classList.add('hidden');
    const p = placeholder.querySelector('p');
    if (p) {
      p.textContent = geoStatus.running
        ? 'Geocodificando direcciones, aguarda un momento...'
        : 'No se encontraron coordenadas para las direcciones en los datos filtrados.';
    }
    return;
  }

  placeholder.classList.add('hidden');
  mapEl.classList.remove('hidden');

  const firstRender = !leafletMap;

  if (!leafletMap) {
    leafletMap = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '(c) <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(leafletMap);
    markersLayer = L.layerGroup().addTo(leafletMap);
  }

  markersLayer.clearLayers();

  const bounds = [];
  for (const { row, lat, lng } of points) {
    L.marker([lat, lng])
      .bindPopup(buildPopup(row), { maxWidth: 340 })
      .addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  if (firstRender || !mapInitialized) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
    mapInitialized = true;
  }
  setTimeout(() => leafletMap.invalidateSize(), 150);
}

function buildPopup(row) {
  const rowsHtml = state.columns
    .filter(c => row[c.name] !== '' && row[c.name] != null)
    .map(c => `<tr><td class="pp-key">${c.name}</td><td class="pp-val">${row[c.name]}</td></tr>`)
    .join('');
  return `<table class="map-popup">${rowsHtml}</table>`;
}