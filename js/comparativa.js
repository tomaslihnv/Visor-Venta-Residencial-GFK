import { $, norm, fmtTipo } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';
import { getMapOrder } from './map.js';
import { getActiveTipoFilter } from './filters.js';

function findCol(candidates) {
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

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cell(content, cls = '') {
  return `<td class="${cls}">${content}</td>`;
}

// Descripciones de cómo se calcula cada métrica (mostradas en tooltip al hover)
const TH_TOOLTIPS = {
  'Vel. Venta': 'Mediana de unidades vendidas por mes, calculada de forma independiente para cada tipología.',
  'Disponibles': 'Número de unidades aún disponibles para venta.',
  'UF/m²': 'Precio por metro cuadrado útil, promedio de las unidades de esa tipología.',
  'Ticket UF': 'Precio promedio de venta de las unidades de esa tipología.',
  'Útil m²': 'Superficie útil promedio en metros cuadrados.',
  '% Stock disp.': 'Porcentaje de unidades disponibles respecto al stock total del proyecto.',
};

function th(content, attrs = '') {
  const tooltip = TH_TOOLTIPS[content];
  if (!tooltip) return `<th ${attrs}>${content}</th>`;

  // Inyecta la clase has-tooltip dentro del class="" existente (si lo hay)
  // en vez de agregar un segundo atributo class duplicado.
  let mergedAttrs;
  if (/class="/.test(attrs)) {
    mergedAttrs = attrs.replace(/class="([^"]*)"/, 'class="$1 has-tooltip"');
  } else {
    mergedAttrs = `${attrs} class="has-tooltip"`;
  }
  return `<th ${mergedAttrs} data-tooltip="${tooltip}">${content}</th>`;
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

// True cuando S está seleccionado y 1D NO está explícitamente seleccionado
function _sOnlyNotExplicit1D() {
  const f = getActiveTipoFilter();
  if (!f.has('S')) return false;
  return ![...f].some(sel => {
    if (sel === 'S') return false;
    const s = String(sel).trim();
    return s === '1D' || ((/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase()) === '1D';
  });
}

// Etiqueta de columna para el header: usa 'S' cuando S es el filtro activo sobre datos 1D
function tipoDisplayName(dataTipo) {
  if (fmtTipo(dataTipo).toUpperCase() === '1D' && _sOnlyNotExplicit1D()) return 'S';
  return fmtTipo(dataTipo);
}

// Busca la tipología de mp que coincide con un tipo del mercado
// Cuando el filtro activo es S (y no 1D explícito), prefiere la tipología S de mp
function findMpTipo(dataTipo) {
  const fmtD = fmtTipo(dataTipo).toUpperCase();
  if (fmtD === '1D' && _sOnlyNotExplicit1D()) {
    const sTipo = mp.tipologias.find(t => t.nombre === 'S');
    if (sTipo) return sTipo;
  }
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

  // Color de fondo
  const bg = c.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') s.push(`background-color:${bg}`);

  // Color de texto, peso, alineación, estilo
  s.push(`color:${c.color}`);
  s.push(`font-weight:${c.fontWeight}`);
  s.push(`text-align:${c.textAlign}`);
  if (c.fontStyle === 'italic') s.push(`font-style:italic`);
  if (c.textTransform === 'uppercase') s.push(`text-transform:uppercase`);

  // Bordes: leer los 4 lados desde computed style (cualquier ancho > 0)
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const w = parseFloat(c[`border${side}Width`]);
    if (w > 0) {
      s.push(`border-${side.toLowerCase()}:${c[`border${side}Width`]} ${c[`border${side}Style`]} ${c[`border${side}Color`]}`);
    }
  }

  // Separador de fila para celdas de datos (border-bottom está en <tr>, no en <td>)
  if (srcEl.tagName === 'TD' && srcEl.closest('tbody') && parseFloat(c.borderBottomWidth) === 0) {
    s.push('border-bottom:1px solid #f1f5f9');
  }

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
  const colDisponibles = findCol(['disponibles', 'disponible']);
  const colOfertaTotal = findCol(['oferta total', 'stock programa', 'stock prog', 'oferta prog']);
  const colVelVenta = findCol(['velocidad', 'vel. venta', 'vel venta', 'vel.venta', 'vel ven']);

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
    const disponibles = colDisponibles
      ? p.rows.reduce((s, r) => s + (numVal(r[colDisponibles]) ?? 0), 0) || null
      : null;
    const ofertaTotal = colOfertaTotal
      ? p.rows.reduce((s, r) => s + (numVal(r[colOfertaTotal]) ?? 0), 0) || null
      : null;
    const pctDisp = disponibles != null && ofertaTotal != null && ofertaTotal > 0
      ? disponibles / ofertaTotal * 100
      : null;
    const byTipo = {};
    for (const tipo of tipologias) {
      const rows = p.rows.filter(r => r[colTipologia] === tipo);
      byTipo[tipo] = {
        sup:      avg(rows.map(r => numVal(colSup     ? r[colSup]     : null))),
        ufm2:     avg(rows.map(r => numVal(colUfm2    ? r[colUfm2]   : null))),
        ticket:   avg(rows.map(r => numVal(colTicket  ? r[colTicket] : null))),
        velVenta: colVelVenta ? avg(rows.map(r => numVal(r[colVelVenta]))) : null,
      };
    }

    const overall = tipologias.length ? null : {
      sup:      avg(p.rows.map(r => numVal(colSup     ? r[colSup]     : null))),
      ufm2:     avg(p.rows.map(r => numVal(colUfm2    ? r[colUfm2]   : null))),
      ticket:   avg(p.rows.map(r => numVal(colTicket  ? r[colTicket] : null))),
      velVenta: colVelVenta ? avg(p.rows.map(r => numVal(r[colVelVenta]))) : null,
    };

    return { ...p, disponibles, ofertaTotal, pctDisp, byTipo, overall };
  });

  // Promedios de mercado
  const promedioDisponibles  = avg(proyectos.map(p => p.disponibles).filter(v => v !== null));
  const promedioPctDisp      = avg(proyectos.map(p => p.pctDisp).filter(v => v !== null));
  const promedioTipo = {};
  for (const tipo of tipologias) {
    promedioTipo[tipo] = {
      sup:      avg(proyectos.map(p => p.byTipo[tipo]?.sup).filter(v => v !== null)),
      ufm2:     avg(proyectos.map(p => p.byTipo[tipo]?.ufm2).filter(v => v !== null)),
      ticket:   avg(proyectos.map(p => p.byTipo[tipo]?.ticket).filter(v => v !== null)),
      velVenta: avg(proyectos.map(p => p.byTipo[tipo]?.velVenta).filter(v => v !== null)),
    };
  }
  const promedioOverall = tipologias.length ? null : {
    sup:      avg(proyectos.map(p => p.overall?.sup).filter(v => v !== null)),
    ufm2:     avg(proyectos.map(p => p.overall?.ufm2).filter(v => v !== null)),
    ticket:   avg(proyectos.map(p => p.overall?.ticket).filter(v => v !== null)),
    velVenta: avg(proyectos.map(p => p.overall?.velVenta).filter(v => v !== null)),
  };

  const hasTipos       = tipologias.length > 0;
  const hasDisponibles = colDisponibles  !== null;
  const hasOferta      = colOfertaTotal  !== null;
  const hasProp        = colPropietario !== null;

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

  const generalCols  = 1 + (hasProp ? 1 : 0) + (hasDisponibles ? 1 : 0) + (hasOferta ? 1 : 0);
  const metricGroups = hasTipos ? tipologias : ['_overall'];

  // ── HTML ────────────────────────────────────────────────────────────────
  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // THEAD fila 1
  const generalColsTotal = generalCols + (hasMapNums ? 1 : 0);
  html += `<thead><tr class="comp-head-top">`;
  html += `<th colspan="${generalColsTotal}" class="comp-th-section"></th>`;
  for (const tipo of metricGroups) {
    html += `<th colspan="4" class="comp-th-tipo">${tipo === '_overall' ? 'Indicadores' : tipoDisplayName(tipo)}</th>`;
  }
  html += `</tr>`;

  // THEAD fila 2
  html += `<tr class="comp-head-sub">`;
  if (hasMapNums) html += th('N°', 'class="comp-th-num"');
  html += th('Edificio',    'class="comp-th-label"');
  if (hasProp)     html += th('Propietario',         'class="comp-th-label"');
  if (hasDisponibles)  html += th('Disponibles',           'class="comp-th-label comp-num comp-col-kpi"');
  if (hasOferta)       html += th('% Stock disp.',         'class="comp-th-label comp-num comp-col-kpi"');
  for (const _ of metricGroups) {
    html += th('Útil m²',        'class="comp-th-metric comp-num comp-sep"');
    html += th('UF/m²',          'class="comp-th-metric comp-num"');
    html += th('Ticket UF',      'class="comp-th-metric comp-num"');
    html += th('Vel. Venta',     'class="comp-th-metric comp-num"');
  }
  html += `</tr></thead>`;

  // TBODY — proyectos de mercado
  html += `<tbody>`;
  for (const p of proyectos) {
    html += `<tr>`;
    if (hasMapNums) html += cell(mapOrder.get(p.edificio) ?? '—', 'comp-num comp-map-num');
    html += cell(esc(p.edificio), 'comp-edificio');
    if (hasProp)     html += cell(esc(p.propietario) || '—');
    if (hasDisponibles)  html += cell(p.disponibles != null ? fmtDec(p.disponibles, 0) : '—', 'comp-num');
    if (hasOferta)       html += cell(p.pctDisp != null ? fmtDec(p.pctDisp, 0) + '%' : '—', 'comp-num');
    if (hasTipos) {
      for (const tipo of tipologias) {
        const d = p.byTipo[tipo];
        html += cell(d?.sup    != null ? fmtDec(d.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(d?.ufm2   != null ? fmtDec(d.ufm2, 1) : '—', 'comp-num');
        html += cell(d?.ticket != null ? fmtInt(d.ticket)  : '—', 'comp-num');
        html += cell(d?.velVenta != null ? fmtDec(d.velVenta, 1) : '—', 'comp-num');
      }
    } else {
      html += cell(p.overall?.sup    != null ? fmtDec(p.overall.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(p.overall?.ufm2   != null ? fmtDec(p.overall.ufm2, 1) : '—', 'comp-num');
      html += cell(p.overall?.ticket != null ? fmtInt(p.overall.ticket)  : '—', 'comp-num');
      html += cell(p.overall?.velVenta != null ? fmtDec(p.overall.velVenta, 1) : '—', 'comp-num');
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
  if (hasDisponibles)  html += `<td class="comp-num"><strong>${promedioDisponibles != null ? fmtDec(promedioDisponibles, 0) : '—'}</strong></td>`;
  if (hasOferta)       html += `<td class="comp-num"><strong>${promedioPctDisp != null ? fmtDec(promedioPctDisp, 0) + '%' : '—'}</strong></td>`;
  if (hasTipos) {
    for (const tipo of tipologias) {
      const d = promedioTipo[tipo];
      html += `<td class="comp-num comp-sep"><strong>${d?.sup      != null ? fmtDec(d.sup, 0)      : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ufm2     != null ? fmtDec(d.ufm2, 1)     : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ticket   != null ? fmtInt(d.ticket)      : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.velVenta != null ? fmtDec(d.velVenta, 1) : '—'}</strong></td>`;
    }
  } else {
    html += `<td class="comp-num comp-sep"><strong>${promedioOverall?.sup      != null ? fmtDec(promedioOverall.sup, 0)      : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ufm2     != null ? fmtDec(promedioOverall.ufm2, 1)     : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ticket   != null ? fmtInt(promedioOverall.ticket)      : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.velVenta != null ? fmtDec(promedioOverall.velVenta, 1) : '—'}</strong></td>`;
  }
  html += `</tr>`;

  // ── Filas Mi Proyecto (solo si está habilitado y tiene nombre) ──
  if (mp.inComp && mp.edificio) {
    // Fila de datos del proyecto
    html += `<tr class="comp-situ">`;
    if (hasMapNums) html += `<td></td>`;
    html += `<td class="comp-edificio"><strong>${esc(mp.edificio)}</strong></td>`;
    if (hasProp)         html += `<td>${esc(mp.propietario) || ''}</td>`;
    if (hasDisponibles)  html += `<td></td>`;
    if (hasOferta)       html += `<td></td>`;
    if (hasTipos) {
      for (const tipo of tipologias) {
        const t = findMpTipo(tipo);
        html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 1) : '—', 'comp-num');
        html += cell(t?.sup != null && t?.ufm2 != null ? fmtInt(t.sup * t.ufm2) : '—', 'comp-num');
        html += cell('—', 'comp-num');
      }
    } else {
      const t = mp.tipologias[0];
      html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 1) : '—', 'comp-num');
      html += cell(t?.sup != null && t?.ufm2 != null ? fmtInt(t.sup * t.ufm2) : '—', 'comp-num');
      html += cell('—', 'comp-num');
    }
    html += `</tr>`;

    // Fila vs Promedio
    html += `<tr class="comp-situ-vs">`;
    if (hasMapNums) html += `<td></td>`;
    html += `<td class="situ-vs-label"><em>${esc(mp.edificio)} vs Promedio</em></td>`;
    if (hasProp)         html += `<td></td>`;
    if (hasDisponibles)  html += `<td></td>`;
    if (hasOferta)       html += `<td></td>`;
    if (hasTipos) {
      for (const tipo of tipologias) {
        const t    = findMpTipo(tipo);
        const prom = promedioTipo[tipo];
        html += vsCell('comp-num comp-sep', t?.sup,    prom?.sup);
        html += vsCell('comp-num',           t?.ufm2,   prom?.ufm2);
        const mpTicket = t?.sup != null && t?.ufm2 != null ? t.sup * t.ufm2 : null;
        html += vsCell('comp-num', mpTicket, prom?.ticket);
        html += cell('—', 'comp-num');
      }
    } else {
      const t = mp.tipologias[0];
      const mpTicket = t?.sup != null && t?.ufm2 != null ? t.sup * t.ufm2 : null;
      html += vsCell('comp-num comp-sep', t?.sup,  promedioOverall?.sup);
      html += vsCell('comp-num',           t?.ufm2, promedioOverall?.ufm2);
      html += vsCell('comp-num',           mpTicket, promedioOverall?.ticket);
      html += cell('—', 'comp-num');
    }
    html += `</tr>`;
  }

  html += `</tfoot></table></div>`;
  container.innerHTML = html;
  _attachHeaderTooltips(container);
}

// ============== Tooltips flotantes en headers ==============
let _compTooltipEl = null;

function _showCompTooltip(e) {
  _hideCompTooltip();
  const text = e.currentTarget.getAttribute('data-tooltip');
  if (!text) return;

  _compTooltipEl = document.createElement('div');
  _compTooltipEl.className = 'table-tooltip-global';
  _compTooltipEl.innerHTML = `<strong>${e.currentTarget.textContent}</strong><br>${text}`;
  document.body.appendChild(_compTooltipEl);

  const rect = e.currentTarget.getBoundingClientRect();
  const tooltipWidth = 320;
  let left = rect.left + rect.width / 2 - tooltipWidth / 2;
  if (left < 10) left = 10;
  if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;

  _compTooltipEl.style.position = 'fixed';
  _compTooltipEl.style.left = left + 'px';
  _compTooltipEl.style.top  = (rect.top - 12) + 'px';
  _compTooltipEl.style.transform = 'translateY(-100%)';
  _compTooltipEl.style.opacity = '1';
}

function _hideCompTooltip() {
  if (_compTooltipEl) {
    _compTooltipEl.remove();
    _compTooltipEl = null;
  }
}

function _attachHeaderTooltips(container) {
  for (const th of container.querySelectorAll('th.has-tooltip')) {
    th.onmouseenter = _showCompTooltip;
    th.onmouseleave = _hideCompTooltip;
  }
}
