import { $, extractDormitorios, norm } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';

function findCol(candidates) {
  return state.columns.find(c => candidates.some(k => norm(c.name).includes(norm(k))))?.name ?? null;
}

function avg(nums) {
  const valid = nums.filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
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

function th(content, attrs = '') {
  return `<th ${attrs}>${content}</th>`;
}

function vsCell(cls, mpVal, promVal) {
  if (mpVal != null && promVal != null && promVal !== 0) {
    const pct = Math.round((mpVal - promVal) / promVal * 100);
    const cc  = pct > 0 ? 'vs-pos' : pct < 0 ? 'vs-neg' : 'vs-zero';
    return `<td class="${cls} ${cc}"><strong>${pct >= 0 ? '+' : ''}${pct}%</strong></td>`;
  }
  return `<td class="${cls}">—</td>`;
}

function findMpTipo(dataTipo) {
  const norm = s => String(s ?? '').toUpperCase().trim();
  return mp.tipologias.find(t => norm(t.nombre) === norm(dataTipo));
}

function _cellInlineStyle(srcEl) {
  const c = window.getComputedStyle(srcEl);
  const s = [];
  s.push(`font-family:'Roboto',Arial,sans-serif`);
  s.push(`font-size:8pt`);
  s.push(`mso-font-size-alt:8`);
  s.push(`padding:3pt 7pt`);
  s.push(`vertical-align:middle`);
  s.push(`white-space:nowrap`);
  s.push(`mso-wrap-style:none`);
  s.push(`overflow:hidden`);
  s.push(`border:1px solid #e2e8f0`);
  const bg = c.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') s.push(`background-color:${bg}`);
  s.push(`color:${c.color}`);
  s.push(`font-weight:${c.fontWeight}`);
  s.push(`text-align:${c.textAlign}`);
  if (c.fontStyle === 'italic') s.push(`font-style:italic`);
  if (c.textTransform === 'uppercase') s.push(`text-transform:uppercase`);
  const btw = parseFloat(c.borderTopWidth);
  if (btw > 1) s.push(`border-top:${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`);
  const blw = parseFloat(c.borderLeftWidth);
  if (blw > 1) s.push(`border-left:${c.borderLeftWidth} ${c.borderLeftStyle} ${c.borderLeftColor}`);
  return s.join(';');
}

export async function copyComparativaHtml() {
  const table = document.querySelector('#comparativaContent .comp-table');
  if (!table) return;

  const clone = table.cloneNode(true);

  const srcCells = [...table.querySelectorAll('th, td')];
  const dstCells = [...clone.querySelectorAll('th, td')];
  srcCells.forEach((src, i) => {
    const dst = dstCells[i];
    dst.setAttribute('style', _cellInlineStyle(src));
    dst.removeAttribute('class');
    dst.setAttribute('nowrap', 'nowrap');
    const inner = dst.innerHTML;
    dst.innerHTML = `<span style="font-size:8pt;font-family:'Roboto',Arial,sans-serif;">${inner}</span>`;
  });

  clone.querySelectorAll('tr').forEach(tr => tr.removeAttribute('class'));
  clone.setAttribute('style', 'border-collapse:collapse;font-family:\'Roboto\',Arial,sans-serif;font-size:8pt;');
  clone.removeAttribute('class');

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

  // Ajustado para coincidir con la normalización y Renta Residencial
  const colProyecto  = findCol(['proyecto', 'edificio', 'nombre', 'building']);
  const colCorredor  = findCol(['corredor', 'inmobiliaria', 'propietario']);
  const colTipologia = findCol(['tipología', 'tipologia']); 
  const colSup       = findCol(['util (m', 'útil (m', 'metros util']);
  const colUfm2      = findCol(['uf/m', 'uf / m']);
  const colRenta     = findCol(['renta uf', 'precio (uf', 'precio uf', 'renta']);
  const colGastos    = findCol(['gastos comunes', 'ggcc']);

  if (!colProyecto) {
    container.innerHTML = '<p class="hint">No se encontró columna de Proyecto en los datos.</p>';
    return;
  }

  // Tipologías únicas — solo dormitorios (XD), ignorar baños
  const tipologias = colTipologia
    ? [...new Set(state.filtered.map(r => extractDormitorios(r[colTipologia])).filter(Boolean))]
        .sort((a, b) => {
          const na = parseInt(a), nb = parseInt(b);
          return isNaN(na) || isNaN(nb) ? a.localeCompare(b, 'es') : na - nb;
        })
    : [];

  // Agrupar por proyecto
  const map = new Map();
  for (const row of state.filtered) {
    const key = String(row[colProyecto] ?? '').trim();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        proyecto:  key,
        corredor:  colCorredor ? String(row[colCorredor] ?? '') : '',
        rows:      [],
      });
    }
    map.get(key).rows.push(row);
  }

  const proyectos = [...map.values()].map(p => {
    const byTipo = {};
    for (const tipo of tipologias) {
      const tipoRows = p.rows.filter(r => extractDormitorios(r[colTipologia]) === tipo);
      byTipo[tipo] = {
        sup:    avg(tipoRows.map(r => numVal(colSup    ? r[colSup]    : null))),
        ufm2:   avg(tipoRows.map(r => numVal(colUfm2   ? r[colUfm2]  : null))),
        renta:  avg(tipoRows.map(r => numVal(colRenta  ? r[colRenta] : null))),
        gastos: avg(tipoRows.map(r => numVal(colGastos ? r[colGastos]: null))),
        count:  tipoRows.length,
      };
    }
    const overall = tipologias.length ? null : {
      sup:    avg(p.rows.map(r => numVal(colSup    ? r[colSup]    : null))),
      ufm2:   avg(p.rows.map(r => numVal(colUfm2   ? r[colUfm2]  : null))),
      renta:  avg(p.rows.map(r => numVal(colRenta  ? r[colRenta] : null))),
      gastos: avg(p.rows.map(r => numVal(colGastos ? r[colGastos]: null))),
      count:  p.rows.length,
    };
    return { ...p, byTipo, overall };
  });

  // Promedios de mercado
  const promedioTipo = {};
  for (const tipo of tipologias) {
    promedioTipo[tipo] = {
      sup:    avg(proyectos.map(p => p.byTipo[tipo]?.sup).filter(v => v !== null)),
      ufm2:   avg(proyectos.map(p => p.byTipo[tipo]?.ufm2).filter(v => v !== null)),
      renta:  avg(proyectos.map(p => p.byTipo[tipo]?.renta).filter(v => v !== null)),
      gastos: avg(proyectos.map(p => p.byTipo[tipo]?.gastos).filter(v => v !== null)),
    };
  }
  const promedioOverall = tipologias.length ? null : {
    sup:    avg(proyectos.map(p => p.overall?.sup).filter(v => v !== null)),
    ufm2:   avg(proyectos.map(p => p.overall?.ufm2).filter(v => v !== null)),
    renta:  avg(proyectos.map(p => p.overall?.renta).filter(v => v !== null)),
    gastos: avg(proyectos.map(p => p.overall?.gastos).filter(v => v !== null)),
  };

  const hasTipos    = tipologias.length > 0;
  const hasCorredor = colCorredor !== null;
  const hasGastos   = colGastos !== null;
  const metricGroups = hasTipos ? tipologias : ['_overall'];
  const metricsPerGroup = 3 + (hasGastos ? 1 : 0); // sup, ufm2, renta [, gastos]
  const generalCols = 1 + (hasCorredor ? 1 : 0) + 1; // proyecto + corredor + #unidades

  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // THEAD fila 1
  html += `<thead><tr class="comp-head-top">`;
  html += `<th colspan="${generalCols}" class="comp-th-section">Información general</th>`;
  for (const tipo of metricGroups) {
    html += `<th colspan="${metricsPerGroup}" class="comp-th-tipo">${tipo === '_overall' ? 'Indicadores' : tipo}</th>`;
  }
  html += `</tr>`;

  // THEAD fila 2
  html += `<tr class="comp-head-sub">`;
  html += th('Proyecto',   'class="comp-th-label"');
  if (hasCorredor) html += th('Corredor', 'class="comp-th-label"');
  html += th('Unidades', 'class="comp-th-label comp-num"');
  for (const _ of metricGroups) {
    html += th('Útil m²',  'class="comp-th-metric comp-num comp-sep"');
    html += th('UF/m²',    'class="comp-th-metric comp-num"');
    html += th('Renta UF', 'class="comp-th-metric comp-num"');
    if (hasGastos) html += th('G.C. UF', 'class="comp-th-metric comp-num"');
  }
  html += `</tr></thead>`;

  // TBODY
  html += `<tbody>`;
  for (const p of proyectos) {
    html += `<tr>`;
    html += cell(esc(p.proyecto), 'comp-edificio');
    if (hasCorredor) html += cell(esc(p.corredor) || '—');
    if (hasTipos) {
      const totalUnits = tipologias.reduce((sum, tipo) => sum + (p.byTipo[tipo]?.count ?? 0), 0);
      html += cell(totalUnits || '—', 'comp-num');
      for (const tipo of tipologias) {
        const d = p.byTipo[tipo];
        html += cell(d?.sup    != null ? fmtDec(d.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(d?.ufm2   != null ? fmtDec(d.ufm2, 2) : '—', 'comp-num');
        html += cell(d?.renta  != null ? fmtDec(d.renta, 1): '—', 'comp-num');
        if (hasGastos) html += cell(d?.gastos != null ? fmtDec(d.gastos, 1) : '—', 'comp-num');
      }
    } else {
      html += cell(p.overall?.count ?? '—', 'comp-num');
      html += cell(p.overall?.sup    != null ? fmtDec(p.overall.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(p.overall?.ufm2   != null ? fmtDec(p.overall.ufm2, 2) : '—', 'comp-num');
      html += cell(p.overall?.renta  != null ? fmtDec(p.overall.renta, 1): '—', 'comp-num');
      if (hasGastos) html += cell(p.overall?.gastos != null ? fmtDec(p.overall.gastos, 1) : '—', 'comp-num');
    }
    html += `</tr>`;
  }
  html += `</tbody>`;

  // TFOOT — Promedio
  html += `<tfoot>`;
  html += `<tr class="comp-promedio">`;
  html += `<td><strong>Promedio</strong></td>`;
  if (hasCorredor) html += `<td></td>`;
  html += `<td></td>`;
  if (hasTipos) {
    for (const tipo of tipologias) {
      const d = promedioTipo[tipo];
      html += `<td class="comp-num comp-sep"><strong>${d?.sup    != null ? fmtDec(d.sup, 0)  : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.ufm2   != null ? fmtDec(d.ufm2, 2) : '—'}</strong></td>`;
      html += `<td class="comp-num"><strong>${d?.renta  != null ? fmtDec(d.renta, 1): '—'}</strong></td>`;
      if (hasGastos) html += `<td class="comp-num"><strong>${d?.gastos != null ? fmtDec(d.gastos, 1) : '—'}</strong></td>`;
    }
  } else {
    html += `<td class="comp-num comp-sep"><strong>${promedioOverall?.sup    != null ? fmtDec(promedioOverall.sup, 0)  : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.ufm2   != null ? fmtDec(promedioOverall.ufm2, 2) : '—'}</strong></td>`;
    html += `<td class="comp-num"><strong>${promedioOverall?.renta  != null ? fmtDec(promedioOverall.renta, 1): '—'}</strong></td>`;
    if (hasGastos) html += `<td class="comp-num"><strong>${promedioOverall?.gastos != null ? fmtDec(promedioOverall.gastos, 1) : '—'}</strong></td>`;
  }
  html += `</tr>`;

  // Mi Proyecto rows
  const mpName = mp.proyecto || mp.edificio;
  if (mp.inComp && mpName) {
    html += `<tr class="comp-situ">`;
    html += `<td class="comp-edificio"><strong>${esc(mpName)}</strong></td>`;
    if (hasCorredor) html += `<td>—</td>`;
    html += `<td class="comp-num">${mp.tipologias.length}</td>`;

    if (hasTipos) {
      for (const tipo of tipologias) {
        const t = findMpTipo(tipo);
        const mpRenta = t?.renta != null ? t.renta : null; // Usa la renta cargada en el input
        html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
        html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 2) : '—', 'comp-num');
        html += cell(mpRenta != null ? fmtDec(mpRenta, 1) : '—', 'comp-num');
        if (hasGastos) html += cell('—', 'comp-num');
      }
    } else {
      const t = mp.tipologias[0];
      const mpRenta = t?.renta != null ? t.renta : null;
      html += cell(t?.sup  != null ? fmtDec(t.sup, 0)  : '—', 'comp-num comp-sep');
      html += cell(t?.ufm2 != null ? fmtDec(t.ufm2, 2) : '—', 'comp-num');
      html += cell(mpRenta != null ? fmtDec(mpRenta, 1) : '—', 'comp-num');
      if (hasGastos) html += cell('—', 'comp-num');
    }
    html += `</tr>`;

    // vs Promedio
    html += `<tr class="comp-situ-vs">`;
    html += `<td class="situ-vs-label"><em>${esc(mpName)} vs Promedio</em></td>`;
    if (hasCorredor) html += `<td></td>`;
    html += `<td></td>`;
    if (hasTipos) {
      for (const tipo of tipologias) {
        const t    = findMpTipo(tipo);
        const prom = promedioTipo[tipo];
        const mpRenta = t?.renta != null ? t.renta : null;
        html += vsCell('comp-num comp-sep', t?.sup, prom?.sup);
        html += vsCell('comp-num',          t?.ufm2, prom?.ufm2);
        html += vsCell('comp-num',          mpRenta, prom?.renta);
        if (hasGastos) html += `<td class="comp-num">—</td>`;
      }
    } else {
      const t = mp.tipologias[0];
      const mpRenta = t?.renta != null ? t.renta : null;
      html += vsCell('comp-num comp-sep', t?.sup,  promedioOverall?.sup);
      html += vsCell('comp-num',          t?.ufm2, promedioOverall?.ufm2);
      html += vsCell('comp-num',          mpRenta, promedioOverall?.renta);
      if (hasGastos) html += `<td class="comp-num">—</td>`;
    }
    html += `</tr>`;
  }

  html += `</tfoot></table></div>`;
  container.innerHTML = html;
}