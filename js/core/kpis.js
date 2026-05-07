// kpiDefs: array of { label, col, agg, fmt, sub?, groupBy? }
// agg: 'avg' | 'sum' | 'count' | 'countUnique'
// fmt: 'int' | 'pct' | 'uf1' | 'uf2' | 'raw'
//
// Example:
//   { label: 'Vacancia prom.', col: 'Vacancia (%)', agg: 'avg', fmt: 'pct', sub: '%' }
//   { label: 'Proyectos',      col: 'Proyecto',     agg: 'countUnique', fmt: 'int' }

export function renderKpis(rows, rawLength, kpiDefs) {
  const cont = document.getElementById('kpis');
  if (!cont) return;
  cont.innerHTML = '';

  for (const def of kpiDefs) {
    let value;
    const nums = def.col
      ? rows.map(r => Number(r[def.col])).filter(v => !isNaN(v) && v > 0)
      : [];

    switch (def.agg) {
      case 'avg':
        value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        break;
      case 'sum':
        value = nums.reduce((a, b) => a + b, 0);
        break;
      case 'count':
        value = rows.length;
        break;
      case 'countUnique':
        value = def.col
          ? new Set(rows.map(r => r[def.col]).filter(Boolean)).size
          : rows.length;
        break;
      default:
        value = 0;
    }

    const card = document.createElement('div');
    card.className = 'kpi-card';
    let displayVal;
    switch (def.fmt) {
      case 'int':  displayVal = Math.round(value).toLocaleString('es-CL'); break;
      case 'pct':  displayVal = value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); break;
      case 'uf1':  displayVal = value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); break;
      case 'uf2':  displayVal = value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); break;
      default:     displayVal = value.toLocaleString('es-CL');
    }

    let subHtml = '';
    if (def.agg === 'count' || def.agg === 'countUnique') {
      if (rawLength != null && def.agg === 'count') {
        subHtml = `<div class="sub">de ${rawLength.toLocaleString('es-CL')}</div>`;
      }
    } else if (def.sub) {
      subHtml = `<div class="sub">${def.sub}</div>`;
    }

    card.innerHTML = `<div class="label">${def.label}</div><div class="value">${displayVal}</div>${subHtml}`;
    cont.appendChild(card);
  }
}
