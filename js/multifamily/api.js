import { INCITI_PROXY_URL } from '../config.js';

const ENDPOINT_PATH = 'get_insights_pro';
const MAX_AREA_KM2  = 25;

const DEFAULT_POLYGONS = [
  [
    { lat: -33.3489, lng: -70.7432 },
    { lat: -33.3489, lng: -70.5098 },
    { lat: -33.6489, lng: -70.5098 },
    { lat: -33.6489, lng: -70.7432 },
  ],
];

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

  // 1. Calcular el centro de latitud para la distorsión de la Tierra
  const centerLat = (minLat + maxLat) / 2;
  const latToKm = 111;
  const lngToKm = 111 * Math.cos(centerLat * Math.PI / 180);

  // 2. Calcular los kilómetros reales del ancho y alto de la caja completa (Bounding Box)
  const boxHeightKm = Math.abs(maxLat - minLat) * latToKm;
  const boxWidthKm  = Math.abs(maxLng - minLng) * lngToKm;
  const boxAreaKm2  = boxHeightKm * boxWidthKm;

  // Si toda la caja envolvente ya mide menos de 25 km², pasamos directo
  if (boxAreaKm2 <= MAX_AREA_KM2) return [polygon];

  // 3. Forzar un tamaño máximo de lado por celda de 4.5 km para ir súper seguros por debajo de los 5 km (25 km²)
  const MAX_CELL_SIDE_KM = 4.5;

  // 4. Calcular cuántas columnas y filas necesitamos para que ningún lado supere el límite geográfico
  const cols = Math.ceil(boxWidthKm / MAX_CELL_SIDE_KM);
  const rows = Math.ceil(boxHeightKm / MAX_CELL_SIDE_KM);

  const dLat = (maxLat - minLat) / rows;
  const dLng = (maxLng - minLng) / cols;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Re-armamos el rectángulo perfecto para cada cuadrante
      cells.push([
        { lat: minLat + r * dLat,       lng: minLng + c * dLng       },
        { lat: minLat + r * dLat,       lng: minLng + (c + 1) * dLng },
        { lat: minLat + (r + 1) * dLat, lng: minLng + (c + 1) * dLng },
        { lat: minLat + (r + 1) * dLat, lng: minLng + c * dLng       },
      ]);
    }
  }

  console.log(`[Grilla BBox] Caja total: ${boxWidthKm.toFixed(1)}x${boxHeightKm.toFixed(1)} km (~${boxAreaKm2.toFixed(1)} km²).`);
  console.log(`[Grilla BBox] Dividido de forma segura en una matriz de ${rows}x${cols} (${cells.length} sub-zonas).`);
  
  return cells;
}

// ── Normalización ──────────────────────────────────────────────────────────

function _lastPeriod(periods) {
  if (!Array.isArray(periods) || !periods.length) return null;
  return periods[periods.length - 1];
}

function _flattenProject(entity) {
  const rows   = [];
  const loc    = entity.location ?? {};
  const period = _lastPeriod(entity.periods);
  if (!period) return rows;

  const base = {
    'Proyecto':      entity.name          ?? entity.id ?? '',
    'Propietario':   entity.owner         ?? '',
    'Administrador': entity.administrator ?? '',
    'Comuna':        loc.commune          ?? loc.comuna ?? '',
    'Período':       period.label         ?? period.key ?? '',
  };
  const lat = loc.lat ?? null;
  const lng = loc.lng ?? null;
  if (lat != null && lng != null) {
    base['__lat'] = Number(lat);
    base['__lng'] = Number(lng);
  }

  for (const prog of (period.programs ?? [])) {
    const vac    = _num(prog.vacancy);
    const vacPct = vac != null ? Math.round(vac * 100 * 10) / 10 : null;
    rows.push({
      ...base,
      'Programa':       prog.program ?? '',
      'Stock':          _num(prog.stock),
      'Disponibilidad': _num(prog.available),
      'Vacancia (%)':   vacPct,
      'Ocupación (%)':  vacPct != null ? Math.round((100 - vacPct) * 10) / 10 : null,
      'Útil (m²)':      _num(prog.usefulM2),
      'Arriendo UF':    _num(prog.rentUF),
      'UF/m²':          _num(prog.rentUfPerM2),
      'Estado Prog.':   prog.status ?? '',
    });
  }
  return rows;
}

export function flattenEntities(entities) {
  return entities.flatMap(_flattenProject).filter(r => {
    const v = r['Arriendo UF'];
    return v != null && !isNaN(v) && v > 0;
  });
}

// ── Histórico: a diferencia de flattenEntities (que solo toma el último
// período), esta conserva TODOS los períodos de entity.periods — es la
// serie trimestral completa que ya trae Inciti por proyecto, y con esto el
// tab Histórico se arma sobre la consulta actual en vez de snapshots JSON
// guardados aparte. Misma forma de fila que los JSON históricos previos
// (Proyecto, Período Key, Programa, etc.) para no tocar historico.js.
function _flattenProjectHistorico(entity) {
  const rows = [];
  const loc  = entity.location ?? {};
  const base = {
    'Proyecto':      entity.name          ?? entity.id ?? '',
    'Propietario':   entity.owner         ?? '',
    'Administrador': entity.administrator ?? '',
    'Comuna':        loc.commune          ?? loc.comuna ?? '',
  };
  const lat = loc.lat ?? null;
  const lng = loc.lng ?? null;
  if (lat != null && lng != null) {
    base['__lat'] = Number(lat);
    base['__lng'] = Number(lng);
  }

  for (const period of (entity.periods ?? [])) {
    const periodBase = {
      ...base,
      'Período':     period.label ?? period.key ?? '',
      'Período Key': period.key   ?? '',
      'Año':         period.year  ?? null,
      'Trimestre':   period.n     ?? null,
    };
    for (const prog of (period.programs ?? [])) {
      const vac    = _num(prog.vacancy);
      const vacPct = vac != null ? Math.round(vac * 100 * 10) / 10 : null;
      rows.push({
        ...periodBase,
        'Programa':       prog.program ?? '',
        'Stock':          _num(prog.stock),
        'Disponibilidad': _num(prog.available),
        'Vacancia (%)':   vacPct,
        'Ocupación (%)':  vacPct != null ? Math.round((100 - vacPct) * 10) / 10 : null,
        'Útil (m²)':      _num(prog.usefulM2),
        'Arriendo UF':    _num(prog.rentUF),
        'UF/m²':          _num(prog.rentUfPerM2),
        'Estado Prog.':   prog.status ?? '',
      });
    }
  }
  return rows;
}

// A diferencia de flattenEntities, NO filtramos por Arriendo UF > 0 acá:
// un programa con 0 disponibilidad ese trimestre (nada arrendándose) reporta
// rentUF=0, y si se descarta la fila completa se pierde también su aporte
// al Stock — haciendo que el stock total "fluctúe" sin que el edificio haya
// perdido unidades. Historico necesita el Stock/Disponibilidad de TODAS las
// filas; el promedio de Arriendo UF excluye los ceros por su cuenta (ver
// _avgPositive en historico.js).
export function flattenEntitiesHistorico(entities) {
  return entities.flatMap(_flattenProjectHistorico);
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
    body:    JSON.stringify({ market: 'multifamily', polygons: [polygon] }),
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

  const srcPolygon  = (polygons ?? DEFAULT_POLYGONS)[0];
  const cells       = _gridPartition(srcPolygon);
  const total       = cells.length;

  if (total > 1) {
    onProgress?.(`Área grande — dividida en ${total} zonas. Consultando…`);
  } else {
    onProgress?.('Conectando con Inciti…');
  }

  const seen    = new Map();
  let   fetched = 0;

  for (const cell of cells) {
    if (total > 1) onProgress?.(`Consultando zona ${++fetched} de ${total}…`);
    let payload;
    try {
      payload = await _fetchPolygon(cell);
    } catch (err) {
      if (total === 1) throw err;
      console.warn('[Inciti] Error en sub-zona, continuando:', err.message);
      continue;
    }

    if (payload.modulesAvailable?.projects === false || payload.projects == null) continue;
    for (const entity of (payload.projects?.entities ?? [])) {
      const key = entity.id ?? entity.name ?? String(seen.size);
      if (!seen.has(key)) seen.set(key, entity);
    }
  }

  if (!seen.size) {
    throw new Error('El área seleccionada no contiene proyectos multifamily en Inciti.');
  }

  const all = [...seen.values()];
  if (srcPolygon.length < 3) return all;

  return all.filter(e => {
    const lat = e.location?.lat, lng = e.location?.lng;
    return lat != null && lng != null && _pointInPolygon(lat, lng, srcPolygon);
  });
}
