// ============== Utilidades ==============
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('es-CL');
    return v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  }
  return String(v);
};

export const isNumeric = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

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

// "YYYY-MM" (formato de period.key de la API Inciti) → "YYYY-Qn"
export function monthKeyToQuarter(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  const year = parseInt(m[1]), month = parseInt(m[2]);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

// Clave numérica ordenable para comparar/ordenar "YYYY-Qn"
export function quarterSortKey(q) {
  const m = /^(\d{4})-Q(\d)$/.exec(q ?? '');
  if (!m) return -Infinity;
  return parseInt(m[1]) * 10 + parseInt(m[2]);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function fmtTipo(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10) return `${v}D`;
  const s = String(v).trim();
  if (/^\d+$/.test(s) && +s > 0 && +s <= 10) return `${s}D`;
  return s;
}