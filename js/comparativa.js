import { $ } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';
import { getMapOrder } from './map.js';

function findCol(candidates) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return state.columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

function avg(nums) {
  const valid = nums.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function numVal(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function fmtDec(v, dec = 1) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtInt(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toLocaleString('es-CL');
}

function fmtTipo(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10) return `${v}D`;
  const s = String(v).trim();
  if (/^\d+$/.test(s) && +s > 0 && +s <= 10) return `${s}D`;
  return s;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cell(content, cls = '') {
  return `<td class="${cls}">${content}</td>`;
}

function th(content, attrs = '') {
  return `<th ${attrs}>${content}</th>`;
}

// Celda con % diferencia coloreada
function vsCell(cls, mpVal, promVal) {
  if (mpVal != null && promVal != null && promVal !== 0) {
    const pct = Math.round((mpVal - promVal) / promVal * 100);
    const cc  = pct > 0 ? 'vs-pos' : pct < 0 ? 'vs-neg' : 'vs-zero';
    return `<td class="${cls} ${cc}"><strong>${pct >= 0 ? '+' : ''}${pct}%</strong></td>`;
  }
  return `<td class="${cls}">—</td>`;
}

// Busca la tipología de mp que coincide con un tipo del mercado
function findMpTipo(dataTipo) {
  const fmtD = fmtTipo(dataTipo).toUpperCase();
  return mp.tipologias.find(t =>
    fmtTipo(t.nombre).toUpperCase() === fmtD ||
    String(t.nombre).toUpperCase() === String(dataTipo).toUpperCase()
  );
}

// Lee estilos computados del DOM y los convierte en atributo style inline
function _cellInlineStyle(srcEl) {
  const c = window.getComputedStyle(srcEl);
  const s = [];

  s.push(`font-family:'Roboto',Arial,sans-serif`);
  s.push(`font-size:8pt`);
  s.push(`mso-font-size-alt:8`);          // pista explícita para Office
  s.push(`padding:3pt 7pt`);
  s.push(`vertical-align:middle`);
  s.push(`white-space:nowrap`);
  s.push(`mso-wrap-style:none`);          // desactiva ajuste de texto en PPT
  s.push(`overflow:hidden`);
  s.push(`border:1px solid #e2e8f0`);

  // Color de fondo
  const bg = c.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') s.push(`background-color:${bg}`);

  // Color de texto, peso, alineación, estilo
  s.push(`color:${c.color}`);
  s.push(`font-weight:${c.fontWeight}`);
  s.push(`text-align:${c.textAlign}`);
  if (c.fontStyle === 'italic') s.push(`font-style:italic`);
  if (c.textTransform === 'uppercase') s.push(`text-transform:uppercase`);

  // Bordes superiores más gruesos (separadores de sección)
  const btw = parseFloat(c.borderTopWidth);
  if (btw > 1) s.push(`border-top:${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`);

  // Borde izquierdo de separación de tipología
  const blw = parseFloat(c.borderLeftWidth);
  if (blw > 1) s.push(`border-left:${c.borderLeftWidth} ${c.borderLeftStyle} ${c.borderLeftColor}`);

  return s.join(';');
}

export async function copyComparativaHtml() {
  const table = document.querySelector('#comparativaContent .comp-table');
  if (!table) return;

  const clone = table.cloneNode(true);

  // Aplicar inline styles leyendo el estado real del DOM (colores, pesos, etc.)
  const srcCells = [...table.querySelectorAll('th, td')];
  const dstCells = [...clone.querySelectorAll('th, td')];
  srcCells.forEach((src, i) => {
    const dst = dstCells[i];
    dst.setAttribute('style', _cellInlineStyle(src));
    dst.removeAttribute('class');
    dst.setAttribute('nowrap', 'nowrap'); // atributo HTML (refuerza no-wrapping en PPT)

    // PowerPoint ignora font-size en <td>; aplicarlo al span interno garantiza el tamaño
    const inner = dst.innerHTML;
    dst.innerHTML = `<span style="font-size:8pt;font-family:'Roboto',Arial,sans-serif;">${inner}</span>`;
  });

  clone.querySelectorAll('tr').forEach(tr => tr.removeAttribute('class'));
  clone.setAttribute('style',
    'border-collapse:collapse;font-family:\'Roboto\',Arial,sans-serif;font-size:8pt;');
  clone.removeAttribute('class');

  // Fijar ancho de columnas según el renderizado real (evita que PPT contraiga columnas)
  const srcBodyRows = [...table.querySelectorAll('tbody tr, tfoot tr')];
  const dstBodyRows = [...clone.querySelectorAll('tbody tr, tfoot tr')];
  if (srcBodyRows.length > 0) {
    const srcDataCells = [...srcBodyRows[0].querySelectorAll('th, td')];
    const dstDataCells = [...dstBodyRows[0]?.querySelectorAll('th, td') ?? []];
    srcDataCells.forEach((src, i) => {
      if (dstDataCells[i]) {
        const w = Math.ceil(src.getBoundingClientRect().width);
        if (w > 0) dstDataCells[i].setAttribute('width', w);
      }
    });
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${clone.outerHTML}</body></html>`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
    ]);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = html;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

export function renderComparativa() {
  const container = $('#comparativaContent');
  if (!container) return;
  if (!state.filtered.length) {
    container.innerHTML = '<p class="hint">No hay datos para mostrar.</p>';
    return;
  }

  const colEdificio    = findCol(['edificio', 'proyecto', 'building']);
  const colPropietario = findCol(['propietario', 'owner', 'inmobiliaria']);
  const colTipologia   = findCol(['tipolog', 'dormitor']);
  const colSup         = findCol(['superficie', 'sup. út', 'sup út', 'sup util', 'm² út', 'promedio util', 'util prom', 'prom util', 'util (m']);
  const colTicket      = findCol(['ticket']);
  const colUfm2        = findCol(['uf/m', 'uf / m']);
  const colVendido     = findCol(['vendido', '% vend', 'pct vend', '% vendido']);
  const colVelVenta    = findCol(['velocidad', 'vel. venta', 'vel venta', 'vel.venta', 'vel ven']);

  if (!colEdificio) {
    container.innerHTML = '<p class="hint">No se encontró columna de Edificio/Proyecto en los datos.</p>';
    return;
  }

  // Tipologías únicas y ordenadas
  const tipologias = colTipologia
    ? [...new Set(state.filtered.map(r => r[colTipologia]).filter(v => v !== '' && v != null))]
        .sort((a, b) => {
          const na = parseInt(String(a)), nb = parseInt(String(b));
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return String(a).localeCompare(String(b), 'es');
        })
    : [];

  // Agrupar por edificio
  const map = new Map();
  for (const row of state.filtered) {
    const key = String(row[colEdificio] ?? '').trim();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        edificio:    key,
        propietario: colPropietario ? String(row[colPropietario] ?? '') : '',
        rows:        [],
      });
    }
    map.get(key).rows.push(row);
  }

  // Promedios por proyecto y tipología
  const proyectos = [...map.values()].map(p => {
    const pick    = col => numVal(p.rows.find(r => numVal(r[col]) !== null)?.[col] ?? null);
    const vendido  = colVendido  ? pick(colVendido)  : null;
    const velVenta = colVelVenta ? pick(colVelVenta) : null;

    const byTipo = {};
    for (const tipo of tipologias) {
      const rows = p.rows.filter(r => r[colTipologia] === tipo);
      byTipo[tipo] = {
        sup:    avg(rows.map(r => numVal(colSup    ? r[colSup]    : null))),
        ufm2:   avg(rows.map(r => numVal(colUfm2   ? r[colUfm2]  : null))),
        ticket: avg(rows.map(r => numVal(colTicket  ? r[colTicket] : null))),
      };
    }

    const overall = tipologias.length ? null : {
      sup:    avg(p.rows.map(r => numVal(colSup    ? r[colSup]    : null))),
      ufm2:   avg(p.rows.map(r => numVal(colUfm2   ? r[colUfm2]  : null))),
      ticket: avg(p.rows.map(r => numVal(colTicket  ? r[colTicket] : null))),
    };

    return { ...p, vendido, velVenta, byTipo, overall };
  });

  // Promedios de mercado
  const promedioVendido  = avg(proyectos.map(p => p.vendido).filter(v => v !== null));
  const promedioVelVenta = avg(proyectos.map(p => p.velVenta).filter(v => v !== null));
  const promedioTipo = {};
  for (const tipo of tipologias) {
    promedioTipo[tipo] = {
      sup:    avg(proyectos.map(p => p.byTipo[tipo]?.sup).filter(v => v !== null)),
      ufm2:   avg(proyectos.map(p => p.byTipo[tipo]?.ufm2).filter(v => v !== null)),
      ticket: avg(proyectos.map(p => p.byTipo[tipo]?.ticket).filter(v => v !== null)),
    };
  }
  const promedioOverall = tipologias.length ? null : {
    sup:    avg(proyectos.map(p => p.overall?.sup).filter(v => v !== null)),
    ufm2:   avg(proyectos.map(p => p.overall?.ufm2).filter(v => v !== null)),
    ticket: avg(proyectos.map(p => p.overall?.ticket).filter(v => v !== null)),
  };

  const hasTipos    = tipologias.length > 0;
  const hasVendido  = colVendido  !== null;
  const hasVelVenta = colVelVenta !== null;
  const hasProp     = colPropietario !== null;

  // Map pin numbers (only available when coordinates exist)
  const mapOrder   = getMapOrder();
  const hasMapNums = mapOrder.size > 0;

  // Sort proyectos by map pin order when available
  if (hasMapNums) {
    proyectos.sort((a, b) => {
      const na = mapOrder.get(a.edificio) ?? Infinity;
      const nb = mapOrder.get(b.edificio) ?? Infinity;
      return na - nb;
    });
  }

  const generalCols  = 1 + (hasProp ? 1 : 0) + (hasVendido ? 1 : 0) + (hasVelVenta ? 1 : 0);
  const metricGroups = hasTipos ? tipologias : ['_overall'];

  // ── HTML ────────────────────────────────────────────────────────────────
  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // THEAD fila 1
  const generalColsTotal = generalCols + (hasMapNums ? 1 : 0);
  html += `<thead><tr class="comp-head-top">`;
  html += `<th colspan="${generalColsTotal}" class="comp-th-section">Proyectos</th>`;
  for (const tipo of metricGroups) {
    html += `<th colspan="3" class="comp-th-tipo">${tipo === '_overall' ? 'Indicadores' : fmtTipo(tipo)}</th>`;
  }
  html += `</tr>`;

  // THEAD fila 2
  html += `<tr class="comp-head-sub">`;
  if (hasMapNums) html += th('N°', 'class="comp-th-num"');
  html += th('Edificio',    'class="comp-th-label"');
  if (hasProp)     html += th('Propietario',         'class="comp-th-label"');
  if (hasVendido)  html += th('% Vendido',            'class="comp-th-label comp-num"');
  if (hasVelVenta) html += th('Vel. Venta (un./mes)', 'class="comp-th-label comp-num"');
  for (const _ of metricGroups) {
    html += th('Útil m²',   'class="comp-th-metric comp-num comp-sep"');
    html += th('UF/m²',     'class="comp-th-metric comp-num"');
    html += th('Ticket UF', 'class="comp-th-metric comp-num"');
  }
  html += `</tr></thead>`;

  // TBODY — proyectos de mercado
  html += `<tbody>`;
  for (const p of proyectos) {
    html += `<tr>`;
    if (hasMapNums) html += cell(mapOrder.get(p.edificio) ?? '—', 'comp-num comp-map-num');
    html += cell(esc(p.edificio), 'comp-edificio');
    if (hasProp)     html += cell(esc(p.propietario) || '—');
    if (hasVendido)  html += cell(p.vendido  != null ? fmtDec(p.vendido, 1)  + '%' : '—', 'comp-num');
    if (hasVelVenta) html += cell(p.velVenta != null ? fmtDec(p.velVenta, 1) : '—',       'comp-num');
    if (hasTipos) {
      for (const tipo of tipologias) {
        const d = p.byTipo[tipo];
        html += cell(d?.sup    != null ? fmtDec(d.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(d?.ufm2   != null ? fmtDec(d.ufm2, 1) : '—', 'comp-num');
        html += cell(d?.ticket != null ? fmtInt(d.ticket)  : '—', 'comp-num');
      }
    } else {
      html += cell(p.overall?.sup    != null ? fmtDec(p.overall.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(p.overall?.ufm2   != null ? fmtDec(p.overall.ufm2, 1) : '—', 'comp-num');
      html += cell(p.overall?.ticket != null ? fmtInt(p.overall.ticket)  : '—', 'comp-num');
    }
    html += `</tr>`;
  }
  html += `</tbody>`;

  // TFOOT
  html += `<tfoot>`;

  // ── Fila Promedio ──
  html += `<tr class="comp-promedio">`;
  if (hasMapNums) html += `<td></td>`;
  html += `<td><strong>Promedio</strong></td>`;
  if (hasProp)     html += `<td></td>`;
  if (hasVendido)  html += `<td class="comp-num"><strong>${promedioVendido  != null ? fmtDec(promedioVendido, 1)  + '%' : '—'}</strong></td>`;
  if (hasVelVenta) html += `<td class="comp-num"><strong>${promedioVelVenta != null ? fmtDec(promedioVelVenta, 1) : '—'}</strong></td>`;
  if (hasTipos) {
    for (const tipo of tipologias) {
      const d = promedioTipo[tipo];
      html += `<td class="comp-num comp-sep"><strong>${d?.sup    != null ? fmtDec(d.sup, 0)  : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ufm2   != null ? fmtDec(d.ufm2, 1) : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ticket != null ? fmtInt(d.ticket)  : '—'}</strong></td>`;
    }
  } else {
    html += `<td class="comp-num comp-sep"><strong>${promedioOverall?.sup    != null ? fmtDec(promedioOverall.sup, 0)  : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ufm2   != null ? fmtDec(promedioOverall.ufm2, 1) : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ticket != null ? fmtInt(promedioOverall.ticket)  : '—'}</strong></td>`;
  }
  html += `</tr>`;

  // ── Filas Mi Proyecto (solo si está habilitado y tiene nombre) ──
  if (mp.inComp && mp.edificio) {
    // Fila de datos del proyecto
    html += `<tr class="comp-situ">`;
    if (hasMapNums) html += `<td></td>`;
    html += `<td class="comp-edificio"><strong>${esc(mp.edificio)}</strong></td>`;
    if (hasProp)     html += `<td>${esc(mp.propietario) || ''}</td>`;
    if (hasVendido)  html += `<td></td>`;
    if (hasVelVenta) html += `<td></td>`;
    if (hasTipos) {
      for (const tipo of tipologias) {
        const t = findMpTipo(tipo);
        html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 1) : '—', 'comp-num');
        html += cell(t?.sup != null && t?.ufm2 != null ? fmtInt(t.sup * t.ufm2) : '—', 'comp-num');
      }
    } else {
      const t = mp.tipologias[0];
      html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 1) : '—', 'comp-num');
      html += cell(t?.sup != null && t?.ufm2 != null ? fmtInt(t.sup * t.ufm2) : '—', 'comp-num');
    }
    html += `</tr>`;

    // Fila vs Promedio
    html += `<tr class="comp-situ-vs">`;
    if (hasMapNums) html += `<td></td>`;
    html += `<td class="situ-vs-label"><em>${esc(mp.edificio)} vs Promedio</em></td>`;
    if (hasProp)     html += `<td></td>`;
    if (hasVendido)  html += `<td></td>`;
    if (hasVelVenta) html += `<td></td>`;
    if (hasTipos) {
      for (const tipo of tipologias) {
        const t    = findMpTipo(tipo);
        const prom = promedioTipo[tipo];
        html += vsCell('comp-num comp-sep', t?.sup,    prom?.sup);
        html += vsCell('comp-num',           t?.ufm2,   prom?.ufm2);
        const mpTicket = t?.sup != null && t?.ufm2 != null ? t.sup * t.ufm2 : null;
        html += vsCell('comp-num', mpTicket, prom?.ticket);
      }
    } else {
      const t = mp.tipologias[0];
      const mpTicket = t?.sup != null && t?.ufm2 != null ? t.sup * t.ufm2 : null;
      html += vsCell('comp-num comp-sep', t?.sup,  promedioOverall?.sup);
      html += vsCell('comp-num',           t?.ufm2, promedioOverall?.ufm2);
      html += vsCell('comp-num',           mpTicket, promedioOverall?.ticket);
    }
    html += `</tr>`;
  }

  html += `</tfoot></table></div>`;
  container.innerHTML = html;
}
