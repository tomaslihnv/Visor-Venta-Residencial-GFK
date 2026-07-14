import { INCITI_PROXY_URL } from '../config.js';

const ENDPOINT_PATH = 'get_insights_pro';
const MAX_AREA_KM2  = 25;

// ── Área ───────────────────────────────────────────────────────────────────

export function calcAreaKm2(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  const n = polygon.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].lng * polygon[j].lat;
    area -= polygon[j].lng * polygon[i].lat;
  }
  const centerLat = polygon.reduce((s, v) => s + v.lat, 0) / n;
  return Math.abs(area) / 2 * 111 * 111 * Math.cos(centerLat * Math.PI / 180);
}

function _gridPartition(polygon) {
  const lats   = polygon.map(v => v.lat);
  const lngs   = polygon.map(v => v.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const centerLat  = (minLat + maxLat) / 2;
  const boxH       = Math.abs(maxLat - minLat) * 111;
  const boxW       = Math.abs(maxLng - minLng) * 111 * Math.cos(centerLat * Math.PI / 180);
  if (boxH * boxW <= MAX_AREA_KM2) return [polygon];

  const MAX_SIDE = 4.5;
  const cols = Math.ceil(boxW / MAX_SIDE);
  const rows = Math.ceil(boxH / MAX_SIDE);
  const dLat = (maxLat - minLat) / rows;
  const dLng = (maxLng - minLng) / cols;

  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push([
        { lat: minLat + r * dLat,       lng: minLng + c * dLng       },
        { lat: minLat + r * dLat,       lng: minLng + (c + 1) * dLng },
        { lat: minLat + (r + 1) * dLat, lng: minLng + (c + 1) * dLng },
        { lat: minLat + (r + 1) * dLat, lng: minLng + c * dLng       },
      ]);
  return cells;
}

// ── Normalización ──────────────────────────────────────────────────────────

export function flattenEntities(entities) {
  return entities.flatMap(entity => {
    const loc    = entity.location ?? {};
    const period = entity.periods?.[entity.periods.length - 1];
    if (!period) return [];

    const lat = loc.lat ?? null, lng = loc.lng ?? null;
    const base = {
      'Nombre':    entity.name      ?? entity.id ?? '',
      'Corredor':  entity.owner     ?? entity.developer ?? '',
      'Comuna':    loc.commune      ?? loc.comuna ?? '',
      'Operación': 'Arriendo',
      'Tipo':      'Oficina',
    };
    if (lat != null && lng != null) { base['__lat'] = Number(lat); base['__lng'] = Number(lng); }

    const stages = period.stages ?? [];
    return stages.flatMap(stage =>
      (stage.programs ?? []).map(prog => ({
        ...base,
        'Precio UF': _num(prog.priceUF ?? prog.rentUF),
        'UF/m²':     _num(prog.ufPerM2 ?? prog.priceUfPerM2 ?? prog.rentUfPerM2),
        'Útil (m²)': _num(prog.avgUsefulM2 ?? prog.sellableM2 ?? prog.usefulM2),
      })).filter(r => r['Precio UF'] != null && r['Precio UF'] > 0)
    );
  });
}

function _pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function _fetchPolygon(polygon) {
  const url = INCITI_PROXY_URL.replace(/\/$/, '') + '/' + ENDPOINT_PATH;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ market: 'oficinas', polygons: [polygon] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status}${text ? ': ' + text : ''}`);
  }
  return res.json();
}

export async function queryArea({ polygons, onProgress } = {}) {
  if (!INCITI_PROXY_URL) {
    throw new Error('Falta configurar INCITI_PROXY_URL en js/config.js.');
  }

  const cells = _gridPartition((polygons ?? [])[0] ?? []);
  const total = cells.length;

  if (total > 1) onProgress?.(`Área grande — dividida en ${total} zonas. Consultando…`);
  else           onProgress?.('Conectando con Inciti…');

  const seen = new Map();
  let fetched = 0;

  for (const cell of cells) {
    if (total > 1) onProgress?.(`Consultando zona ${++fetched} de ${total}…`);
    let payload;
    try { payload = await _fetchPolygon(cell); }
    catch (err) {
      if (total === 1) throw err;
      console.warn('[Inciti/oficinas] Error en sub-zona:', err.message);
      continue;
    }

    if (payload.modulesAvailable?.projects === false || payload.projects == null) continue;
    for (const entity of (payload.projects?.entities ?? [])) {
      const key = entity.id ?? entity.name ?? String(seen.size);
      if (!seen.has(key)) seen.set(key, entity);
    }
  }

  if (!seen.size) {
    throw new Error('El área seleccionada no contiene proyectos de oficinas en Inciti.');
  }

  const originalPolygon = (polygons ?? [])[0] ?? [];
  const all = [...seen.values()];
  if (originalPolygon.length < 3) return all;

  return all.filter(e => {
    const lat = e.location?.lat, lng = e.location?.lng;
    return lat != null && lng != null && _pointInPolygon(lat, lng, originalPolygon);
  });
}
