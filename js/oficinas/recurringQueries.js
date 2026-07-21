// ── Consultas Recurrentes (Oficinas) — capa de persistencia ────────────────
// Guarda definiciones de consultas a Inciti (por comuna o por área dibujada)
// para relanzarlas con un clic, en vez de redibujar/reseleccionar cada vez.
// La ejecución real (resolver polígono, llamar a Inciti, mostrar preview)
// vive en main.js, que ya tiene esa maquinaria montada.
//
// Sin consultas por defecto: arranca vacío, el usuario arma sus propias
// consultas guardadas desde el panel "Consultas Recurrentes".

const STORAGE_KEY = 'visor_of_recurring_queries_v1';

const _nextId = () => `rq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function _defaults() {
  return [];
}

function _save(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  const seeded = _defaults();
  _save(seeded);
  return seeded;
}

let _queries = _load();

export function getQueries() {
  return _queries;
}

export function getQuery(id) {
  return _queries.find(q => q.id === id) ?? null;
}

export function addQuery({ label, type, comuna = null, polygon = null }) {
  const entry = {
    id: _nextId(), label, type, comuna, polygon,
    rememberedSelection: null, lastRunAt: null,
  };
  _queries.push(entry);
  _save(_queries);
  return entry;
}

export function updateQuery(id, patch) {
  const q = getQuery(id);
  if (!q) return null;
  Object.assign(q, patch);
  _save(_queries);
  return q;
}

export function deleteQuery(id) {
  _queries = _queries.filter(q => q.id !== id);
  _save(_queries);
}
