// ============== Utilidades (Renta Residencial) ==============

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

// Formateo de números al estándar chileno (es-CL)
export const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('es-CL');
    return v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  }
  return String(v);
};

// Validación rápida de valores numéricos
export const isNumeric = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

// Detección automática del tipo de columna basada en un umbral del 80%
export function detectColType(values) {
  let nums = 0, total = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    total++;
    if (typeof v === 'number' || isNumeric(v)) nums++;
  }
  if (total === 0) return 'string';
  if (nums / total >= 0.8) return 'number';
  return 'string';
}

// Extracción de valores únicos para los filtros selectores
export function uniqueValues(rows, col) {
  const set = new Set();
  for (const r of rows) {
    const v = r[col];
    if (v !== null && v !== undefined && v !== '') set.add(v);
  }
  return Array.from(set).sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'es');
  });
}

// Extrae la cantidad de dormitorios de un valor de tipología.
// "2D1B" → "2D", "3D+2B" → "3D", "1B" → null, "Studio" → null, 2 → "2D"
export function extractDormitorios(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return null;
  if (/^\d+$/.test(s) && +s >= 1 && +s <= 10) return `${s}D`;
  const m = s.match(/^(\d+)\s*D/);
  if (m) return `${m[1]}D`;
  return null;
}

// Helper para evitar saturación de llamadas (ej: al escribir en inputs)
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');