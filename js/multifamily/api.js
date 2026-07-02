import { INCITI_API_KEY, INCITI_API_URL } from '../config.local.js';

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
// La API devuelve proyectos con series trimestrales por tipología.
// El visor espera una fila por (proyecto × tipología) con el período más
// reciente. Si un proyecto no tiene tipologías en el último período, se omite.

const TIPOLOGIA_MAP = {
  ESTUDIO: 'Estudio',
  '1D1B':  '1D1B',
  '2D1B':  '2D1B',
  '2D2B':  '2D2B',
  '3D2B':  '3D2B',
};

// Devuelve el último período con datos de un array de series trimestrales.
function _lastPeriod(series) {
  if (!Array.isArray(series) || !series.length) return null;
  return series[series.length - 1];
}

// Aplana un proyecto en una o más filas (una por tipología).
function _flattenProject(project) {
  const rows = [];

  // Series por tipología
  const tipoSeries = project.tipologias ?? project.series ?? project.units ?? {};
  const tipoKeys   = Object.keys(tipoSeries);

  if (tipoKeys.length === 0) {
    // Sin tipologías → una sola fila con datos de nivel edificio
    rows.push(_buildRow(project, null, null));
    return rows;
  }

  for (const tipoKey of tipoKeys) {
    const tipoData = tipoSeries[tipoKey];
    const periodo  = _lastPeriod(tipoData?.series ?? tipoData);
    if (!periodo) continue;
    rows.push(_buildRow(project, tipoKey, periodo));
  }

  return rows;
}

function _buildRow(project, tipoKey, periodo) {
  const tipologia = tipoKey ? (TIPOLOGIA_MAP[tipoKey] ?? tipoKey) : null;

  // Coordenadas: pueden venir como location.lat/lng, lat/lng, latitud/longitud
  const lat = project.location?.lat ?? project.lat ?? project.latitud ?? null;
  const lng = project.location?.lng ?? project.lng ?? project.longitud ?? null;

  const row = {
    'Proyecto':       project.nombre ?? project.name ?? project.id ?? '',
    'Propietario':    project.owner  ?? project.propietario ?? '',
    'Administrador':  project.administrador ?? project.operator ?? project.admin ?? '',
    'Comuna':         project.location?.comuna ?? project.comuna ?? '',
    'Estado':         project.estado ?? project.status ?? '',
    'Reporta':        project.reporta ?? project.reports ?? '',
  };

  if (lat != null && lng != null) {
    row['__lat'] = Number(lat);
    row['__lng'] = Number(lng);
  }

  if (tipologia) row['Programa'] = tipologia;

  if (periodo) {
    row['Período']         = periodo.period ?? periodo.periodo ?? periodo.quarter ?? '';
    row['Stock']           = _num(periodo.stock);
    row['Disponibilidad']  = _num(periodo.disponibilidad ?? periodo.available ?? periodo.availability);
    row['Vacancia (%)']    = _num(periodo.vacancia ?? periodo.vacancy ?? periodo.vacancyRate);
    row['Útil (m²)']       = _num(periodo.sup ?? periodo.area ?? periodo.m2util ?? periodo.usableArea);
    row['Arriendo UF']     = _num(periodo.arriendo ?? periodo.rentUF ?? periodo.renta);
    row['UF/m²']           = _num(periodo.ufm2 ?? periodo.rentUFm2 ?? periodo.rentPerM2);
    row['Ocupación (%)']   = periodo.vacancia != null
      ? Math.round((1 - (row['Vacancia (%)'] ?? 0) / 100) * 100 * 10) / 10
      : _num(periodo.ocupacion ?? periodo.occupancy);
  }

  return row;
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

export async function fetchMultifamily({ polygons, onProgress } = {}) {
  if (!INCITI_API_KEY || !INCITI_API_URL) {
    throw new Error(
      'Faltan credenciales. Completa js/config.local.js con INCITI_API_KEY e INCITI_API_URL.'
    );
  }

  const url  = INCITI_API_URL.replace(/\/$/, '') + '/' + ENDPOINT_PATH;
  const body = {
    market:   'multifamily',
    polygons: polygons ?? DEFAULT_POLYGONS,
  };

  onProgress?.('Conectando con Inciti…');

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    INCITI_API_KEY,
    },
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

  const projects = payload.projects ?? [];
  if (!projects.length) {
    throw new Error('La API devolvió 0 proyectos. Verifica el polígono y el endpoint.');
  }

  onProgress?.(`${projects.length} proyectos recibidos. Normalizando…`);

  const rows = projects.flatMap(_flattenProject).filter(r => {
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
