import { $ } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

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

const COMP_CSS = `
table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; }
th, td { padding: 5pt 9pt; border: 1px solid #e2e8f0; white-space: nowrap; vertical-align: middle; }
.comp-head-top th { background-color: #1e3a5f; color: #ffffff; font-weight: bold; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em; }
.comp-th-tipo { background-color: #475569; color: #e2e8f0; text-align: center; border-left: 2px solid #cbd5e1; }
.comp-th-section { background-color: #1e3a5f; color: #ffffff; text-align: left; }
.comp-head-sub th { background-color: #f1f5f9; font-weight: 600; font-size: 9.5pt; color: #374151; }
.comp-num { text-align: right; }
.comp-sep { border-left: 2px solid #e2e8f0; }
.comp-edificio { font-weight: 600; color: #1e3a5f; }
tbody tr td { color: #0f172a; }
.comp-promedio td { background-color: #f8fafc; font-weight: bold; border-top: 2px solid #cbd5e1; }
.comp-situ td { background-color: #eef2ff; color: #1e3a5f; font-weight: 600; border-top: 2px solid #1e3a5f; }
.comp-situ-vs td { background-color: #f0f9ff; font-style: italic; color: #475569; }
.situ-vs-label { font-style: italic; color: #475569; }
.vs-pos { color: #15803d; font-weight: 700; }
.vs-neg { color: #b91c1c; font-weight: 700; }
.vs-zero { color: #6b7280; font-weight: 600; }
`;

export async function copyComparativaHtml() {
  const table = document.querySelector('#comparativaContent .comp-table');
  if (!table) return;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${COMP_CSS}</style></head><body>${table.outerHTML}</body></html>`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
    ]);
    return true;
  } catch {
    // Fallback: execCommand para navegadores sin Clipboard API
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
  const generalCols = 1 + (hasProp ? 1 : 0) + (hasVendido ? 1 : 0) + (hasVelVenta ? 1 : 0);
  const metricGroups = hasTipos ? tipologias : ['_overall'];

  // ── HTML ────────────────────────────────────────────────────────────────
  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // THEAD fila 1
  html += `<thead><tr class="comp-head-top">`;
  html += `<th colspan="${generalCols}" class="comp-th-section">Información general</th>`;
  for (const tipo of metricGroups) {
    html += `<th colspan="3" class="comp-th-tipo">${tipo === '_overall' ? 'Indicadores' : fmtTipo(tipo)}</th>`;
  }
  html += `</tr>`;

  // THEAD fila 2
  html += `<tr class="comp-head-sub">`;
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
