import { state } from './data.js';
import { $, fmt } from './utils.js';
import { mp } from './miProyecto.js';

// ============== Cache y estado ==============
const cache = new Map();
const geoStatus = { total: 0, done: 0, running: false };
let mapMode = 'general'; // 'general' | 'precio'

export function resetMapOnLoad() {
  mapInitialized = false;
  geoStatus.total = 0;
  geoStatus.done = 0;
  geoStatus.running = false;
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
    const edifCol = state.columns.find(c =>
      ['edificio', 'proyecto', 'building'].some(k => norm(c.name).includes(k))
    )?.name;
    for (const r of rows) {
      const lat = Number(r['__lat']);
      const lng = Number(r['__lng']);
      if (isNaN(lat) || isNaN(lng)) continue;
      const key = edifCol ? String(r[edifCol] ?? '').trim() : `${lat},${lng}`;
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
    el.textContent = `Coordenadas directas del archivo (${state.raw.length} filas).`;
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
let mapInitialized = false;
let legendControl = null;
let countControl = null;
let lastOrderedPoints = [];

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

async function copyMapTable() {
  if (!lastOrderedPoints.length) return;

  const edifCol   = state.columns.find(c => ['edificio', 'proyecto', 'building'].some(k => norm(c.name).includes(k)))?.name;
  const propCol   = state.columns.find(c => ['propietario', 'owner', 'inmobiliaria'].some(k => norm(c.name).includes(k)))?.name;
  const ofertaCol = state.columns.find(c => ['oferta total', 'oferta'].some(k => norm(c.name).includes(k)) && c.type === 'number')?.name;
  const dispCol   = ofertaCol ? null : state.columns.find(c => norm(c.name).includes('disponib') && c.type === 'number')?.name;
  const ufm2ColN  = findUfm2Col();

  const fmtN  = v => v != null ? Math.round(v).toLocaleString('es-CL') : '—';
  const fmtU  = v => v != null ? v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';

  const rows = lastOrderedPoints.map((pt, i) => {
    const edif = edifCol ? String(pt.rows[0]?.[edifCol] ?? '—') : '—';
    const prop = propCol ? String(pt.rows[0]?.[propCol] ?? '—') : '—';

    let stock = null;
    if (ofertaCol) {
      const vals = pt.rows.map(r => Number(r[ofertaCol])).filter(v => !isNaN(v) && v > 0);
      if (vals.length) stock = Math.max(...vals);
    } else if (dispCol) {
      const vals = pt.rows.map(r => Number(r[dispCol])).filter(v => !isNaN(v) && v >= 0);
      if (vals.length) stock = vals.reduce((a, b) => a + b, 0);
    }

    let ufm2 = null;
    if (ufm2ColN) {
      const vals = pt.rows.map(r => Number(r[ufm2ColN])).filter(v => !isNaN(v) && v > 0);
      if (vals.length) ufm2 = vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    return { n: i + 1, edif, prop, stock, ufm2 };
  });

  const totalStock = rows.reduce((s, r) => s + (r.stock ?? 0), 0);
  const ufm2Vals   = rows.filter(r => r.ufm2 != null).map(r => r.ufm2);
  const avgUfm2    = ufm2Vals.length ? ufm2Vals.reduce((a, b) => a + b, 0) / ufm2Vals.length : null;

  const TH  = 'background:#1e3a5f;color:#fff;font-weight:700;font-size:8pt;padding:6px 10px;border:1px solid #1e3a5f;white-space:nowrap;font-family:Roboto,Arial,sans-serif;text-align:left;';
  const THR = TH + 'text-align:right;';
  const TD  = 'font-size:8pt;padding:6px 10px;border:1px solid #e5e7eb;white-space:nowrap;font-family:Roboto,Arial,sans-serif;color:#0f172a;';
  const TDR = TD + 'text-align:right;';
  const TF  = TD + 'font-weight:700;background:#f8fafc;';
  const TFR = TF + 'text-align:right;';

  const bodyHtml = rows.map(r => `<tr>
    <td style="${TD}">${r.n}</td>
    <td style="${TD}">${r.edif}</td>
    <td style="${TD}">${r.prop}</td>
    <td style="${TDR}">${fmtN(r.stock)}</td>
    <td style="${TDR}">${fmtU(r.ufm2)}</td>
  </tr>`).join('');

  const footHtml = `<tr>
    <td style="${TF}" colspan="3">Resumen</td>
    <td style="${TFR}">${fmtN(totalStock)}</td>
    <td style="${TFR}">${fmtU(avgUfm2)}</td>
  </tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
  <table style="border-collapse:collapse;font-family:Roboto,Arial,sans-serif;font-size:8pt;">
    <thead><tr>
      <th style="${TH}">N°</th>
      <th style="${TH}">Edificio</th>
      <th style="${TH}">Propietario</th>
      <th style="${THR}">Stock Total</th>
      <th style="${THR}">UF/m²</th>
    </tr></thead>
    <tbody>${bodyHtml}</tbody>
    <tfoot>${footHtml}</tfoot>
  </table></body></html>`;

  await navigator.clipboard.write([
    new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
  ]);
}

function initLeafletMap() {
  leafletMap = L.map('map', { zoomSnap: 0.25, wheelPxPerZoomLevel: 120 });
  initRankingResize();
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19,
    crossOrigin: 'anonymous',
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

  // Copiar tabla
  document.getElementById('mapTableExportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('mapTableExportBtn');
    btn.textContent = 'Copiando…';
    btn.disabled = true;
    try {
      await copyMapTable();
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar tabla'; btn.disabled = false; }, 2000);
    } catch (err) {
      console.error(err);
      btn.textContent = 'Copiar tabla';
      btn.disabled = false;
    }
  });

  // Copiar imagen
  document.getElementById('mapExportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('mapExportBtn');
    btn.textContent = 'Generando…';
    btn.disabled = true;
    try {
      const canvas = await _captureMapCanvas(3);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas tainted')), 'image/png')
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar imagen'; btn.disabled = false; }, 2000);
    } catch (err) {
      console.error('Error exportando mapa:', err);
      btn.textContent = 'Copiar imagen';
      btn.disabled = false;
    }
  });
}

export function renderMap() {
  const placeholder = document.querySelector('.map-placeholder');
  const wrapper = document.getElementById('mapWrapper');

  refreshStatus();

  const points = collectPoints(state.filtered);
  const mpHasPoint = mp.inMapa && mp.edificio && mp.geocoords;

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
          : 'Aún no detecté direcciones válidas en tus datos. Cuando incluyas una columna llamada Dirección (o similar), los proyectos aparecerán en el mapa.';
      }
    }
    return;
  }

  placeholder.classList.add('hidden');
  wrapper.classList.remove('hidden');

  const ufm2Col = findUfm2Col();
  const inPriceMode = mapMode === 'precio' && ufm2Col;
  wrapper.classList.toggle('dark-mode', inPriceMode);

  if (!leafletMap) initLeafletMap();
  markersLayer.clearLayers();


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

  // En modo general: ordenar izquierda→derecha (lng asc), luego arriba→abajo (lat desc)
  const orderedPoints = inPriceMode
    ? points
    : [...points].sort((a, b) => {
        const dLng = a.lng - b.lng;
        return Math.abs(dLng) > 0.0001 ? dLng : b.lat - a.lat;
      });

  lastOrderedPoints = inPriceMode ? [] : orderedPoints;

  const bounds = [];
  for (let i = 0; i < orderedPoints.length; i++) {
    const { lat, lng, rows } = orderedPoints[i];
    let marker;

    if (inPriceMode) {
      const prices = rows.map(r => Number(r[ufm2Col])).filter(v => !isNaN(v));
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
      const numIcon = L.divIcon({
        className: '',
        html: `<div class="num-marker">${i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
      });
      marker = L.marker([lat, lng], { icon: numIcon });
    }

    marker.bindPopup(buildPopup(rows[0]), { maxWidth: 340 });
    marker.addTo(markersLayer);
    bounds.push([lat, lng]);
  }

  // ── Marcador Mi Proyecto ──
  if (mpHasPoint) {
    const { lat, lng } = mp.geocoords;
    const mpIcon = L.divIcon({
      className: '',
      html: `<div class="mp-map-marker" title="${String(mp.edificio).replace(/"/g, '&quot;')}"><svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="16" fill="#fff" stroke="#96323C" stroke-width="2.5"/><polyline points="8,23 18,13 28,23" fill="none" stroke="#96323C" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20],
    });
    const escH = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let popHtml = `<table class="map-popup">
      <tr><td class="pp-key">Edificio</td><td class="pp-val"><strong>${escH(mp.edificio)}</strong></td></tr>`;
    if (mp.propietario) popHtml += `<tr><td class="pp-key">Propietario</td><td class="pp-val">${escH(mp.propietario)}</td></tr>`;
    for (const t of mp.tipologias) {
      if (!t.nombre) continue;
      const parts = [
        t.sup    != null ? `${t.sup} m² útil`   : null,
        t.ufm2   != null ? `${t.ufm2} UF/m²`    : null,
        t.ticket != null ? `${t.ticket} UF tick.`: null,
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

  renderRanking();
}

// ============== Ranking lateral ==============
function renderRanking() {
  const el = document.getElementById('mapRanking');
  if (!el) return;

  const edifCol   = state.columns.find(c => ['edificio', 'proyecto', 'building'].some(k => norm(c.name).includes(k)))?.name;
  const propCol   = state.columns.find(c => ['propietario', 'owner', 'inmobiliaria'].some(k => norm(c.name).includes(k)))?.name;
  const supCol    = state.columns.find(c =>
    c.type === 'number' && ['útil', 'util', 'vendible', 'sup. út', 'sup út'].some(k => norm(c.name).includes(norm(k)))
  )?.name;
  const ufm2ColN  = findUfm2Col();
  const ticketCol = state.columns.find(c => norm(c.name).includes('ticket'))?.name;

  if (!edifCol || !ufm2ColN) { el.innerHTML = ''; return; }

  const byEdif = {};
  for (const r of state.filtered) {
    const edif = String(r[edifCol] ?? '').trim();
    if (!edif) continue;
    if (!byEdif[edif]) byEdif[edif] = { prop: propCol ? r[propCol] : null, sups: [], ufm2s: [], tickets: [] };
    const sup    = Number(r[supCol]);
    const ufm2   = Number(r[ufm2ColN]);
    const ticket = Number(r[ticketCol]);
    if (supCol    && !isNaN(sup)    && sup > 0)    byEdif[edif].sups.push(sup);
    if (!isNaN(ufm2)   && ufm2 > 0)   byEdif[edif].ufm2s.push(ufm2);
    if (ticketCol && !isNaN(ticket) && ticket > 0) byEdif[edif].tickets.push(ticket);
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const buildings = Object.entries(byEdif)
    .map(([edif, d]) => ({
      edif,
      prop:   d.prop,
      sup:    avg(d.sups),
      ufm2:   avg(d.ufm2s),
      ticket: avg(d.tickets),
    }))
    .filter(b => b.ufm2 !== null)
    .sort((a, b) => b.ufm2 - a.ufm2);

  el.innerHTML = `<div class="map-ranking-title">Edificios (${buildings.length}) &nbsp;·&nbsp; UF/<span style="text-transform:none">m²</span> ↓</div>`;

  buildings.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'map-ranking-item';
    item.innerHTML = `
      <span class="rk-pos">#${i + 1}</span>
      <div class="rk-name">${b.edif}</div>
      ${b.prop ? `<div class="rk-prop">${b.prop}</div>` : ''}
      <div class="rk-metrics">
        ${b.sup    !== null ? `<div class="rk-metric"><span>m² útil </span>${b.sup.toLocaleString('es-CL', { maximumFractionDigits: 1 })}</div>` : ''}
        ${b.ticket !== null ? `<div class="rk-metric"><span>Ticket </span>${Math.round(b.ticket).toLocaleString('es-CL')} UF</div>` : ''}
        ${b.ufm2   !== null ? `<div class="rk-metric rk-ufm2">${b.ufm2.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF/m²</div>` : ''}
      </div>`;
    el.appendChild(item);
  });
}

// ============== Popup ==============
const POPUP_FIELDS = [
  { label: 'Edificio', keys: ['edificio'] },
  { label: 'Propietario', keys: ['propietario'] },
  { label: 'Estado', keys: ['estado'] },
  { label: 'Oferta total', keys: ['oferta total', 'oferta'] },
  { label: '% Vendido', keys: ['% vendido', 'pct vendido', 'vendido'] },
  { label: 'Vel. Venta', keys: ['vel. venta', 'vel venta', 'vel. venta (un./mes)'] },
  { label: 'Útil (m²)', keys: ['útil', 'promedio útil', 'sup útil', 'útil (m²)'] },
  { label: 'UF/m²', keys: ['uf/m²', 'uf/m2', 'uf / m', 'uf/m'] },
  { label: 'Ticket UF', keys: ['ticket uf', 'ticket'] },
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
  if (label === '% Vendido') {
    if (!Number.isFinite(num)) return String(value);
    const pct = Math.abs(num) <= 1.05 ? num * 100 : num;
    return `${pct.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  if (label === 'UF/m²') {
    if (!Number.isFinite(num)) return `<strong>${String(value)}</strong>`;
    return `<strong>${num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>`;
  }
  if (label === 'Ticket UF') {
    if (!Number.isFinite(num)) return fmt(value);
    return num.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  }
  if (label === 'Oferta total') {
    if (!Number.isFinite(num)) return fmt(value);
    return num.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  }
  if (label === 'Vel. Venta') {
    if (!Number.isFinite(num)) return fmt(value);
    return num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  if (label === 'Útil (m²)') {
    if (!Number.isFinite(num)) return fmt(value);
    return `${num.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²`;
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
