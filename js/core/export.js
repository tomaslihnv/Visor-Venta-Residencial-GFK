export function exportCsv(state, filename) {
  if (!state.filtered.length) return;
  const cols = state.columns.map(c => c.name).filter(n => !n.startsWith('__'));
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of state.filtered) lines.push(cols.map(c => escape(r[c])).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Exporta state.raw (datos ya normalizados, sin filtrar) como JSON para
// guardarlo en data/<visor>/ y poder recargarlo sin volver a procesar el Excel.
export function exportJson(state, filename) {
  if (!state.raw.length) return;
  const blob = new Blob([JSON.stringify(state.raw)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyChartPng(chart, wrapEl, ratioSelector) {
  if (!chart || !wrapEl) return false;
  const scale = 4, pad = 32;
  const ratio = document.querySelector(ratioSelector + '.active')?.dataset.ratio ?? 'auto';
  const origDPR = chart.options.devicePixelRatio ?? window.devicePixelRatio;
  const exportW = wrapEl.clientWidth - pad;
  const exportH = ratio === 'auto' ? chart.height : Math.round(exportW / parseFloat(ratio));
  chart.options.devicePixelRatio = scale;
  chart.resize(exportW, exportH);
  const url = chart.toBase64Image('image/png', 1);
  chart.options.devicePixelRatio = origDPR;
  chart.resize();
  const res = await fetch(url);
  const blob = await res.blob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}

function _cellInlineStyle(srcEl) {
  const c = window.getComputedStyle(srcEl);
  const s = [
    `font-family:'Roboto',Arial,sans-serif`, `font-size:8pt`, `mso-font-size-alt:8`,
    `padding:3pt 7pt`, `vertical-align:middle`, `white-space:nowrap`,
    `mso-wrap-style:none`, `overflow:hidden`, `border:1px solid #e2e8f0`,
  ];
  const bg = c.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') s.push(`background-color:${bg}`);
  s.push(`color:${c.color}`, `font-weight:${c.fontWeight}`, `text-align:${c.textAlign}`);
  if (c.fontStyle === 'italic') s.push(`font-style:italic`);
  if (c.textTransform === 'uppercase') s.push(`text-transform:uppercase`);
  const btw = parseFloat(c.borderTopWidth);
  if (btw > 1) s.push(`border-top:${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`);
  const blw = parseFloat(c.borderLeftWidth);
  if (blw > 1) s.push(`border-left:${c.borderLeftWidth} ${c.borderLeftStyle} ${c.borderLeftColor}`);
  return s.join(';');
}

export async function copyTableHtml(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return false;
  const clone = table.cloneNode(true);
  const srcCells = [...table.querySelectorAll('th, td')];
  const dstCells = [...clone.querySelectorAll('th, td')];
  srcCells.forEach((src, i) => {
    const dst = dstCells[i];
    dst.setAttribute('style', _cellInlineStyle(src));
    dst.removeAttribute('class');
    dst.setAttribute('nowrap', 'nowrap');
    dst.innerHTML = `<span style="font-size:8pt;font-family:'Roboto',Arial,sans-serif;">${dst.innerHTML}</span>`;
  });
  clone.querySelectorAll('tr').forEach(tr => tr.removeAttribute('class'));
  clone.setAttribute('style', "border-collapse:collapse;font-family:'Roboto',Arial,sans-serif;font-size:8pt;");
  clone.removeAttribute('class');
  const srcRows = [...table.querySelectorAll('tbody tr, tfoot tr')];
  const dstRows = [...clone.querySelectorAll('tbody tr, tfoot tr')];
  if (srcRows.length > 0) {
    const srcDataCells = [...srcRows[0].querySelectorAll('th, td')];
    const dstDataCells = [...(dstRows[0]?.querySelectorAll('th, td') ?? [])];
    srcDataCells.forEach((src, i) => {
      if (dstDataCells[i]) {
        const w = Math.ceil(src.getBoundingClientRect().width);
        if (w > 0) dstDataCells[i].setAttribute('width', w);
      }
    });
  }
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${clone.outerHTML}</body></html>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = html; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}
