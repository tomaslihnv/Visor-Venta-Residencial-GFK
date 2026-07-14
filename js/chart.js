import { $, fmt } from './utils.js';
import { state } from './data.js';
import { mp } from './miProyecto.js';
import { getActiveTipoFilter } from './filters.js';

function _fmtTipo(v) {
  const s = String(v ?? '').trim();
  return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
}

// Returns true when S is selected as a filter but 1D is NOT explicitly selected
function _sOnlyNotExplicit1D() {
  const f = getActiveTipoFilter();
  if (!f.has('S')) return false;
  return ![...f].some(sel => sel !== 'S' && _fmtTipo(sel) === '1D');
}

// Returns true if Mi Proyecto typology 'nombre' should be included given current filter
function _mpTipoVisible(nombre, activeTipos) {
  const userFilter = getActiveTipoFilter();
  if (userFilter.size === 0) {
    // No active filter: show if data equiv. is present in filtered rows
    if (!activeTipos) return true;
    return activeTipos.has(_fmtTipo(nombre)) || (nombre === 'S' && activeTipos.has('1D'));
  }
  // Active filter: match against user's actual checkbox selection
  if (userFilter.has(nombre)) return true;
  const fmt = _fmtTipo(nombre);
  // For non-S types: match any selected raw value that formats to the same tipo
  // S is never considered an alias for any other tipo (it maps to 1D in data, but '1D' Mp type ≠ 'S' Mp type)
  for (const sel of userFilter) {
    if (sel !== 'S' && _fmtTipo(sel) === fmt) return true;
  }
  return false;
}

function _parseAxisVal(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

// ============== KPIs ==============
export function renderKpis() {
  const rows = state.filtered;
  const cont = $('#kpis');
  cont.innerHTML = '';

  const sum = (col) => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0);
  const avg = (col) => {
    const nums = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  };
  const dispCol = state.columns.find(c => c.name === 'Disponibles')?.name;
  const wavg = (col) => {
    if (!dispCol) return avg(col);
    let sw = 0, swv = 0;
    for (const r of rows) {
      const v = Number(r[col]);
      const w = Number(r[dispCol]) || 0;
      if (!isNaN(v) && w > 0) { swv += v * w; sw += w; }
    }
    return sw > 0 ? swv / sw : avg(col);
  };

  const kpis = [
    { label: 'Registros', value: rows.length.toLocaleString('es-CL'), sub: `de ${state.raw.length.toLocaleString('es-CL')}` },
  ];

  if (state.columns.find(c => c.name === 'Edificio')) {
    const edificios = new Set(rows.map(r => r['Edificio']).filter(Boolean));
    kpis.push({ label: 'Edificios únicos', value: edificios.size.toLocaleString('es-CL') });
  }
  if (state.columns.find(c => c.name === 'Disponibles')) {
    kpis.push({ label: 'Disponibles', value: fmt(sum('Disponibles')), sub: 'unidades' });
  }
  if (state.columns.find(c => c.name === 'UF/m²')) {
    const v = wavg('UF/m²');
    kpis.push({
      label: 'UF/<span class="keep-case">m²</span> prom. pond.',
      value: v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    });
  }
  if (state.columns.find(c => c.name === 'Ticket UF')) {
    const v = wavg('Ticket UF');
    kpis.push({
      label: 'Ticket UF prom. pond.',
      value: Math.round(v).toLocaleString('es-CL'),
    });
  }
  if (state.columns.find(c => c.name === '% Vendido')) {
    const a = avg('% Vendido');
    const display = a > 1 ? fmt(a) + '%' : (a * 100).toFixed(1) + '%';
    kpis.push({ label: '% Vendido promedio', value: display });
  }
  if (state.columns.find(c => c.name === 'Vel. Venta (un./mes)')) {
    kpis.push({ label: 'Vel. Venta promedio', value: fmt(avg('Vel. Venta (un./mes)')), sub: 'un./mes' });
  }

  for (const k of kpis) {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `<div class="label">${k.label}</div><div class="value">${k.value}</div>${k.sub ? `<div class="sub">${k.sub}</div>` : ''}`;
    cont.appendChild(card);
  }
}

const palette = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7'
];


// ============== Proyectos (barras por edificio) ==============
let proyChart = null;
let proyListenersReady = false;

const PROY_UNITS = { ticket: 'UF', ufm2: 'UF/m²', util: 'm²', disp: 'un.', vel: 'un./mes', oferta: 'un.', pct: '' };

const PROY_METRICS = [
  { id: 'ticket', label: 'Ticket UF',            keys: ['ticket'],                      agg: 'avg', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'ufm2',   label: 'UF/m²',               keys: ['uf/m', 'uf / m'],              agg: 'avg', fmt: v => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { id: 'util',   label: 'Útil (m²)',            keys: ['útil', 'util', 'vendible'],    agg: 'avg', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'disp',   label: 'Disponibles',          keys: ['disponib'],                    agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'vel',    label: 'Vel. Venta (un./mes)', keys: ['vel. venta', 'vel venta'],     agg: 'avg', fmt: v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) },
  { id: 'oferta', label: 'Oferta total proyecto',keys: ['oferta total', 'oferta'],      agg: 'sum', fmt: v => Math.round(v).toLocaleString('es-CL') },
  { id: 'pct',    label: '% Vendido',            keys: ['% vendido', 'pct vendido', 'vendido'], agg: 'avg', fmt: v => {
    const pct = Math.abs(v) <= 1.05 ? v * 100 : v;
    return pct.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%';
  }},
];

function _withMargin(dataUrl, m) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width + m * 2; c.height = img.height + m * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, m, m);
      c.toBlob(resolve, 'image/png');
    };
    img.src = dataUrl;
  });
}

export function populateProyectosSelectors() {
  const sel = $('#proyMetrica');
  if (!sel || proyListenersReady) return;
  proyListenersReady = true;
  sel.addEventListener('change', renderProyectos);
  $('#proyYMin')?.addEventListener('input', renderProyectos);
  $('#proyYMax')?.addEventListener('input', renderProyectos);

  const proyFontSlider = $('#proyFontSize');
  const proyFontVal    = $('#proyFontSizeVal');
  if (proyFontSlider) {
    proyFontSlider.addEventListener('input', () => {
      proyFontVal.textContent = proyFontSlider.value + 'px';
      renderProyectos();
    });
  }

  document.querySelectorAll('.proy-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.proy-xrot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-xrot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProyectos();
    });
  });

  document.querySelectorAll('.proy-median-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proy-median-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProyectos();
    });
  });

  $('#proyExportPngBtn')?.addEventListener('click', async () => {
    if (!proyChart) return;
    const btn = $('#proyExportPngBtn');
    const scale = 4;
    const pad = 32;
    const wrap = $('#proyWrap');
    const ratio = document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto';

    const origDPR = proyChart.options.devicePixelRatio ?? window.devicePixelRatio;
    const exportW = wrap.clientWidth - pad;
    const exportH = ratio === 'auto'
      ? proyChart.height
      : Math.round(exportW / parseFloat(ratio));

    proyChart.options.devicePixelRatio = scale;
    proyChart.resize(exportW, exportH);
    const url = proyChart.toBase64Image('image/png', 1);
    proyChart.options.devicePixelRatio = origDPR;
    proyChart.resize();
    const prev = btn.textContent;
    const blob = await _withMargin(url, 64);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    btn.textContent = '¡Copiado!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
  });
}

export function renderProyectos() {
  if (state.filtered.length === 0) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  const metricId = $('#proyMetrica')?.value ?? 'ticket';
  const metric   = PROY_METRICS.find(m => m.id === metricId) ?? PROY_METRICS[0];

  const edifCol   = state.columns.find(c =>
    ['edificio', 'proyecto', 'building'].some(k => normStr(c.name).includes(k))
  )?.name;
  const metricCol = state.columns.find(c =>
    c.type === 'number' && metric.keys.some(k => normStr(c.name).includes(normStr(k)))
  )?.name;

  if (!edifCol || !metricCol) return;

  const fs = parseInt($('#proyFontSize')?.value ?? '11');
  const xRot = document.querySelector('.proy-xrot-btn.active')?.dataset.rot ?? 'diagonal';
  const xMaxRot = xRot === 'vertical' ? 90 : 45;
  const xMinRot = xRot === 'vertical' ? 90 : 30;
  const showMedian = (document.querySelector('.proy-median-btn.active')?.dataset.median ?? 'show') === 'show';

  if (proyChart) { proyChart.destroy(); proyChart = null; }
  const ctx = $('#proyChart').getContext('2d');

  const unidCol = state.columns.find(c => normStr(c.name).includes('disponib'))?.name;

  const byEdif = {};
  for (const r of state.filtered) {
    const edif = String(r[edifCol] ?? '').trim();
    if (!edif) continue;
    const val = Number(r[metricCol]);
    if (isNaN(val)) continue;
    const w = (unidCol && metric.agg !== 'sum') ? (Number(r[unidCol]) || 1) : 1;
    if (!byEdif[edif]) byEdif[edif] = [];
    byEdif[edif].push([val, w]);
  }

  const aggFn = metric.agg === 'sum'
    ? arr => arr.reduce((a, [v]) => a + v, 0)
    : arr => {
        const totalW = arr.reduce((s, [, w]) => s + w, 0);
        return totalW > 0
          ? arr.reduce((s, [v, w]) => s + v * w, 0) / totalW
          : arr.reduce((s, [v]) => s + v, 0) / arr.length;
      };

  let entries = Object.entries(byEdif)
    .map(([edif, items]) => [edif, aggFn(items)]);

  // Mi Proyecto — respeta el filtro de tipología activo
  let mpName = null;
  let mpVal  = null;
  if (mp.inProy && mp.edificio && mp.tipologias.length > 0) {
    const fmtTipo = v => {
      const s = String(v ?? '').trim();
      return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
    };
    const tipoCol = state.columns.find(c =>
      ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
    );
    const activeTipos = tipoCol
      ? new Set(state.filtered.map(r => fmtTipo(r[tipoCol.name])).filter(Boolean))
      : null;

    const tipos = mp.tipologias.filter(t => t.nombre && _mpTipoVisible(t.nombre, activeTipos));

    const _wavg = items => {
      const valid = items.filter(([, w]) => w > 0);
      if (!valid.length) return items.length ? items.reduce((a, [v]) => a + v, 0) / items.length : null;
      const sw = valid.reduce((a, [, w]) => a + w, 0);
      return valid.reduce((a, [v, w]) => a + v * w, 0) / sw;
    };
    if (metricId === 'ticket') {
      const items = tipos.filter(t => t.sup != null && t.ufm2 != null)
        .map(t => [t.sup * t.ufm2, Number(t.cuantity) || 0]);
      mpVal = _wavg(items);
    } else if (metricId === 'ufm2') {
      const items = tipos.filter(t => t.ufm2 != null)
        .map(t => [t.ufm2, Number(t.cuantity) || 0]);
      mpVal = _wavg(items);
    } else if (metricId === 'util') {
      const items = tipos.filter(t => t.sup != null)
        .map(t => [t.sup, Number(t.cuantity) || 0]);
      mpVal = _wavg(items);
    }
    if (mpVal !== null) {
      mpName = mp.edificio || mp.propietario || 'Mi Proyecto';
      entries.push([mpName, mpVal]);
    }
  }

  entries = entries.sort((a, b) => b[1] - a[1]);

  // Mediana de edificios comparables (excluye Mi Proyecto)
  const compVals = entries.filter(([e]) => e !== mpName).map(([, v]) => v).slice().sort((a, b) => a - b);
  let median = null;
  if (compVals.length > 0) {
    const mid = Math.floor(compVals.length / 2);
    median = compVals.length % 2 === 0 ? (compVals[mid - 1] + compVals[mid]) / 2 : compVals[mid];
  }

  const MP_COLOR  = '#96323C';
  const BAR_COLOR = '#DDE0E3';

  // Plugin inline para etiquetas permanentes sobre cada barra
  const barLabelsPlugin = {
    id: 'barLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c, scales } = chart;
      const meta = chart.getDatasetMeta(0);
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const value = entries[i]?.[1];
        if (value == null) return;
        const isMP = entries[i]?.[0] === mpName;
        c.fillStyle = isMP ? '#96323C' : '#374151';
        c.fillText(metric.fmt(value), bar.x, bar.y - 3);
      });
      c.restore();
    },
  };

  const medianPlugin = {
    id: 'medianPlugin',
    afterDraw(chart) {
      if (median == null) return;
      const { ctx: c, chartArea, scales } = chart;
      const y = scales.y.getPixelForValue(median);
      if (y < chartArea.top || y > chartArea.bottom) return;
      const unit = PROY_UNITS[metricId] ? ' ' + PROY_UNITS[metricId] : '';
      const line1 = `Mediana: ${metric.fmt(median)}${unit}`;
      const lines = [line1];
      if (mpVal != null && mpVal > 0 && median !== mpVal) {
        const diff = ((median - mpVal) / mpVal) * 100;
        const abs = Math.abs(diff).toLocaleString('es-CL', { maximumFractionDigits: 0 });
        lines.push(`(${abs}% ${diff > 0 ? 'mayor' : 'menor'} al proyecto)`);
      }
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      const padX = 8, padY = 4, lineH = fs + 4;
      const labelW = Math.max(...lines.map(l => c.measureText(l).width)) + padX * 2;
      const labelH = lines.length * lineH + padY * 2;
      const labelX = chartArea.right - labelW;
      const labelY = y - labelH / 2;
      c.setLineDash([6, 4]);
      c.strokeStyle = '#ef4444';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(chartArea.left, y);
      c.lineTo(labelX - 4, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(labelX, labelY, labelW, labelH);
      c.fillStyle = '#ef4444';
      c.textAlign = 'left';
      c.textBaseline = 'top';
      lines.forEach((line, i) => c.fillText(line, labelX + padX, labelY + padY + i * lineH));
      c.restore();
    },
  };

  proyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(([e]) => e),
      datasets: [{
        label: metric.label,
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([e]) => e === mpName ? MP_COLOR : BAR_COLOR),
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 40, right: 20, bottom: 12, left: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: item => ` ${metric.fmt(item.raw)}` },
        },
      },
      scales: {
        x: {
          ticks: { maxRotation: xMaxRot, minRotation: xMinRot, font: { size: fs } },
          grid: { display: false },
        },
        y: {
          title: { display: false },
          ticks: { callback: v => metric.fmt(v), font: { size: fs } },
          beginAtZero: true,
          grid: { display: false },
          ...(_parseAxisVal($('#proyYMin')?.value) !== null ? { min: _parseAxisVal($('#proyYMin').value) } : {}),
          ...(_parseAxisVal($('#proyYMax')?.value) !== null ? { max: _parseAxisVal($('#proyYMax').value) } : {}),
        },
      },
    },
    plugins: [barLabelsPlugin, ...(showMedian ? [medianPlugin] : []), {
      id: 'yAxisHLabel',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const labelY = Math.max(chartArea.top - 22, fs + 4);
        const labelX = Math.max(chartArea.left, ctx.measureText(metric.label).width + 4);
        ctx.fillText(metric.label, labelX, labelY);
        ctx.restore();
      },
    }, {
      id: 'proySettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.proy-ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const text = `${ratioMap[ratioVal] ?? ratioVal} · ${fs}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
  });
}

// ============== Sup. vs Precio ==============
let svpListenersReady = false;

// Estado del triángulo de pendiente (draggable)
let svpSlopeXPct   = 0.22;   // posición a lo largo del eje X (0–1)
let svpSlopeDragging = false;
let svpSlopeBbox   = null;    // { x, y, w, h } en coordenadas canvas (CSS px)

const _svpSlpDown = e => {
  if (!svpSlopeBbox) return;
  const r = e.currentTarget.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (mx >= svpSlopeBbox.x && mx <= svpSlopeBbox.x + svpSlopeBbox.w &&
      my >= svpSlopeBbox.y && my <= svpSlopeBbox.y + svpSlopeBbox.h) {
    svpSlopeDragging = true;
    e.preventDefault();
  }
};
const _svpSlpMove = e => {
  const canvas = e.currentTarget;
  const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
  if (!showTrend || !svpSlopeBbox) { canvas.style.cursor = ''; return; }
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (!svpSlopeDragging) {
    const hit = mx >= svpSlopeBbox.x && mx <= svpSlopeBbox.x + svpSlopeBbox.w &&
                my >= svpSlopeBbox.y && my <= svpSlopeBbox.y + svpSlopeBbox.h;
    canvas.style.cursor = hit ? 'grab' : '';
    return;
  }
  canvas.style.cursor = 'grabbing';
  if (!state.chart) return;
  const { scales } = state.chart;
  const xMin = scales.x.min, xMax = scales.x.max, range = xMax - xMin;
  const dataX = scales.x.getValueForPixel(mx);
  svpSlopeXPct = Math.max(0.02, Math.min(0.78, (dataX - xMin) / range));
  state.chart.update('none');
};
const _svpSlpUp = e => {
  svpSlopeDragging = false;
  e.currentTarget.style.cursor = '';
};

export function populateSvpSelectors() {
  if (!$('#svpExportPngBtn')) return;

  if (!svpListenersReady) {
    svpListenersReady = true;

    document.querySelector('.svp-tend-btn')?.addEventListener('click', () => {
      document.querySelector('.svp-tend-btn').classList.toggle('active');
      renderSupVsPrecio();
    });
    document.querySelector('.svp-pred-btn')?.addEventListener('click', () => {
      document.querySelector('.svp-pred-btn').classList.toggle('active');
      state.chart?.update();
    });

    document.querySelectorAll('.svp-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.svp-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const svpFontSlider = $('#svpFontSize');
    if (svpFontSlider) {
      svpFontSlider.addEventListener('input', () => {
        $('#svpFontSizeVal').textContent = svpFontSlider.value + 'px';
        renderSupVsPrecio();
      });
    }

    $('#svpExportPngBtn')?.addEventListener('click', async () => {
      if (!state.chart) return;
      const btn = $('#svpExportPngBtn');
      const scale = 4;
      const pad = 32;
      const wrap = $('#svpWrap');
      const ratio = document.querySelector('.svp-ratio-btn.active')?.dataset.ratio ?? 'auto';

      const origDPR = state.chart.options.devicePixelRatio ?? window.devicePixelRatio;
      const exportW = wrap.clientWidth - pad;
      const exportH = ratio === 'auto'
        ? state.chart.height
        : Math.round(exportW / parseFloat(ratio));

      state.chart.options.devicePixelRatio = scale;
      state.chart.resize(exportW, exportH);
      const url = state.chart.toBase64Image('image/png', 1);
      state.chart.options.devicePixelRatio = origDPR;
      state.chart.resize();

      const blob = await _withMargin(url, 64);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    });
  }
}

function linearRegression(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const sx  = pts.reduce((s, p) => s + p.x, 0);
  const sy  = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const den = n * sx2 - sx * sx;
  if (den === 0) return null;
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  const yMean = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.y - (m * p.x + b)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const r2adj = n > 2 ? 1 - (1 - r2) * (n - 1) / (n - 2) : r2;
  return { m, b, r2, r2adj };
}

function _avgByEdif(rows, supCol, ufm2Col, edifCol) {
  const byEdif = {};
  for (const r of rows) {
    const sup  = Number(r[supCol.name]);
    const ufm2 = Number(r[ufm2Col.name]);
    if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
    const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
    if (!byEdif[edif]) byEdif[edif] = { sups: [], ufm2s: [] };
    byEdif[edif].sups.push(sup);
    byEdif[edif].ufm2s.push(ufm2);
  }
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  return Object.entries(byEdif).map(([edif, { sups, ufm2s }]) => ({
    x: avg(sups),
    y: avg(ufm2s),
    label: edif,
  }));
}

export function renderSupVsPrecio() {
  if (state.filtered.length === 0) return;

  const fs = parseInt($('#svpFontSize')?.value ?? '12');
  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const supCol = state.columns.find(c =>
    c.type === 'number' &&
    ['útil', 'util', 'vendible', 'sup. út', 'sup út'].some(k => normStr(c.name).includes(normStr(k)))
  );
  const ufm2Col = state.columns.find(c =>
    normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m')
  );
  const tipoCol = state.columns.find(c =>
    ['tipolog', 'dormitor'].some(k => normStr(c.name).includes(k))
  );
  const edifCol = state.columns.find(c =>
    ['edificio', 'proyecto', 'building'].some(k => normStr(c.name).includes(k))
  );

  if (!supCol || !ufm2Col) return;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = $('#svpChart').getContext('2d');

  const fmtTipo = v => {
    const s = String(v ?? '').trim();
    return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
  };

  const rows = state.filtered;

  // Tipologías activas según state.filtered (respeta el filtro del sidebar)
  const activeTipos = tipoCol
    ? new Set(rows.map(r => fmtTipo(r[tipoCol.name])).filter(Boolean))
    : null;

  // Mi Proyecto dataset (se construye primero para que aparezca primero en la leyenda)
  let mpFiltered = [];
  const mpDatasets = [];
  if (mp.inSvp && mp.tipologias.length > 0) {
    const mpColor = '#1e293b';
    const mpName  = mp.edificio || mp.propietario || 'Mi Proyecto';
    const mpTipos = mp.tipologias.filter(t => t.nombre && t.sup != null && t.ufm2 != null);
    mpFiltered = mpTipos.filter(t => _mpTipoVisible(t.nombre, activeTipos));

    if (mpFiltered.length > 0) {
      mpDatasets.push({
        label: mpName,
        data: mpFiltered.map(t => ({ x: t.sup, y: t.ufm2, label: `${mpName} ${fmtTipo(t.nombre)}` })),
        backgroundColor: mpColor,
        borderColor: mpColor,
        borderWidth: 2,
        pointRadius: 7,
        pointHoverRadius: 9,
      });
    }
  }

  // Muestras: un punto por fila, coloreado por tipología pero un solo ítem en la leyenda
  const compDatasets = [];
  if (tipoCol) {
    const tipoGroups = {};
    for (const r of rows) {
      const sup  = Number(r[supCol.name]);
      const ufm2 = Number(r[ufm2Col.name]);
      if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
      const tipo = fmtTipo(r[tipoCol.name]) || '—';
      const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
      if (!tipoGroups[tipo]) tipoGroups[tipo] = [];
      tipoGroups[tipo].push({ x: sup, y: ufm2, label: edif });
    }
    const allPts = [];
    Object.keys(tipoGroups).sort().forEach(tipo => {
      for (const pt of tipoGroups[tipo]) allPts.push(pt);
    });
    compDatasets.push({
      label: 'Muestras',
      data: allPts,
      backgroundColor: palette[0] + 'AA',
      borderColor: palette[0],
      borderWidth: 1,
      pointRadius: 5,
      pointHoverRadius: 7,
    });
  } else {
    const pts = [];
    for (const r of rows) {
      const sup  = Number(r[supCol.name]);
      const ufm2 = Number(r[ufm2Col.name]);
      if (isNaN(sup) || isNaN(ufm2) || sup <= 0 || ufm2 <= 0) continue;
      const edif = edifCol ? String(r[edifCol.name] ?? '—') : '—';
      pts.push({ x: sup, y: ufm2, label: edif });
    }
    compDatasets.push({
      label: 'Muestras',
      data: pts,
      backgroundColor: palette[0] + 'AA',
      borderColor: palette[0],
      borderWidth: 1,
      pointRadius: 5,
      pointHoverRadius: 7,
    });
  }

  const datasets = [...mpDatasets, ...compDatasets];

  // ── Regresión lineal sobre todos los puntos comparables ──
  const allCompPts = compDatasets.flatMap(ds => ds.data);
  let reg = null;
  const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
  if (showTrend && allCompPts.length >= 3) {
    reg = linearRegression(allCompPts);
    if (reg) {
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      datasets.push({
        label: `Tendencia  (R² = ${reg.r2.toFixed(2)},  R² aj. = ${reg.r2adj.toFixed(2)})`,
        data: [
          { x: xMin, y: reg.m * xMin + reg.b },
          { x: xMax, y: reg.m * xMax + reg.b },
        ],
        showLine: true,
        borderColor: 'rgba(30,58,95,0.75)',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [7, 4],
        pointRadius: 0,
        fill: false,
        order: 0,
      });
    }
  }



  // Plugin: predicción de la regresión para cada tipología de Mi Proyecto
  const svpMpPredPlugin = {
    id: 'svpMpPred',
    afterDraw(chart) {
      const showPred = document.querySelector('.svp-pred-btn')?.classList.contains('active') ?? false;
      if (!reg || !mpFiltered.length || !showPred) return;
      const { ctx: c, scales, chartArea: ca } = chart;
      c.save();
      for (const t of mpFiltered) {
        const predY   = reg.m * t.sup + reg.b;
        const px      = scales.x.getPixelForValue(t.sup);
        const pyPred  = scales.y.getPixelForValue(predY);
        const pyReal  = scales.y.getPixelForValue(t.ufm2);
        if (px < ca.left || px > ca.right || pyPred < ca.top || pyPred > ca.bottom) continue;

        // Línea vertical punteada del punto real al predicho
        c.setLineDash([4, 3]);
        c.strokeStyle = '#64748b';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(px, Math.min(Math.max(pyReal, ca.top), ca.bottom));
        c.lineTo(px, pyPred);
        c.stroke();
        c.setLineDash([]);

        // Cruz (×) en la regresión
        const r = 5;
        c.strokeStyle = '#ef4444';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(px - r, pyPred - r); c.lineTo(px + r, pyPred + r);
        c.moveTo(px + r, pyPred - r); c.lineTo(px - r, pyPred + r);
        c.stroke();

        // Caja con el valor predicho
        const label = `${fmtTipo(t.nombre)}: ${predY.toLocaleString('es-CL', { maximumFractionDigits: 0 })} UF/m²`;
        c.font = `bold ${fs}px system-ui, sans-serif`;
        const tw = c.measureText(label).width;
        const pad = 5, bh = fs + pad * 2;
        let lx = px + 10;
        if (lx + tw + pad * 2 > ca.right) lx = px - tw - pad * 2 - 10;
        const ly = pyPred - bh / 2;
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fillRect(lx, ly, tw + pad * 2, bh);
        c.strokeStyle = '#ef4444';
        c.lineWidth = 1;
        c.strokeRect(lx, ly, tw + pad * 2, bh);
        c.fillStyle = '#ef4444';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(label, lx + pad, ly + bh / 2);
      }
      c.restore();
    },
  };

  // Plugin: triángulo de pendiente sobre la línea de tendencia
  const svpSlopePlugin = {
    id: 'svpSlope',
    afterDraw(chart) {
      const showTrend = document.querySelector('.svp-tend-btn')?.classList.contains('active') ?? false;
      if (!showTrend || !reg || !allCompPts.length) return;

      const { ctx: c, scales, chartArea: ca } = chart;
      const xs = allCompPts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const range = xMax - xMin;

      // Posición del triángulo: controlada por svpSlopeXPct (draggable)
      const x0 = xMin + range * svpSlopeXPct;
      const dxData = range * 0.14;
      const x1 = x0 + dxData;
      const y0 = reg.m * x0 + reg.b;
      const y1 = reg.m * x1 + reg.b;

      const px0 = scales.x.getPixelForValue(x0);
      const px1 = scales.x.getPixelForValue(x1);
      const py0 = scales.y.getPixelForValue(y0);
      const py1 = scales.y.getPixelForValue(y1);

      if (px0 < ca.left || px1 > ca.right ||
          Math.min(py0, py1) < ca.top || Math.max(py0, py1) > ca.bottom) return;

      const negSlope = py1 > py0; // pendiente negativa → py1 más abajo en canvas
      const lfs = fs;
      c.save();
      c.setLineDash([]);

      // ── Triángulo relleno ──
      c.beginPath();
      c.moveTo(px0, py0);
      c.lineTo(px1, py0);  // vértice recto
      c.lineTo(px1, py1);
      c.closePath();
      c.fillStyle = 'rgba(30,58,95,0.10)';
      c.fill();
      c.strokeStyle = 'rgba(30,58,95,0.35)';
      c.lineWidth = 1;
      c.stroke();

      // ── Flecha desde vértice recto → cajita de interpretación ──
      const aX1 = px1, aY1 = py0;
      const aX2 = px1 + 20, aY2 = py0 + (negSlope ? -22 : 22);
      c.beginPath();
      c.moveTo(aX1, aY1);
      c.lineTo(aX2, aY2);
      c.strokeStyle = '#9ca3af';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.stroke();
      c.setLineDash([]);

      // Punta de flecha
      const ang = Math.atan2(aY2 - aY1, aX2 - aX1);
      const hl = 6;
      c.beginPath();
      c.moveTo(aX2, aY2);
      c.lineTo(aX2 - hl * Math.cos(ang - Math.PI / 6), aY2 - hl * Math.sin(ang - Math.PI / 6));
      c.moveTo(aX2, aY2);
      c.lineTo(aX2 - hl * Math.cos(ang + Math.PI / 6), aY2 - hl * Math.sin(ang + Math.PI / 6));
      c.strokeStyle = '#9ca3af';
      c.lineWidth = 1;
      c.stroke();

      // Cajita de interpretación
      const mStr = (reg.m >= 0 ? '+' : '') +
        reg.m.toLocaleString('es-CL', { maximumFractionDigits: 2 });
      const callout = `+1 m²  →  ${mStr} UF/m²`;
      c.font = `bold ${lfs}px system-ui, sans-serif`;
      const tw = c.measureText(callout).width;
      const bp = 5, bh = lfs + bp * 2, bw = tw + bp * 2;
      const bx = Math.min(aX2 + 4, ca.right - bw - 4);
      const by = aY2 - bh / 2;
      c.fillStyle = 'rgba(255,255,255,0.94)';
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = '#d1d5db';
      c.lineWidth = 0.8;
      c.strokeRect(bx, by, bw, bh);
      c.fillStyle = '#1e3a5f';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(callout, bx + bp, by + bh / 2);

      // Actualizar bounding box del objeto completo para drag
      const bboxX = Math.min(px0, bx) - 4;
      const bboxY = Math.min(py0, py1, by) - 6;
      const bboxR = Math.max(px1 + 10, bx + bw) + 4;
      const bboxB = Math.max(py0, py1, by + bh) + 6;
      svpSlopeBbox = { x: bboxX, y: bboxY, w: bboxR - bboxX, h: bboxB - bboxY };

      // Indicador visual de arrastre
      if (svpSlopeDragging) {
        c.strokeStyle = 'rgba(30,58,95,0.5)';
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.strokeRect(bboxX, bboxY, bboxR - bboxX, bboxB - bboxY);
        c.setLineDash([]);
      }

      c.restore();
    },
  };

  state.chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    plugins: [svpMpPredPlugin, svpSlopePlugin, {
      id: 'svpSettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.svp-ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const ratioLabel = ratioMap[ratioVal] ?? ratioVal;
        const fsSetting = $('#svpFontSize')?.value ?? '12';
        const text = `${ratioLabel} · ${fsSetting}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          callbacks: {
            label: item => {
              if (item.dataset.showLine) return null; // ocultar tooltip en la línea
              const d = item.raw;
              const name = d.label ? `${d.label}: ` : '';
              return `${name}${Number(d.x).toLocaleString('es-CL')} m² · ${Number(d.y).toLocaleString('es-CL')} UF/m²`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Útil (m²)', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'UF/m²', font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
      },
    },
  });

  // Handlers de drag del triángulo de pendiente
  const svpCanvas = $('#svpChart');
  svpCanvas.removeEventListener('mousedown', _svpSlpDown);
  svpCanvas.removeEventListener('mousemove', _svpSlpMove);
  svpCanvas.removeEventListener('mouseup',   _svpSlpUp);
  svpCanvas.addEventListener('mousedown', _svpSlpDown);
  svpCanvas.addEventListener('mousemove', _svpSlpMove);
  svpCanvas.addEventListener('mouseup',   _svpSlpUp);

  if (!svpWidgetInited) initSvpFilterWidget();
  else updateSvpFilterWidget();
}

// ============== Widget de filtros activos (SVP) ==============
let svpWidgetInited = false;

function initSvpFilterWidget() {
  const toggleBtn = document.getElementById('svpFilterWidgetBtn');
  const container = document.getElementById('svpWrap');
  if (!toggleBtn || !container) return;

  const widget = document.createElement('div');
  widget.id = 'svpFilterWidget';
  widget.className = 'map-filter-widget hidden';
  widget.innerHTML = `
    <div class="mfw-header" id="svpFwHeader">
      <span>Filtros activos</span>
      <button class="mfw-close" id="svpFwClose">&#xD7;</button>
    </div>
    <div class="mfw-body" id="svpFwBody"></div>
  `;
  container.appendChild(widget);

  const header = document.getElementById('svpFwHeader');
  header.addEventListener('mousedown', e => {
    if (e.target.id === 'svpFwClose') return;
    const startX = e.clientX, startY = e.clientY;
    const startL = parseInt(widget.style.left) || (container.offsetWidth - 240);
    const startT = parseInt(widget.style.top)  || 10;
    widget.style.left = startL + 'px';
    widget.style.top  = startT + 'px';
    document.body.style.userSelect = 'none';
    const onMove = e => {
      widget.style.left = (startL + e.clientX - startX) + 'px';
      widget.style.top  = (startT + e.clientY - startY) + 'px';
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
  });

  document.getElementById('svpFwClose').addEventListener('click', () => {
    widget.classList.add('hidden');
    toggleBtn.classList.remove('active');
  });

  toggleBtn.addEventListener('click', () => {
    const nowHidden = widget.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !nowHidden);
    if (!nowHidden) {
      if (!widget.style.left) {
        widget.style.left = (container.offsetWidth - 240) + 'px';
        widget.style.top  = '10px';
      }
      updateSvpFilterWidget();
    }
  });

  svpWidgetInited = true;
}

export function updateSvpFilterWidget() {
  const body = document.getElementById('svpFwBody');
  if (!body) return;
  const widget = document.getElementById('svpFilterWidget');
  if (!widget || widget.classList.contains('hidden')) return;
  import('./filters.js').then(({ getActiveFiltersSummary }) => {
    const items = getActiveFiltersSummary();
    body.innerHTML = items.length
      ? items.map(it => `<div class="mfw-row"><span class="mfw-label">${it.label}</span><span class="mfw-value">${it.value}</span></div>`).join('')
      : '<div class="mfw-empty">Sin filtros aplicados</div>';
  });
}

// ============== Distribución (curva de precios) ==============
let distribChart = null;
let distribListenersReady = false;
const distribMarkers = { percentiles: new Set(), prices: new Set() };
let distribUnit = 'UF'; // unidad activa, se actualiza al renderizar

export function populateDistribSelectors() {
  const colSel = $('#distribCol');
  if (!colSel) return;

  const normStr = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const ticketCol = state.columns.find(c => normStr(c.name).includes('ticket'));
  const ufm2Col   = state.columns.find(c => normStr(c.name).includes('uf/m') || normStr(c.name).includes('uf / m'));
  const utilCol   = state.columns.find(c => ['util (m', 'util(m', 'sup. util', 'superficie util', 'sup util'].some(k => normStr(c.name).includes(k)));

  colSel.innerHTML = '';
  if (ticketCol) {
    const o = document.createElement('option');
    o.value = ticketCol.name; o.textContent = 'Ticket UF';
    colSel.appendChild(o);
  }
  if (ufm2Col) {
    const o = document.createElement('option');
    o.value = ufm2Col.name; o.textContent = 'UF/m²';
    colSel.appendChild(o);
  }
  if (utilCol) {
    const o = document.createElement('option');
    o.value = utilCol.name; o.textContent = 'Útil (m²)';
    colSel.appendChild(o);
  }
  if (!colSel.options.length) {
    for (const col of state.columns) {
      if (col.type === 'number') {
        const o = document.createElement('option');
        o.value = col.name; o.textContent = col.name;
        colSel.appendChild(o);
        break;
      }
    }
  }

  if (!distribListenersReady) {
    distribListenersReady = true;
    colSel.addEventListener('change', renderDistrib);
    $('#distribXMin')?.addEventListener('input', renderDistrib);
    $('#distribXMax')?.addEventListener('input', renderDistrib);
    $('#distribYMin')?.addEventListener('input', renderDistrib);
    $('#distribYMax')?.addEventListener('input', renderDistrib);

    const _histBinsCtrl = document.getElementById('histBinsCtrl');
    document.querySelectorAll('.distrib-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.distrib-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (_histBinsCtrl) _histBinsCtrl.style.display = btn.dataset.mode === 'hist' ? '' : 'none';
        renderDistrib();
      });
    });
    const _histBinsSlider = $('#histBins');
    const _histBinsVal    = document.getElementById('histBinsVal');
    if (_histBinsSlider) {
      _histBinsSlider.addEventListener('input', () => {
        if (_histBinsVal) _histBinsVal.textContent = +_histBinsSlider.value === 0 ? 'Auto' : _histBinsSlider.value;
        renderDistrib();
      });
    }

    document.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const fontSlider = $('#distribFontSize');
    const fontVal    = $('#distribFontSizeVal');
    if (fontSlider) {
      fontSlider.addEventListener('input', () => {
        fontVal.textContent = fontSlider.value + 'px';
        renderDistrib();
      });
    }

    document.querySelector('.distrib-mp-btn')?.addEventListener('click', () => {
      document.querySelector('.distrib-mp-btn').classList.toggle('active');
      renderDistrib();
    });

    $('#distribExportPngBtn')?.addEventListener('click', async () => {
      if (!distribChart) return;
      const btn = $('#distribExportPngBtn');
      const scale = 4;
      const pad = 32;
      const wrap = $('#distribWrap');
      const ratio = document.querySelector('.ratio-btn.active')?.dataset.ratio ?? 'auto';

      const origDPR = distribChart.options.devicePixelRatio ?? window.devicePixelRatio;
      const exportW = wrap.clientWidth - pad;
      const exportH = ratio === 'auto'
        ? distribChart.height
        : Math.round(exportW / parseFloat(ratio));

      distribChart.options.devicePixelRatio = scale;
      distribChart.resize(exportW, exportH);
      const url = distribChart.toBase64Image('image/png', 1);

      distribChart.options.devicePixelRatio = origDPR;
      distribChart.resize();

      const blob = await _withMargin(url, 64);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
    });

    const addPct = () => {
      const v = parseInt($('#distribPctInput').value);
      if (isNaN(v) || v < 1 || v > 99) return;
      distribMarkers.percentiles.add(v);
      $('#distribPctInput').value = '';
      refreshMarkerTags();
      renderDistrib();
    };
    $('#distribAddPct').addEventListener('click', addPct);
    $('#distribPctInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPct(); });

    const addPrice = () => {
      const v = parseFloat($('#distribPriceInput').value);
      if (isNaN(v) || v <= 0) return;
      distribMarkers.prices.add(v);
      $('#distribPriceInput').value = '';
      refreshMarkerTags();
      renderDistrib();
    };
    $('#distribAddPrice').addEventListener('click', addPrice);
    $('#distribPriceInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPrice(); });
  }
}

function refreshMarkerTags() {
  const pctContainer   = $('#distribPctTags');
  const priceContainer = $('#distribPriceTags');
  if (!pctContainer) return;

  pctContainer.innerHTML = '';
  [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag pct-tag';
    tag.innerHTML = `P${v} <button data-val="${v}" class="rm-pct">×</button>`;
    tag.querySelector('.rm-pct').addEventListener('click', () => {
      distribMarkers.percentiles.delete(v);
      refreshMarkerTags();
      renderDistrib();
    });
    pctContainer.appendChild(tag);
  });

  priceContainer.innerHTML = '';
  [...distribMarkers.prices].sort((a, b) => a - b).forEach(v => {
    const tag = document.createElement('span');
    tag.className = 'marker-tag price-tag';
    tag.innerHTML = `${v.toLocaleString('es-CL')} ${distribUnit} <button data-val="${v}" class="rm-price">×</button>`;
    tag.querySelector('.rm-price').addEventListener('click', () => {
      distribMarkers.prices.delete(v);
      refreshMarkerTags();
      renderDistrib();
    });
    priceContainer.appendChild(tag);
  });
}

// Curva de cuantiles: X = percentil (0–100%), Y = valor
function computeQuantileCurve(rows, col) {
  const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
  if (vals.length < 2) return [];
  vals.sort((a, b) => a - b);
  const n = vals.length;
  return vals.map((v, i) => ({ x: (i / (n - 1)) * 100, y: v }));
}

// Ajuste log-normal: X = valor (>0), Y = densidad
function computeLogNormal(sortedVals, nPoints = 300) {
  const posVals = sortedVals.filter(v => v > 0);
  const n = posVals.length;
  if (n < 2) return [];
  const logVals = posVals.map(v => Math.log(v));
  const mu  = logVals.reduce((a, b) => a + b, 0) / n;
  const sig = Math.sqrt(logVals.reduce((a, v) => a + (v - mu) ** 2, 0) / (n - 1));
  if (sig === 0) return [];
  const xMin = posVals[0] * 0.5;
  const xMax = posVals[n - 1] * 1.15;
  const step = (xMax - xMin) / nPoints;
  const K = 1 / (sig * Math.sqrt(2 * Math.PI));
  return Array.from({ length: nPoints + 1 }, (_, i) => {
    const x = xMin + i * step;
    if (x <= 0) return { x, y: 0 };
    const y = K / x * Math.exp(-0.5 * ((Math.log(x) - mu) / sig) ** 2);
    return { x, y };
  });
}

function lerpDensity(data, x) {
  if (!data.length) return undefined;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].x <= x && x <= data[i + 1].x) {
      const t = (x - data[i].x) / (data[i + 1].x - data[i].x);
      return data[i].y + t * (data[i + 1].y - data[i].y);
    }
  }
  return 0;
}

function lerpAtX(data, x) {
  if (!data.length) return null;
  if (x <= data[0].x) return data[0].y;
  if (x >= data[data.length - 1].x) return data[data.length - 1].y;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].x <= x && x <= data[i + 1].x) {
      const t = (x - data[i].x) / (data[i + 1].x - data[i].x);
      return data[i].y + t * (data[i + 1].y - data[i].y);
    }
  }
  return null;
}

function lerpAtY(data, y) {
  if (!data.length) return null;
  if (y <= data[0].y) return data[0].x;
  if (y >= data[data.length - 1].y) return data[data.length - 1].x;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].y <= y && y <= data[i + 1].y) {
      const t = (y - data[i].y) / (data[i + 1].y - data[i].y);
      return data[i].x + t * (data[i + 1].x - data[i].x);
    }
  }
  return null;
}

export function renderDistrib() {
  const colSel = $('#distribCol');
  if (!colSel || state.filtered.length === 0) return;

  const col = colSel.value;
  const _nc = col.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  distribUnit = (_nc.includes('uf/m') || _nc.includes('uf / m')) ? 'UF/m²'
              : (_nc.includes('util') || _nc.includes('sup')) ? 'm²'
              : 'UF';
  const fs = parseInt($('#distribFontSize')?.value ?? '11');

  if (distribChart) { distribChart.destroy(); distribChart = null; }
  const ctx = $('#distribChart').getContext('2d');

  const sortedVals = state.filtered
    .map(r => Number(r[col]))
    .filter(v => !isNaN(v))
    .sort((a, b) => a - b);

  const valAtPct = pct => {
    if (!sortedVals.length) return null;
    const idx = Math.min(Math.round((pct / 100) * (sortedVals.length - 1)), sortedVals.length - 1);
    return sortedVals[Math.max(0, idx)];
  };

  const _distribMode = document.querySelector('.distrib-mode-btn.active')?.dataset.mode ?? 'acum';
  const isDens  = _distribMode === 'dens';
  const isHist  = _distribMode === 'hist';

  // ── Modo histograma ──
  if (isHist) {
    const xMinV = _parseAxisVal($('#distribXMin')?.value);
    const xMaxV = _parseAxisVal($('#distribXMax')?.value);

    // Ponderar por Disponibles cuando la columna analizada no es ella misma,
    // ya que cada fila representa un programa/tipología con N unidades.
    const useWeight = col !== 'Disponibles' && state.columns.some(c => c.name === 'Disponibles');
    const histPairs = state.filtered
      .map(r => ({
        v: Number(r[col]),
        w: useWeight ? Math.max(1, Math.round(Number(r['Disponibles']) || 0)) : 1,
      }))
      .filter(p => !isNaN(p.v) &&
        (xMinV === null || p.v >= xMinV) && (xMaxV === null || p.v <= xMaxV)
      );
    if (histPairs.length < 2) return;

    const histVals = histPairs.map(p => p.v);
    const n  = histVals.length;
    const x0 = histVals.reduce((m, v) => Math.min(m, v), Infinity);
    const x1 = histVals.reduce((m, v) => Math.max(m, v), -Infinity);
    const binsInput = parseInt($('#histBins')?.value ?? '0');
    const nBins = binsInput > 0
      ? Math.min(Math.max(binsInput, 2), 80)
      : Math.min(Math.max(Math.ceil(Math.sqrt(n)), 5), 40);
    const binW = (x1 - x0) / nBins || 1;

    const counts = new Array(nBins).fill(0);
    for (const { v, w } of histPairs) {
      counts[Math.min(Math.floor((v - x0) / binW), nBins - 1)] += w;
    }

    const binData = counts.map((count, i) => ({ x: x0 + (i + 0.5) * binW, y: count }));

    const yMinV = _parseAxisVal($('#distribYMin')?.value);
    const yMaxV = _parseAxisVal($('#distribYMax')?.value);

    // Plugin que dibuja el ratio/tamaño en la esquina
    const distribSettingsPlugin = {
      id: 'distribSettings',
      afterDraw(chart) {
        const { ctx: c2, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        c2.save();
        c2.font = '10px system-ui, sans-serif';
        c2.fillStyle = '#c8c8c8';
        c2.textAlign = 'right';
        c2.textBaseline = 'top';
        c2.fillText(`${ratioMap[ratioVal] ?? ratioVal} · ${fs}px`, right - 2, top + 4);
        c2.restore();
      },
    };

    // Plugin que fuerza los ticks exactamente en los bordes de los bins.
    // Chart.js con escala linear genera ticks en valores "lindos" (2000, 2500…)
    // que no coinciden con los bordes reales, lo que hace que las etiquetas
    // aparezcan en medio de las barras. Aquí los reemplazamos.
    const histEdgeTicksPlugin = {
      id: 'histEdgeTicks',
      afterBuildTicks(chart, args) {
        if (args?.scale?.id !== 'x') return;
        // Máximo ~12 ticks visibles; saltar bins si hay demasiados
        const edgeCount = nBins + 1;
        const step     = Math.max(1, Math.ceil(edgeCount / 12));
        args.scale.ticks = Array.from({ length: edgeCount }, (_, i) => ({
          value: x0 + i * binW,
        })).filter((_, i) => i % step === 0);
      },
    };

    distribChart = new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [{
          label: col,
          data: binData,
          backgroundColor: 'rgba(59,130,246,0.55)',
          borderColor: 'rgba(59,130,246,0.85)',
          borderWidth: 1,
          borderRadius: 2,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
        }],
      },
      plugins: [distribSettingsPlugin, histEdgeTicksPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const i = items[0].dataIndex;
                const lo = x0 + i * binW;
                const hi = lo + binW;
                return `${lo.toLocaleString('es-CL', { maximumFractionDigits: 0 })} – ${hi.toLocaleString('es-CL', { maximumFractionDigits: 0 })} ${distribUnit}`;
              },
              label: item => ` ${item.parsed.y} unidades`,
            },
          },
          annotation: { annotations: {} },
        },
        scales: {
          x: {
            type: 'linear',
            // Medio bin de margen a cada lado: el eje Y queda a la izquierda
            // de la primera barra (no encima de su borde), y hay espacio al final.
            min: x0 - binW * 0.5,
            max: x1 + binW * 0.5,
            offset: false,
            title: { display: true, text: col, font: { size: fs } },
            ticks: {
              font: { size: fs },
              maxRotation: 45,
              callback: v => v.toLocaleString('es-CL', { maximumFractionDigits: 0 }),
            },
            grid: { display: false },
          },
          y: {
            title: { display: true, text: 'Frecuencia (unidades)', font: { size: fs } },
            beginAtZero: true,
            ticks: { font: { size: fs } },
            ...(yMinV !== null ? { min: yMinV } : {}),
            ...(yMaxV !== null ? { max: yMaxV } : {}),
          },
        },
      },
    });
    return;
  }

  const refData = computeQuantileCurve(state.filtered, col);
  const kdeData = isDens ? computeLogNormal(sortedVals) : [];

  const chartData = isDens ? kdeData : refData;
  const datasets = [{
    label: col,
    data: chartData,
    borderColor: palette[0],
    backgroundColor: 'rgba(59,130,246,0.08)',
    pointRadius: 0,
    borderWidth: 2,
    tension: isDens ? 0.3 : 0.4,
    fill: true,
  }];

  // Construir anotaciones
  const annotations = {};
  const pctColor   = '#6b7280';
  const priceColor = '#6b7280';
  const annLabel   = (content, color) => ({
    content, display: true, position: 'start',
    color, backgroundColor: 'rgba(255,255,255,0.9)',
    padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
  });

  if (!isDens) {
    // ── Modo acumulada: mismo comportamiento original ──
    [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
      const color = pctColor;
      const price = lerpAtX(refData, pct);
      if (price == null) return;
      const priceLabel = price.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      annotations[`pv_${pct}`] = {
        type: 'line', xMin: pct, xMax: pct, yMax: price,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct}`, color),
      };
      annotations[`ph_${pct}`] = {
        type: 'line', yMin: price, yMax: price, xMax: pct,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${priceLabel} ${distribUnit}`, color),
      };
    });

    [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
      const color = priceColor;
      const pct   = lerpAtY(refData, price);
      const pctForLabel = pct !== null ? pct : 100;
      annotations[`prh_${price}`] = {
        type: 'line', yMin: price, yMax: price, xMax: pctForLabel,
        borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${price.toLocaleString('es-CL')} ${distribUnit}`, color),
      };
      if (pct !== null) {
        annotations[`prv_${price}`] = {
          type: 'line', xMin: pct, xMax: pct, yMax: price,
          borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
          label: annLabel(`P${pct.toFixed(1)}`, color),
        };
      }
    });
  } else {
    // ── Modo densidad: líneas verticales en el eje X ──
    [...distribMarkers.percentiles].sort((a, b) => a - b).forEach(pct => {
      const val = valAtPct(pct);
      if (val == null) return;
      const valLabel = val.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      annotations[`dpv_${pct}`] = {
        type: 'line', xMin: val, xMax: val, yMax: lerpDensity(kdeData, val),
        borderColor: pctColor, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`P${pct}: ${valLabel} ${distribUnit}`, pctColor),
      };
    });

    [...distribMarkers.prices].sort((a, b) => a - b).forEach(price => {
      const pct = lerpAtY(refData, price);
      const pctStr = pct !== null ? ` (P${pct.toFixed(1)})` : '';
      annotations[`dprv_${price}`] = {
        type: 'line', xMin: price, xMax: price, yMax: lerpDensity(kdeData, price),
        borderColor: priceColor, borderWidth: 1.5, borderDash: [6, 4],
        label: annLabel(`${price.toLocaleString('es-CL')} ${distribUnit}${pctStr}`, priceColor),
      };
    });
  }

  // Mi Proyecto annotations
  const showMpDistrib = document.querySelector('.distrib-mp-btn')?.classList.contains('active') ?? true;
  if (showMpDistrib && mp.inDistrib && mp.tipologias.length > 0) {
    const normFn  = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const nc      = normFn(col);
    const isUfm2   = nc.includes('uf/m') || nc.includes('uf / m');
    const isTicket = !isUfm2 && nc.includes('ticket');

    const tipoColObj = state.columns.find(c => ['tipolog', 'dormitor'].some(k => normFn(c.name).includes(k)));
    const fmtTipo = v => {
      const s = String(v ?? '').trim();
      return (/^\d+$/.test(s) && +s > 0 && +s <= 10) ? `${s}D` : s.toUpperCase();
    };
    let mpTipos = mp.tipologias.filter(t => t.nombre);
    if (tipoColObj) {
      const activeTipos = new Set(state.filtered.map(r => fmtTipo(r[tipoColObj.name])).filter(Boolean));
      if (activeTipos.size > 0) {
        mpTipos = mpTipos.filter(t => _mpTipoVisible(t.nombre, activeTipos));
      }
    }

    const mpColor = '#ef4444';
    mpTipos.forEach(t => {
      let val = null;
      if (isUfm2)        val = t.ufm2;
      else if (isTicket) val = (t.sup != null && t.ufm2 != null) ? t.sup * t.ufm2 : null;
      else               val = t.sup;
      if (val == null) return;
      const valLabel = val.toLocaleString('es-CL', { maximumFractionDigits: 0 });
      const mpAnnLabel = (content) => ({
        content, display: true, position: 'start',
        color: mpColor, backgroundColor: 'rgba(255,255,255,0.9)',
        padding: { x: 4, y: 2 }, font: { size: fs, weight: 'bold' },
      });

      if (isDens) {
        // Modo densidad: muestra percentil + valor + tipología en paréntesis
        const pct = lerpAtY(refData, val);
        const pctStr = pct !== null ? `P${Math.round(pct)}: ` : '';
        annotations[`mp_v_${t.id}`] = {
          type: 'line', xMin: val, xMax: val, yMax: lerpDensity(kdeData, val),
          borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
          label: mpAnnLabel(`${pctStr}${valLabel} ${distribUnit} (${t.nombre})`),
        };
      } else {
        // Modo acumulada: líneas cruzadas
        const pct = lerpAtY(refData, val);
        if (pct === null) return;
        annotations[`mp_h_${t.id}`] = {
          type: 'line', yMin: val, yMax: val, xMax: pct,
          borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
          label: mpAnnLabel(`${t.nombre}: ${valLabel}`),
        };
        annotations[`mp_v_${t.id}`] = {
          type: 'line', xMin: pct, xMax: pct, yMax: val,
          borderColor: mpColor, borderWidth: 2, borderDash: [6, 4],
          label: mpAnnLabel(`P${pct.toFixed(1)}`),
        };
      }
    });
  }

  distribChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [{
      id: 'distribSettings',
      afterDraw(chart) {
        const { ctx, chartArea: { right, top } } = chart;
        const ratioVal = document.querySelector('.ratio-btn.active')?.dataset.ratio ?? 'auto';
        const ratioMap = { auto: 'Auto', '1.78': '16:9', '1.33': '4:3', '1': '1:1' };
        const text = `${ratioMap[ratioVal] ?? ratioVal} · ${fs}px`;
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#c8c8c8';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, right - 2, top + 4);
        ctx.restore();
      },
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      layout: { padding: { top: 12, right: Math.max(24, fs * 3), bottom: 12, left: 12 } },
      plugins: {
        legend: { position: 'top', labels: { font: { size: fs } } },
        tooltip: {
          mode: 'nearest',
          intersect: false,
          axis: 'x',
          callbacks: isDens ? {
            title: items => {
              const pt = chartData[items[0]?.dataIndex];
              return pt ? pt.x.toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' ' + distribUnit : '';
            },
            label: item => {
              const pt = chartData[item.dataIndex];
              if (!pt) return '';
              const pct = lerpAtY(refData, pt.x);
              return pct !== null ? ` P${pct.toFixed(1)}` : '';
            },
          } : {
            title: items => {
              const pt = refData[items[0]?.dataIndex];
              return pt ? `P${pt.x.toFixed(1)}` : '';
            },
            label: item => {
              const pt = refData[item.dataIndex];
              if (!pt) return '';
              return ` ${item.dataset.label}: ${pt.y.toLocaleString('es-CL', { maximumFractionDigits: 0 })} ${distribUnit}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: isDens ? {
        x: {
          type: 'linear',
          ...(_parseAxisVal($('#distribXMin')?.value) !== null ? { min: _parseAxisVal($('#distribXMin').value) } : {}),
          ...(_parseAxisVal($('#distribXMax')?.value) !== null ? { max: _parseAxisVal($('#distribXMax').value) } : {}),
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
        },
        y: {
          title: { display: true, text: 'Densidad', font: { size: fs } },
          ticks: { display: false },
          grid: { display: false },
          ...(_parseAxisVal($('#distribYMin')?.value) !== null ? { min: _parseAxisVal($('#distribYMin').value) } : {}),
          ...(_parseAxisVal($('#distribYMax')?.value) !== null ? { max: _parseAxisVal($('#distribYMax').value) } : {}),
        },
      } : {
        x: {
          type: 'linear', min: 0, max: 100,
          title: { display: true, text: 'Percentil (%)', font: { size: fs } },
          ticks: { callback: v => v + '%', font: { size: fs } },
        },
        y: {
          title: { display: true, text: col, font: { size: fs } },
          ticks: { callback: v => v.toLocaleString('es-CL'), font: { size: fs } },
          ...(_parseAxisVal($('#distribYMin')?.value) !== null ? { min: _parseAxisVal($('#distribYMin').value) } : {}),
          ...(_parseAxisVal($('#distribYMax')?.value) !== null ? { max: _parseAxisVal($('#distribYMax').value) } : {}),
        },
      },
    },
  });
  _enableAnnotationLabelDrag(distribChart);
}

function _enableAnnotationLabelDrag(chart) {
  const canvas = chart.canvas;
  let dragging = null;

  function _anns() { return chart.options?.plugins?.annotation?.annotations ?? {}; }

  function _anchor(ann) {
    const ca = chart.chartArea, sx = chart.scales?.x, sy = chart.scales?.y;
    if (!ca || !sx || !sy) return null;
    if (ann.xMin != null && (ann.xMax == null || ann.xMin === ann.xMax))
      return { ax: sx.getPixelForValue(ann.xMin), ay: sy.getPixelForValue(ann.yMin ?? sy.min ?? 0) };
    if (ann.yMin != null && (ann.yMax == null || ann.yMin === ann.yMax))
      return { ax: sx.getPixelForValue(ann.xMin ?? sx.min ?? 0), ay: sy.getPixelForValue(ann.yMin) };
    return null;
  }

  function _box(key) {
    const ann = _anns()[key];
    if (!ann?.label || ann.label.display === false) return null;
    const a = _anchor(ann);
    if (!a) return null;
    const fs = ann.label.font?.size ?? 11;
    const text = Array.isArray(ann.label.content) ? ann.label.content.join(' ') : String(ann.label.content ?? '');
    const ctx2 = canvas.getContext('2d');
    ctx2.save(); ctx2.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = ctx2.measureText(text).width; ctx2.restore();
    return { cx: a.ax + (ann.label.xAdjust ?? 0), cy: a.ay + (ann.label.yAdjust ?? 0), w: tw + 16, h: fs * 1.8 };
  }

  function _hit(mx, my) {
    for (const key of Object.keys(_anns())) {
      const b = _box(key);
      if (b && Math.abs(mx - b.cx) <= b.w / 2 + 10 && Math.abs(my - b.cy) <= b.h / 2 + 10) return key;
    }
    return null;
  }

  canvas.addEventListener('mousedown', e => {
    const key = _hit(e.offsetX, e.offsetY);
    if (!key) return;
    const ann = _anns()[key];
    if (!ann?.label) return;
    e.preventDefault(); e.stopPropagation();
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = false;
    dragging = { key, sx: e.offsetX, sy: e.offsetY, ox: ann.label.xAdjust ?? 0, oy: ann.label.yAdjust ?? 0 };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', e => {
    if (dragging) {
      const ann = _anns()[dragging.key];
      if (!ann?.label) return;
      ann.label.xAdjust = dragging.ox + (e.offsetX - dragging.sx);
      ann.label.yAdjust = dragging.oy + (e.offsetY - dragging.sy);
      chart.update('none');
      canvas.style.cursor = 'grabbing';
    } else {
      const mx = e.offsetX, my = e.offsetY;
      setTimeout(() => { if (!dragging) canvas.style.cursor = _hit(mx, my) ? 'grab' : ''; }, 0);
    }
  });

  function _stop() {
    if (!dragging) return;
    dragging = null; canvas.style.cursor = '';
    if (chart.options.plugins.tooltip) chart.options.plugins.tooltip.enabled = true;
    chart.update('none');
  }
  canvas.addEventListener('mouseup', _stop);
  canvas.addEventListener('mouseleave', _stop);
}