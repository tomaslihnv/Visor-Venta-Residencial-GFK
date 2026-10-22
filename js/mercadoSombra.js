import { norm } from './utils.js';

// Adapter: Excel "Listado_Ofertas_Venta" de mercado sombra (Inciti) → filas
// de Venta. Mercado sombra = unidades publicadas en portales (Portal
// Inmobiliario, etc.), no proyectos nuevos: una fila por PUBLICACIÓN, con
// precio, m², dormitorios/baños, corredor y coordenadas — pero sin stock ni
// historia mensual, así que no hay Vel. Venta, Absorción ni Actualización.
//
// Hoja "Ofertas". Columnas usadas (se buscan por nombre, sin tildes):
//   Link Publicación | Nombre | Tipo de Propiedad | Operación | Precio (UF) |
//   Dirección | Comuna | Metros Útiles | Metros Totales | Metros Terraza |
//   Dormitorios | Baños | Estacionamientos | Bodegas | Orientación |
//   Gastos Comunes | Corredor | Fecha Publicación | Latitud | Longitud
// ("Precio por m² (UF)" se ignora: viene sobre Metros TOTALES — en casas
// incluye terreno — y Venta usa UF/m² útil; se recalcula Precio / Útiles.)

export const SOMBRA_SHEET = 'Ofertas';

function _col(row, ...keys) {
  const k = Object.keys(row).find(h => keys.includes(norm(h).trim()));
  return k === undefined ? undefined : row[k];
}

// ¿Las filas leídas de la hoja son un Listado de Ofertas?
export function isMercadoSombra(rows) {
  const h = Object.keys(rows?.[0] ?? {}).map(k => norm(k).trim());
  return h.includes('link publicacion') && h.includes('precio (uf)') && h.includes('dormitorios');
}

export function sombraOperacion(rows) {
  return String(_col(rows[0] ?? {}, 'operacion') ?? '').trim();
}

const _num = v => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
};
const _pos = v => { const n = _num(v); return n != null && n > 0 ? n : null; };

// 0 dormitorios = estudio ('S', convención de Venta); el resto 'nD' como en
// la API (los baños quedan en la columna Programa).
function _tipologia(dorm) {
  const d = _num(dorm);
  if (d == null) return '';
  return d === 0 ? 'S' : `${d}D`;
}

// Nombre del "edificio" de un grupo de publicaciones con las mismas
// coordenadas: la dirección más repetida (sin la comuna duplicada al final);
// si la dirección es solo la comuna, el título de la publicación.
function _nombreGrupo(items, comuna) {
  const c = norm(comuna).trim();
  const limpia = s => String(s ?? '').split(',').map(x => x.trim())
    .filter((x, i, a) => x && !(i > 0 && norm(x) === c) && norm(x) !== 'chile' && a.indexOf(x) === i).join(', ');
  const cuenta = new Map();
  for (const it of items) {
    const d = limpia(it.direccion);
    if (d && norm(d).trim() !== c) cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
  }
  const top = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top || String(items[0].nombre ?? '').trim() || comuna || 'Sin dirección';
}

export function adaptMercadoSombra(rows) {
  const items = rows.map(r => ({
    r,
    nombre:    _col(r, 'nombre'),
    tipo:      String(_col(r, 'tipo de propiedad') ?? '').trim() || 'Departamento',
    direccion: _col(r, 'direccion'),
    comuna:    String(_col(r, 'comuna') ?? '').trim(),
    lat:       _num(_col(r, 'latitud')),
    lng:       _num(_col(r, 'longitud')),
  })).filter(it => _pos(_col(it.r, 'precio (uf)')) != null);

  // "Edificio" = publicaciones en las mismas coordenadas y del mismo tipo:
  // así el mapa muestra un punto por edificio/condominio (como la API) y un
  // punto genérico de sector no mezcla casas con departamentos.
  // ponytail: agrupación por coordenada exacta; el portal a veces ubica el
  // mismo condominio en dos puntos casi iguales — agrupar por cercanía
  // (ej. <30 m) si eso molesta en el Resumen.
  const grupos = new Map();
  items.forEach((it, i) => {
    const key = it.lat != null && it.lng != null
      ? `${it.lat.toFixed(6)},${it.lng.toFixed(6)}|${it.tipo}`
      : `sin-coords-${i}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(it);
  });
  const usados = new Map();
  for (const grupo of grupos.values()) {
    let nombre = _nombreGrupo(grupo, grupo[0].comuna);
    const n = (usados.get(nombre) ?? 0) + 1;
    usados.set(nombre, n);
    if (n > 1) nombre = `${nombre} (${n})`; // dos grupos con la misma dirección
    for (const it of grupo) it.edificio = nombre;
  }

  return items.map(({ r, edificio, nombre, tipo, direccion, comuna, lat, lng }) => {
    const precio = _pos(_col(r, 'precio (uf)'));
    const util   = _pos(_col(r, 'metros utiles'));
    const dorm   = _num(_col(r, 'dormitorios'));
    const banos  = _num(_col(r, 'banos'));
    const row = {
      // El orden importa: los módulos de Venta buscan columnas por nombre
      // parcial en este orden ('Tipología' antes que 'Dormitorios').
      'Edificio':          edificio,
      'Tipología':         _tipologia(dorm),
      'Programa':          dorm != null ? `${dorm}D${banos ?? ''}${banos != null ? 'B' : ''}` : '',
      'Tipo':              tipo,
      'Corredor':          String(_col(r, 'corredor') ?? '').trim(),
      'Comuna':            comuna,
      'Dirección':         String(direccion ?? '').trim(),
      'Disponibles':       1, // cada publicación es una unidad a la venta
      'Ticket UF':         precio,
      'UF/m²':             precio != null && util != null ? +(precio / util).toFixed(2) : null,
      'Útil (m²)':         util,
      'Total (m²)':        _pos(_col(r, 'metros totales')),
      'Terraza (m²)':      _pos(_col(r, 'metros terraza')),
      'Dormitorios':       dorm,
      'Baños':             banos,
      'Estacionamientos':  _num(_col(r, 'estacionamientos')),
      'Bodegas':           _num(_col(r, 'bodegas')),
      'Orientación':       String(_col(r, 'orientacion') ?? '').trim(),
      'Gasto Común (CLP)': _pos(_col(r, 'gastos comunes')),
      'Fecha Publicación': String(_col(r, 'fecha publicacion') ?? '').trim(),
      'Título':            String(nombre ?? '').trim(),
      'Link':              String(_col(r, 'link publicacion') ?? '').trim(),
    };
    if (lat != null && lng != null) { row['__lat'] = lat; row['__lng'] = lng; }
    return row;
  });
}
