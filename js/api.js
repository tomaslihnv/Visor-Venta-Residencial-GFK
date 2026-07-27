import { INCITI_PROXY_URL } from './config.js';
import { getIdToken } from '../shared/auth.js';

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

function _median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function flattenEntities(entities) {
  return entities.flatMap(entity => {
    const loc     = entity.location ?? {};
    const periods = entity.periods ?? [];
    const period  = periods[periods.length - 1];
    if (!period) return [];

    const lat    = loc.lat ?? null, lng = loc.lng ?? null;
    const stages = period.stages ?? [];

    const totalStock  = stages.reduce((s, st) => s + (st.totalStock     ?? 0), 0);
    const totalOferta = stages.reduce((s, st) => s + (st.availableUnits ?? 0), 0);

    // Mediana de netSales por (etapa, programa) sobre TODA la vida reportada
    // del proyecto (desde su primer período hasta el último que Inciti
    // encuestó, sin importar si dejó de reportar hace años — ver 'Última
    // Actualización' para saber cuándo fue eso). netSales ya viene mensual y
    // neto por tipología directo de Inciti (no es acumulado); se guarda la
    // serie mensual completa y se toma la MEDIANA (no el promedio) para que
    // un mes con una venta atípicamente alta o baja no distorsione el
    // número — a diferencia de inferir velocidad desde Stock-Disponible, un
    // programa que queda con 1 unidad disponible para siempre tampoco
    // arrastra la velocidad hacia abajo, porque acá se mide venta real
    // reportada mes a mes, no el remanente de stock.
    const velSeriesByKey = new Map();
    for (const p of periods) {
      for (const st of (p.stages ?? [])) {
        for (const prog of (st.programs ?? [])) {
          const key = `${st.stageCode}::${prog.program}`;
          if (!velSeriesByKey.has(key)) velSeriesByKey.set(key, []);
          velSeriesByKey.get(key).push(Number(prog.netSales) || 0);
        }
      }
    }

    const base = {
      'Edificio':    entity.name         ?? entity.id ?? '',
      'Propietario': entity.developer    ?? entity.owner ?? '',
      'Tipo':        entity.propertyType ?? entity.type ?? 'Departamento',
      'Estado':      entity.status       ?? '',
      'Comuna':      loc.commune         ?? loc.comuna ?? '',
      'Periodo':     period.label        ?? period.key ?? '',
      // Último período en que Inciti registró datos para este proyecto —
      // NO es "hoy": cada proyecto se deja de encuestar en momentos distintos
      // (algunos siguen al día, otros quedaron con la última foto de hace
      // años), y periods[] nunca se corta porque el proyecto se vendió (el
      // último período casi siempre sigue con availableUnits > 0). Ver tab
      // "Actualización" para la distribución real de esto.
      'Última Actualización': period.key ?? '',
    };
    if (lat != null && lng != null) { base['__lat'] = Number(lat); base['__lng'] = Number(lng); }
    if (totalStock > 0) base['% Vendido'] = (totalStock - totalOferta) / totalStock;

    return stages.flatMap(stage => {
      const dates = stage.dates ?? {};
      return (stage.programs ?? []).map(prog => {
        const velKey = `${stage.stageCode}::${prog.program}`;
        return {
          ...base,
          'Tipología':           (prog.program ?? '').replace(/^(\d+D)\d+B$/i, '$1'),
          'Disponibles':         _num(prog.available),
          'Ticket UF':           _num(prog.priceUF),
          'UF/m²':               _num(prog.ufPerM2),
          'Útil (m²)':           _num(prog.avgUsefulM2),
          'Interior (m²)':       _num(prog.avgUsefulM2),
          'Terraza (m²)':        _num(prog.avgTerraceM2),
          'Stock Programa':      _num(prog.stock),
          'Oferta Programa':     _num(prog.available),
          'Fecha inicio':        dates.constructionStart?.slice(0, 10) ?? '',
          'Fecha inicio ventas': dates.salesStart?.slice(0, 10)        ?? '',
          'Fecha entrega':       dates.delivery?.slice(0, 10)          ?? '',
          // Placeholder inicial (sobre TODAS las tipologías del proyecto) —
          // recomputeVelVenta() la recalcula sobre el subconjunto filtrado en
          // cada applyFilters(). Tiene que existir en la fila desde acá, no
          // solo agregarse después: state.columns se arma una sola vez al
          // cargar los datos (antes de que corra ningún filtro), así que si
          // la clave no está presente en este punto la columna nunca aparece
          // y el resto de la app (comparativa, KPIs, mapa) no la encuentra.
          'Vel. Venta (un./mes)': null,
          // Mediana mensual propia de ESTA tipología (no del proyecto
          // entero) sobre toda la vida reportada del proyecto — campo
          // interno que recomputeVelVenta() usa para calcular la mediana
          // final por tipología sobre las filas actualmente filtradas
          // (relevante cuando un edificio tiene varias etapas con la misma
          // tipología nominal).
          '__velTipoRate': +_median(velSeriesByKey.get(velKey) ?? [0]).toFixed(3),
        };
      }).filter(r => r['Ticket UF'] != null && r['Ticket UF'] > 0);
    });
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
  const token = await getIdToken();
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ market: 'residencial', polygons: [polygon] }),
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
      console.warn('[Inciti/venta] Error en sub-zona:', err.message);
      continue;
    }

    if (payload.modulesAvailable?.projects === false || payload.projects == null) continue;
    for (const entity of (payload.projects?.entities ?? [])) {
      const key = entity.id ?? entity.name ?? String(seen.size);
      if (!seen.has(key)) seen.set(key, entity);
    }
  }

  if (!seen.size) {
    throw new Error('El área seleccionada no contiene proyectos residenciales en Inciti.');
  }

  const originalPolygon = (polygons ?? [])[0] ?? [];
  const all = [...seen.values()];
  if (originalPolygon.length < 3) return all;

  return all.filter(e => {
    const lat = e.location?.lat, lng = e.location?.lng;
    return lat != null && lng != null && _pointInPolygon(lat, lng, originalPolygon);
  });
}
