import { norm } from './utils.js';

// Adapter: Excel "Resumen por Programa" de mercado sombra (Inciti) → filas de
// Venta. Mercado sombra = unidades usadas publicadas en portales, no
// proyectos nuevos: el archivo trae UNA fila por programa con agregados de
// mercado (publicaciones, superficie, precio, gasto común), sin edificios,
// coordenadas, stock ni historia mensual. Por eso alimenta las vistas de
// precio/superficie (Resumen, KPIs, Sup vs Precio, Distribución, Proyectos)
// pero no el mapa, la velocidad de venta, Absorción ni Actualización.
//
// Columnas esperadas (hoja "Datos"; se buscan por nombre parcial, sin tildes,
// así que también calzan los encabezados cortos de la vista web):
//   Programa | Publicaciones (# Pub.) | Superficie Útil Promedio (m²) |
//   Precio Promedio (UF) | Precio Promedio (UF/m²) | Gasto Común Promedio (CLP)

export const SOMBRA_EDIFICIO = 'Mercado sombra';

const COLS = {
  programa: h => h.includes('programa'),
  pubs:     h => h.includes('publica') || h.includes('# pub') || h === 'pub' || h === 'pub.',
  sup:      h => h.includes('superficie') || h.includes('util'),
  ufm2:     h => h.includes('uf/m') || h.includes('uf / m'),
  ticket:   h => h.includes('precio') && !h.includes('/m'),
  gc:       h => h.includes('gasto') || h.startsWith('gc'),
};

function _findCols(headers) {
  const out = {};
  for (const [key, match] of Object.entries(COLS)) {
    out[key] = headers.find(h => match(norm(h).trim())) ?? null;
  }
  return out;
}

// ¿Las filas leídas de la hoja son un Resumen por Programa?
export function isMercadoSombra(rows) {
  const cols = _findCols(Object.keys(rows?.[0] ?? {}));
  return !!(cols.programa && cols.pubs && (cols.ticket || cols.ufm2));
}

// Acepta números o textos tipo "UF 10.900,00", "$1.083.333", "95 m²".
function _toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/m²|m2|uf|clp|\$/gi, '').replace(/\s/g, '');
  if (!s || s === '-') return null;
  // Formato es-CL: punto = miles, coma = decimal ("10.900,00", "$140.000").
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// '2D2B' → '2D', 'ESTUDIO'/'0D1B' → 'S' (convención de Venta), '3P2B' → '3P'
// (casas: "P" = piezas, no necesariamente dormitorios, así que no se fuerza a D).
function _tipologia(programa) {
  const p = String(programa ?? '').trim().toUpperCase();
  if (p === 'ESTUDIO' || p === 'S' || /^0D/.test(p)) return { tipologia: 'S', tipo: 'Departamento' };
  const m = /^(\d+)([DP])/.exec(p);
  if (!m) return { tipologia: p, tipo: 'Departamento' };
  return { tipologia: `${m[1]}${m[2]}`, tipo: m[2] === 'P' ? 'Casa' : 'Departamento' };
}

// Una fila por tipología (como agrupa Venta), con los promedios ponderados por
// publicaciones: en el archivo un programa con 68 publicaciones y otro con 1
// no pueden pesar igual.
export function adaptMercadoSombra(rows, fileName = '') {
  const cols = _findCols(Object.keys(rows[0] ?? {}));
  const groups = new Map();

  for (const r of rows) {
    const programa = String(r[cols.programa] ?? '').trim();
    const pubs = _toNum(r[cols.pubs]);
    if (!programa || !(pubs > 0)) continue;
    const { tipologia, tipo } = _tipologia(programa);
    const key = `${tipo}::${tipologia}`;
    if (!groups.has(key)) groups.set(key, { tipo, tipologia, programas: [], pubs: 0, acc: {} });
    const g = groups.get(key);
    g.programas.push(programa);
    g.pubs += pubs;
    for (const k of ['sup', 'ticket', 'ufm2', 'gc']) {
      const v = cols[k] ? _toNum(r[cols[k]]) : null;
      if (!(v > 0)) continue; // vacío/"-" = sin dato, no 0
      const a = g.acc[k] ??= { sum: 0, w: 0 };
      a.sum += v * pubs;
      a.w   += pubs;
    }
  }

  const avg = (g, k, dec) => {
    const a = g.acc[k];
    return a?.w ? +(a.sum / a.w).toFixed(dec) : null;
  };

  return [...groups.values()].map(g => ({
    'Edificio':          SOMBRA_EDIFICIO,
    'Tipo':              g.tipo,
    'Tipología':         g.tipologia,
    'Programas':         g.programas.join(', '),
    // Publicaciones = unidades a la venta en el mercado sombra.
    'Disponibles':       g.pubs,
    'Ticket UF':         avg(g, 'ticket', 2),
    'UF/m²':             avg(g, 'ufm2', 2),
    'Útil (m²)':         avg(g, 'sup', 1),
    'Gasto Común (CLP)': avg(g, 'gc', 0),
    'Archivo':           fileName,
  }));
}
