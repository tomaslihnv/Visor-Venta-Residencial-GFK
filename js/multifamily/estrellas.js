// Cruce de datos del scraper de estrellas (Google Maps) con las filas de multifamily.
// Empareja por nombre de "Proyecto" normalizado contra "edificio" de metrics.json,
// usando aliases.json para los casos donde el nombre no coincide directamente.

const METRICS_URL  = 'data/multifamily/estrellas/metrics.json';
const ALIASES_URL  = 'data/multifamily/estrellas/aliases.json';

const _normStr = s => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export async function attachStarMetrics(rows) {
  let metrics, aliases;
  try {
    [metrics, aliases] = await Promise.all([
      fetch(METRICS_URL).then(r => r.ok ? r.json() : []),
      fetch(ALIASES_URL).then(r => r.ok ? r.json() : {}),
    ]);
  } catch {
    return rows; // sin datos de estrellas, seguir sin romper el visor
  }
  if (!metrics?.length) return rows;

  const aliasEntries = Object.entries(aliases ?? {}).filter(([k]) => k !== '_comment');
  const aliasNorm  = Object.fromEntries(aliasEntries.map(([k, v]) => [_normStr(k), _normStr(v)]));
  const knownKeys  = new Set(aliasEntries.map(([k]) => _normStr(k)));
  const byEdificio = new Map(metrics.map(m => [_normStr(m.edificio), m]));

  const unreviewed = new Set();
  for (const row of rows) {
    const key = _normStr(row['Proyecto']);
    if (!knownKeys.has(key)) unreviewed.add(row['Proyecto']);
    const m = byEdificio.get(aliasNorm[key] ?? key);
    // Siempre fijar las claves (aunque sea null) para que state.columns las
    // detecte sin depender de qué fila se use para inferirlas.
    row['Rating']            = m?.calif_actual ?? null;
    row['Rating Anterior']   = m?.calif_previo ?? null;
    row['Variación Rating']  = m?.variacion ?? null;
    row['Reseñas Total']     = m?.resenastot ?? null;
    row['Reseñas Nuevas/Mes'] = m?.nuevas_mes ?? null;
    row['% Positivo']        = m?.pos_pct ?? null;
    row['% Negativo']        = m?.neg_pct ?? null;
  }
  _showUnreviewedWarning(unreviewed);
  return rows;
}

function _showUnreviewedWarning(unreviewed) {
  const el = document.getElementById('starDataWarning');
  if (!el) return;
  if (!unreviewed.size) { el.classList.add('hidden'); return; }
  const list = [...unreviewed].join(', ');
  el.innerHTML = `
    <span>⚠️ <strong>${unreviewed.size} proyecto(s)</strong> sin revisar en el cruce de estrellas: ${list}.
    Agrégalos a <code>data/multifamily/estrellas/aliases.json</code> (aunque sea con valor vacío, para confirmar que no tienen dato).</span>
    <button type="button" class="sdw-close" aria-label="Cerrar">&#xD7;</button>
  `;
  el.classList.remove('hidden');
  el.querySelector('.sdw-close')?.addEventListener('click', () => el.classList.add('hidden'));
}
