import { INCITI_PROXY_URL } from '../config.js';

// ── Inciti API — Multifamily ───────────────────────────────────────────────

// Path del endpoint. Completar con el path correcto (ej: 'search', 'query', etc.).
const ENDPOINT_PATH = 'get_insights_pro';

// Polígono(s) por defecto a consultar cuando no se recibe uno externo.
// Reemplazar con el polígono real de interés (ej: Gran Santiago).
const DEFAULT_POLYGONS = [
  [
    { lat: -33.3489, lng: -70.7432 },
    { lat: -33.3489, lng: -70.5098 },
    { lat: -33.6489, lng: -70.5098 },
    { lat: -33.6489, lng: -70.7432 },
  ],
];

// ── Normalización de respuesta → filas planas ──────────────────────────────
//
// Estructura real de la API:
//   payload.projects.entities[]          → proyectos
//     .id, .name, .developer, .status, .location{lat,lng,commune}
//     .periods[]                         → series temporales
//       .key, .label (ej: "2024-10", "Oct 2024")
//       .stages[]                        → etapas del proyecto
//         .totalStock, .availableUnits
//         .programs[]                    → tipologías (3D2B, 2D2B, etc.)
//           .program, .stock, .available
//           .priceUF, .ufPerM2, .avgUsefulM2
//
// Se toma el último período disponible de cada entidad y se genera
// una fila por (entidad × stage × programa).

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
    const stock = _num(prog.stock);
    const avail = _num(prog.available);
    const vac   = _num(prog.vacancy);
    const vacPct = vac != null ? Math.round(vac * 100 * 10) / 10 : null;

    rows.push({
      ...base,
      'Programa':       prog.program ?? '',
      'Stock':          stock,
      'Disponibilidad': avail,
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

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

export async function fetchMultifamily({ polygons, onProgress } = {}) {
  if (!INCITI_PROXY_URL) {
    throw new Error('Falta configurar INCITI_PROXY_URL en js/config.js.');
  }

  const url  = INCITI_PROXY_URL.replace(/\/$/, '') + '/' + ENDPOINT_PATH;
  const body = { market: 'multifamily', polygons: polygons ?? DEFAULT_POLYGONS };

  onProgress?.('Conectando con Inciti…');

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }

  const payload = await res.json();

  // ── Exploración: imprimir estructura cruda en consola ──────────────────
  // Esto ayuda a confirmar los nombres exactos de los campos.
  // Quitar (o dejar) una vez que el mapeo esté validado.
  console.group('[Inciti API] Respuesta multifamily');
  console.log('Módulos disponibles:', payload.modulesAvailable);
  console.log('Total proyectos:', payload.projects?.length ?? 0);
  if (payload.projects?.length > 0) {
    console.log('Primer proyecto (estructura):', payload.projects[0]);
  }
  console.groupEnd();

  const entities = payload.projects?.entities ?? [];
  if (!entities.length) {
    throw new Error('La API devolvió 0 proyectos. Verifica el polígono y el endpoint.');
  }

  onProgress?.(`${entities.length} proyectos recibidos. Normalizando…`);

  const rows = entities.flatMap(_flattenProject).filter(r => {
    const v = r['Arriendo UF'];
    return v != null && !isNaN(v) && v > 0;
  });

  if (!rows.length) {
    throw new Error(
      'No se encontraron filas con arriendo válido. Revisa la consola para ver la estructura de la respuesta y ajusta _buildRow en api.js.'
    );
  }

  return rows;
}
