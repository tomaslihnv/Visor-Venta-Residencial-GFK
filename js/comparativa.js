import { $ } from './utils.js';
import { state } from './data.js';

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
  if (v === null || v === undefined) return '-';
  return Number(v).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtInt(v) {
  if (v === null || v === undefined) return '-';
  return Math.round(v).toLocaleString('es-CL');
}

function fmtTipo(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10) return `${v}D`;
  const s = String(v).trim();
  if (/^\d+$/.test(s) && +s > 0 && +s <= 10) return `${s}D`;
  return s;
}

function cell(content, cls = '') {
  return `<td class="${cls}">${content}</td>`;
}

function th(content, attrs = '') {
  return `<th ${attrs}>${content}</th>`;
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

  // Sorted unique typologies
  const tipologias = colTipologia
    ? [...new Set(state.filtered.map(r => r[colTipologia]).filter(v => v !== '' && v != null))]
        .sort((a, b) => {
          const na = parseInt(String(a)), nb = parseInt(String(b));
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return String(a).localeCompare(String(b), 'es');
        })
    : [];

  // Group rows by edificio
  const map = new Map();
  for (const row of state.filtered) {
    const key = String(row[colEdificio] ?? '').trim();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        edificio: key,
        propietario: colPropietario ? String(row[colPropietario] ?? '') : '',
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }

  // Build per-project data
  const proyectos = [...map.values()].map(p => {
    const pick = col => numVal(p.rows.find(r => numVal(r[col]) !== null)?.[col] ?? null);
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

  // Averages row
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
  const tipoCols    = hasTipos ? tipologias.length * 3 : 3;

  // ── Build HTML ──────────────────────────────────────────────────────────────
  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // THEAD row 1
  html += `<thead>`;
  html += `<tr class="comp-head-top">`;
  html += `<th colspan="${generalCols}" class="comp-th-section">Información general</th>`;
  if (hasTipos) {
    for (const tipo of tipologias) {
      html += `<th colspan="3" class="comp-th-tipo">${fmtTipo(tipo)}</th>`;
    }
  } else {
    html += `<th colspan="3" class="comp-th-tipo">Indicadores</th>`;
  }
  html += `</tr>`;

  // THEAD row 2
  html += `<tr class="comp-head-sub">`;
  html += th('Edificio', 'class="comp-th-label"');
  if (hasProp)     html += th('Propietario', 'class="comp-th-label"');
  if (hasVendido)  html += th('% Vendido',   'class="comp-th-label comp-num"');
  if (hasVelVenta) html += th('Vel. Venta (un./mes)', 'class="comp-th-label comp-num"');
  const metricCols = hasTipos ? tipologias : ['_'];
  for (const _ of metricCols) {
    html += th('Útil m²', 'class="comp-th-metric comp-num comp-sep"');
    html += th('UF/m²',   'class="comp-th-metric comp-num"');
    html += th('Ticket UF', 'class="comp-th-metric comp-num"');
  }
  html += `</tr>`;
  html += `</thead>`;

  // TBODY
  html += `<tbody>`;
  for (const p of proyectos) {
    html += `<tr>`;
    html += cell(p.edificio, 'comp-edificio');
    if (hasProp)     html += cell(p.propietario || '-');
    if (hasVendido)  html += cell(p.vendido  !== null ? fmtDec(p.vendido, 1)  + '%' : '-', 'comp-num');
    if (hasVelVenta) html += cell(p.velVenta !== null ? fmtDec(p.velVenta, 1) : '-',       'comp-num');

    if (hasTipos) {
      for (const tipo of tipologias) {
        const d = p.byTipo[tipo];
        html += cell(d?.sup    !== null && d?.sup    !== undefined ? fmtDec(d.sup, 0)  : '-', 'comp-num comp-sep');
        html += cell(d?.ufm2   !== null && d?.ufm2   !== undefined ? fmtDec(d.ufm2, 1) : '-', 'comp-num');
        html += cell(d?.ticket !== null && d?.ticket !== undefined ? fmtInt(d.ticket)  : '-', 'comp-num');
      }
    } else {
      html += cell(p.overall?.sup    !== null ? fmtDec(p.overall.sup, 0)  : '-', 'comp-num comp-sep');
      html += cell(p.overall?.ufm2   !== null ? fmtDec(p.overall.ufm2, 1) : '-', 'comp-num');
      html += cell(p.overall?.ticket !== null ? fmtInt(p.overall.ticket)  : '-', 'comp-num');
    }
    html += `</tr>`;
  }
  html += `</tbody>`;

  // TFOOT — Promedio
  html += `<tfoot>`;
  html += `<tr class="comp-promedio">`;
  html += `<td><strong>Promedio</strong></td>`;
  if (hasProp)     html += `<td></td>`;
  if (hasVendido)  html += `<td class="comp-num"><strong>${promedioVendido  !== null ? fmtDec(promedioVendido, 1)  + '%' : '-'}</strong></td>`;
  if (hasVelVenta) html += `<td class="comp-num"><strong>${promedioVelVenta !== null ? fmtDec(promedioVelVenta, 1) : '-'}</strong></td>`;

  if (hasTipos) {
    for (const tipo of tipologias) {
      const d = promedioTipo[tipo];
      html += `<td class="comp-num comp-sep"><strong>${d?.sup    !== null ? fmtDec(d.sup, 0)  : '-'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ufm2   !== null ? fmtDec(d.ufm2, 1) : '-'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ticket !== null ? fmtInt(d.ticket)  : '-'}</strong></td>`;
    }
  } else {
    html += `<td class="comp-num comp-sep"><strong>${promedioOverall?.sup    !== null ? fmtDec(promedioOverall.sup, 0)  : '-'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ufm2   !== null ? fmtDec(promedioOverall.ufm2, 1) : '-'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ticket !== null ? fmtInt(promedioOverall.ticket)  : '-'}</strong></td>`;
  }
  html += `</tr>`;
  html += `</tfoot>`;

  html += `</table></div>`;
  container.innerHTML = html;
}
