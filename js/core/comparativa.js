import { copyTableHtml } from './export.js';

// compConfig: {
//   projectCandidates: string[]
//   groupByCandidates?: string[]    — if present, builds a project×group matrix (like tipología in renta)
//   infoColumns: [{ label, candidates }]    — text columns shown before metrics
//   metricColumns: [{ label, candidates, fmt }]  — numeric columns (fmt: 'int'|'pct'|'uf1'|'uf2')
// }

const _fmtMap = {
  int: v => v == null ? '—' : Math.round(v).toLocaleString('es-CL'),
  pct: v => v == null ? '—' : v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  uf1: v => v == null ? '—' : v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  uf2: v => v == null ? '—' : v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

function _fmtCell(v, fmtKey) {
  const fn = _fmtMap[fmtKey] ?? (v => v == null ? '—' : String(v));
  return fn(v);
}

function _norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); }

function _findCol(candidates, columns) {
  return columns.find(c => candidates.some(k => _norm(c.name).includes(_norm(k))))?.name ?? null;
}

function _avg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v) && v > 0);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function _num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _cell(content, cls = '') { return `<td class="${cls}">${content}</td>`; }
function _th(content, attrs = '')  { return `<th ${attrs}>${content}</th>`; }

function _vsCell(cls, mpVal, promVal) {
  if (mpVal != null && promVal != null && promVal !== 0) {
    const pct = Math.round((mpVal - promVal) / promVal * 100);
    const cc  = pct > 0 ? 'vs-pos' : pct < 0 ? 'vs-neg' : 'vs-zero';
    return `<td class="${cls} ${cc}"><strong>${pct >= 0 ? '+' : ''}${pct}%</strong></td>`;
  }
  return `<td class="${cls}">—</td>`;
}

export async function copyComparativaHtml() {
  return copyTableHtml('#comparativaContent .comp-table');
}

export function renderComparativa(state, compConfig, mp) {
  const container = document.getElementById('comparativaContent');
  if (!container) return;
  if (!state.filtered.length) { container.innerHTML = '<p class="hint">No hay datos para mostrar.</p>'; return; }

  const projCol     = _findCol(compConfig.projectCandidates, state.columns);
  if (!projCol) { container.innerHTML = '<p class="hint">No se encontró columna de Proyecto.</p>'; return; }

  const groupByCol  = compConfig.groupByCandidates?.length
    ? _findCol(compConfig.groupByCandidates, state.columns)
    : null;

  // Resolve info columns
  const infoCols = compConfig.infoColumns.map(c => ({
    ...c, col: _findCol(c.candidates, state.columns),
  })).filter(c => c.col);

  // Resolve metric columns
  const metricCols = compConfig.metricColumns.map(c => ({
    ...c, col: _findCol(c.candidates, state.columns),
  })).filter(c => c.col);

  if (!metricCols.length) { container.innerHTML = '<p class="hint">No se encontraron columnas de métricas.</p>'; return; }

  // Unique groups (e.g. tipologías)
  const groups = groupByCol
    ? [...new Set(state.filtered.map(r => r[groupByCol]).filter(Boolean))]
        .sort((a, b) => {
          const na = parseInt(String(a)), nb = parseInt(String(b));
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return String(a).localeCompare(String(b), 'es');
        })
    : [];

  const hasGroups = groups.length > 0;

  // Aggregate by project (and optionally group)
  const projMap = new Map();
  for (const row of state.filtered) {
    const key = String(row[projCol] ?? '').trim();
    if (!key) continue;
    if (!projMap.has(key)) {
      const infoVals = {};
      for (const ic of infoCols) infoVals[ic.col] = String(row[ic.col] ?? '');
      projMap.set(key, { key, infoVals, rows: [] });
    }
    projMap.get(key).rows.push(row);
  }

  const projects = [...projMap.values()].map(p => {
    if (hasGroups) {
      const byGroup = {};
      for (const g of groups) {
        const gRows = p.rows.filter(r => r[groupByCol] === g);
        byGroup[g] = {};
        for (const mc of metricCols) {
          byGroup[g][mc.col] = _avg(gRows.map(r => _num(r[mc.col])));
        }
        byGroup[g]._count = gRows.length;
      }
      return { ...p, byGroup, overall: null };
    } else {
      const overall = {};
      for (const mc of metricCols) {
        overall[mc.col] = _avg(p.rows.map(r => _num(r[mc.col])));
      }
      overall._count = p.rows.length;
      return { ...p, byGroup: null, overall };
    }
  });

  // Market averages
  const mktAvg = {};
  if (hasGroups) {
    for (const g of groups) {
      mktAvg[g] = {};
      for (const mc of metricCols) {
        mktAvg[g][mc.col] = _avg(projects.map(p => p.byGroup[g]?.[mc.col]).filter(v => v != null));
      }
    }
  } else {
    for (const mc of metricCols) {
      mktAvg[mc.col] = _avg(projects.map(p => p.overall?.[mc.col]).filter(v => v != null));
    }
  }

  const metricsPerGroup = metricCols.length;
  const displayGroups   = hasGroups ? groups : ['_overall'];
  const infoCnt         = 1 + infoCols.length + 1; // proyecto + info cols + #unidades

  let html = `<div class="comp-wrap"><table class="comp-table">`;

  // Header row 1
  html += `<thead><tr class="comp-head-top">`;
  html += `<th colspan="${infoCnt}" class="comp-th-section">Información general</th>`;
  for (const g of displayGroups) {
    html += `<th colspan="${metricsPerGroup}" class="comp-th-tipo">${g === '_overall' ? 'Indicadores' : _esc(g)}</th>`;
  }
  html += `</tr>`;

  // Header row 2
  html += `<tr class="comp-head-sub">`;
  html += _th('Proyecto', 'class="comp-th-label"');
  for (const ic of infoCols) html += _th(_esc(ic.label), 'class="comp-th-label"');
  html += _th('N°', 'class="comp-th-label comp-num"');
  for (let gi = 0; gi < displayGroups.length; gi++) {
    metricCols.forEach((mc, mi) => {
      const cls = mi === 0 ? 'comp-th-metric comp-num comp-sep' : 'comp-th-metric comp-num';
      html += _th(_esc(mc.label), `class="${cls}"`);
    });
  }
  html += `</tr></thead>`;

  // Body
  html += `<tbody>`;
  for (const p of projects) {
    html += `<tr>`;
    html += _cell(_esc(p.key), 'comp-edificio');
    for (const ic of infoCols) html += _cell(_esc(p.infoVals[ic.col] ?? '—'));
    if (hasGroups) {
      const totalUnits = groups.reduce((s, g) => s + (p.byGroup[g]?._count ?? 0), 0);
      html += _cell(totalUnits || '—', 'comp-num');
      for (const g of groups) {
        metricCols.forEach((mc, mi) => {
          const val = p.byGroup[g]?.[mc.col];
          html += _cell(_fmtCell(val, mc.fmt), mi === 0 ? 'comp-num comp-sep' : 'comp-num');
        });
      }
    } else {
      html += _cell(p.overall._count ?? '—', 'comp-num');
      metricCols.forEach((mc, mi) => {
        html += _cell(_fmtCell(p.overall?.[mc.col], mc.fmt), mi === 0 ? 'comp-num comp-sep' : 'comp-num');
      });
    }
    html += `</tr>`;
  }
  html += `</tbody>`;

  // Footer — averages
  html += `<tfoot><tr class="comp-promedio">`;
  html += `<td><strong>Promedio</strong></td>`;
  for (let i = 0; i < infoCols.length + 1; i++) html += `<td></td>`;
  if (hasGroups) {
    for (const g of groups) {
      metricCols.forEach((mc, mi) => {
        const v = mktAvg[g]?.[mc.col];
        html += `<td class="${mi === 0 ? 'comp-num comp-sep' : 'comp-num'}"><strong>${_fmtCell(v, mc.fmt)}</strong></td>`;
      });
    }
  } else {
    metricCols.forEach((mc, mi) => {
      html += `<td class="${mi === 0 ? 'comp-num comp-sep' : 'comp-num'}"><strong>${_fmtCell(mktAvg[mc.col], mc.fmt)}</strong></td>`;
    });
  }
  html += `</tr>`;

  // Mi Proyecto row
  const mpName = mp?.proyecto;
  const mpIncluded = mp?.inComp && mpName;

  if (mpIncluded) {
    html += `<tr class="comp-situ">`;
    html += `<td class="comp-edificio"><strong>${_esc(mpName)}</strong></td>`;
    for (const ic of infoCols) html += `<td>—</td>`;

    if (hasGroups) {
      // tipología-based Mi Proyecto (for renta-like visors)
      const findTipo = g => mp.tipologias?.find(t => String(t.nombre ?? '').toUpperCase().trim() === String(g).toUpperCase().trim());
      const totalTipos = mp.tipologias?.length ?? 0;
      html += _cell(totalTipos || '—', 'comp-num');
      for (const g of groups) {
        const t = findTipo(g);
        metricCols.forEach((mc, mi) => {
          const mcNorm = _norm(mc.col);
          let val = null;
          if (mcNorm.includes('util') || mcNorm.includes('útil')) val = t?.sup ?? null;
          else if (mcNorm.includes('uf/m'))  val = t?.ufm2 ?? null;
          else if (mcNorm.includes('renta') || mcNorm.includes('arriendo') || mcNorm.includes('precio')) val = t?.renta ?? null;
          html += _cell(_fmtCell(val, mc.fmt), mi === 0 ? 'comp-num comp-sep' : 'comp-num');
        });
      }
    } else {
      // flat Mi Proyecto (for multifamily-like visors)
      html += _cell(1, 'comp-num');
      metricCols.forEach((mc, mi) => {
        const mcNorm = _norm(mc.col);
        let val = null;
        if (mcNorm.includes('arriendo') || mcNorm.includes('renta')) val = mp.arriendo ?? null;
        else if (mcNorm.includes('uf/m'))   val = mp.ufm2     ?? null;
        else if (mcNorm.includes('stock'))  val = mp.stock    ?? null;
        else if (mcNorm.includes('vacanc')) val = mp.vacancia ?? null;
        html += _cell(_fmtCell(val, mc.fmt), mi === 0 ? 'comp-num comp-sep' : 'comp-num');
      });
    }
    html += `</tr>`;

    // vs Promedio row
    html += `<tr class="comp-situ-vs">`;
    html += `<td class="situ-vs-label"><em>${_esc(mpName)} vs Promedio</em></td>`;
    for (let i = 0; i < infoCols.length + 1; i++) html += `<td></td>`;

    if (hasGroups) {
      const findTipo = g => mp.tipologias?.find(t => String(t.nombre ?? '').toUpperCase().trim() === String(g).toUpperCase().trim());
      for (const g of groups) {
        const t = findTipo(g);
        metricCols.forEach((mc, mi) => {
          const mcNorm = _norm(mc.col);
          let val = null;
          if (mcNorm.includes('util') || mcNorm.includes('útil')) val = t?.sup ?? null;
          else if (mcNorm.includes('uf/m'))  val = t?.ufm2 ?? null;
          else if (mcNorm.includes('renta') || mcNorm.includes('arriendo')) val = t?.renta ?? null;
          html += _vsCell(mi === 0 ? 'comp-num comp-sep' : 'comp-num', val, mktAvg[g]?.[mc.col]);
        });
      }
    } else {
      metricCols.forEach((mc, mi) => {
        const mcNorm = _norm(mc.col);
        let val = null;
        if (mcNorm.includes('arriendo') || mcNorm.includes('renta')) val = mp.arriendo ?? null;
        else if (mcNorm.includes('uf/m'))   val = mp.ufm2     ?? null;
        else if (mcNorm.includes('stock'))  val = mp.stock    ?? null;
        else if (mcNorm.includes('vacanc')) val = mp.vacancia ?? null;
        html += _vsCell(mi === 0 ? 'comp-num comp-sep' : 'comp-num', val, mktAvg[mc.col]);
      });
    }
    html += `</tr>`;
  }

  html += `</tfoot></table></div>`;
  container.innerHTML = html;
}
