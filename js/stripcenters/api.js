import { INCITI_PROXY_URL } from '../config.js';

const ENDPOINT_PATH = 'get_insights_pro';
const MAX_AREA_KM2  = 25;

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
  const centerLat = (minLat + maxLat) / 2;
  const boxH = Math.abs(maxLat - minLat) * 111;
  const boxW = Math.abs(maxLng - minLng) * 111 * Math.cos(centerLat * Math.PI / 180);
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

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export function flattenEntities(entities) {
  return entities.flatMap(entity => {
    if (!entity.periods?.length) return [];

    const loc    = entity.location        ?? {};
    const chars  = entity.characteristics ?? {};
    const actors = entity.actors          ?? {};

    const period = entity.periods.slice().reverse()
      .find(p =>
        (p.prices?.finalTotalUfPerM2 ?? 0) > 0 ||
        (p.vacancy?.totalPercent     ?? 0) >= 0
      )
      ?? entity.periods[entity.periods.length - 1];

    const prices  = period.prices  ?? {};
    const vacancy = period.vacancy ?? {};

    const lat = loc.lat ?? null, lng = loc.lng ?? null;

    // Tenant mix: porcentaje de cada categoría
    const tenantMix = period.tenantMix ?? {};
    const tmCategories = Object.entries(tenantMix)
      .filter(([, v]) => v != null && typeof v === 'object' && v.percent != null)
      .map(([k, v]) => `${k}: ${(v.percent * 100).toFixed(0)}%`)
      .join(', ');

    const row = {
      'Nombre':            entity.name     ?? entity.id ?? '',
      'Corredor':          entity.corridor ?? actors.owner ?? actors.name ?? '',
      'Estado':            entity.status   ?? '',
      'Dirección':         entity.address  ?? '',
      'Comuna':            loc.commune     ?? loc.comuna ?? '',
      'Período':           period.label    ?? period.key ?? '',
      'UF/m² Total':       _num(prices.finalTotalUfPerM2),
      'UF/m² Piso 1':      _num(prices.finalFloor1UfPerM2),
      'GLA (m²)':          _num(chars.gla ?? chars.usableM2 ?? chars.totalM2),
      'Vacancia (%)':      _num(vacancy.totalPercent),
      'Vacancia (m²)':     _num(vacancy.totalM2),
      'Tenant Mix':        tmCategories || null,
    };
    if (lat != null && lng != null) { row['__lat'] = Number(lat); row['__lng'] = Number(lng); }

    return [row];
  }).filter(r =>
    (r['UF/m² Total'] ?? 0) > 0 ||
    (r['GLA (m²)']    ?? 0) > 0 ||
     r['Vacancia (%)'] != null
  );
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

async function _fetchPolygon(polygon) {
  const url = INCITI_PROXY_URL.replace(/\/$/, '') + '/' + ENDPOINT_PATH;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ market: 'stripcenters', polygons: [polygon] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status}${text ? ': ' + text : ''}`);
  }
  return res.json();
}

export async function queryArea({ polygons, onProgress } = {}) {
  if (!INCITI_PROXY_URL) throw new Error('Falta configurar INCITI_PROXY_URL en js/config.js.');

  const srcPolygon = (polygons ?? [])[0] ?? [];
  const cells      = _gridPartition(srcPolygon);
  const total      = cells.length;

  if (total > 1) onProgress?.(`Área grande — dividida en ${total} zonas. Consultando…`);
  else           onProgress?.('Conectando con Inciti…');

  const seen    = new Map();
  let   fetched = 0;

  for (const cell of cells) {
    if (total > 1) onProgress?.(`Consultando zona ${++fetched} de ${total}…`);
    let payload;
    try { payload = await _fetchPolygon(cell); }
    catch (err) {
      if (total === 1) throw err;
      console.warn('[Inciti/stripcenters] Error en sub-zona:', err.message);
      continue;
    }
    if (payload.modulesAvailable?.projects === false || payload.projects == null) continue;
    for (const entity of (payload.projects?.entities ?? [])) {
      const key = entity.id ?? entity.name ?? String(seen.size);
      if (!seen.has(key)) seen.set(key, entity);
    }
  }

  if (!seen.size) throw new Error('El área seleccionada no contiene strip centers en Inciti.');

  const all = [...seen.values()];
  if (srcPolygon.length < 3) return all;
  return all.filter(e => {
    const lat = e.location?.lat, lng = e.location?.lng;
    return lat != null && lng != null && _pointInPolygon(lat, lng, srcPolygon);
  });
}
