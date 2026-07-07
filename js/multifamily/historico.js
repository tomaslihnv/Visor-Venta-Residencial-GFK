const COMUNAS = [
  { label: 'Santiago',         file: 'data/multifamily/multifamily_santiago_historico_20260702.json' },
  { label: 'Estación Central', file: 'data/multifamily/multifamily_estacion_central_historico_20260702.json' },
  { label: 'Las Condes',       file: 'data/multifamily/multifamily_las_condes_historico_20260702.json' },
  { label: 'Lo Barnechea',     file: 'data/multifamily/multifamily_lo_barnechea_historico_20260702.json' },
  { label: 'Providencia',      file: 'data/multifamily/multifamily_providencia_historico_20260702.json' },
  { label: 'Ñuñoa',            file: 'data/multifamily/multifamily_nunoa_historico_20260702.json' },
];

// Tab 2 (evolución/absorción mensual) de cada portfolio
const EVOL_URL = {
  IRR: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_SrPMC9v_h6szyyZUjhqywYeyrwp8AwiguskyC7PzNt8CCE_W6HA_wUTrKA1PWew77AAC1qhVR88i/pub?gid=777209700&single=true&output=csv',
  ECH: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRAuordQ35zGoq-VV0PTJYtoebha0PyUuWS1YTPLo69nTzytyNzg9AtOUMegCmhV1Q7_Ouiv8YGQCXv/pub?gid=1582918076&single=true&output=csv',
};

const PORTFOLIO_COLORS = { IRR: '#2563eb', ECH: '#16a34a' };

const PROGRAMAS_ORDER = ['ESTUDIO', 'LOFT', '1D1B', '1D2B', '2D1B', '2D2B', '3D1B', '3D2B', '3D3B', '4D4B'];
const PROGRAM_COLORS  = {
  'ESTUDIO': '#6366f1', 'LOFT': '#8b5cf6',
  '1D1B':    '#3b82f6', '1D2B': '#06b6d4',
  '2D1B':    '#10b981', '2D2B': '#f59e0b',
  '3D1B':    '#ef4444', '3D2B': '#f97316',
  '3D3B':    '#ec4899', '4D4B': '#64748b',
};

const AVG_COLOR = '#0f172a';

// Mapeo mes abreviado → cuartal
const MONTH_TO_Q = {
  'ene': [1, 1], 'feb': [1, 2], 'mar': [1, 3],
  'abr': [2, 4], 'may': [2, 5], 'jun': [2, 6],
  'jul': [3, 7], 'ago': [3, 8], 'sep': [3, 9],
  'oct': [4,10], 'nov': [4,11], 'dic': [4,12],
};

const _st = { rows: [], progFilt: new Set(), proyFilt: null };
const _selected = new Set();
let _chartRent = null, _chartVac = null;
let _initialized = false;
let _showAvg = false;
let _internalRows = [];
let _internalLabel = 'Mi Portfolio';
let _xFrom = '';   // período inicial del eje X ('' = sin límite)
let _xTo   = '';   // período final del eje X   ('' = sin límite)

// Vacancia por cuartal por portfolio: { "2024-Q1": 12.5, "2024-Q2": 10.3, ... }
const _portfolioVac = { IRR: null, ECH: null };
let _portfolioLoading = false;

const $ = id => document.getElementById(id);

function _avg(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ── Parser CSV mínimo ──────────────────────────────────────────────────────

function _parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let headers = null;
  const result = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const fields = _splitCsvLine(raw);
    if (!headers) { headers = fields.map(f => f.trim()); continue; }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (fields[i] ?? '').trim(); });
    result.push(obj);
  }
  return result;
}

function _splitCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
    else { cur += ch; }
  }
  fields.push(cur);
  return fields;
}

// ── Calcular vacancia por cuartal desde la hoja de evolución ──────────────
// La hoja tiene filas con: Fecha="ene-24", Arriendos acumulados reales (%)="17%"
// Ocupación mensual → promedio por cuartal → vacancia = 100 - ocupación

function _parseOcupacion(s) {
  if (!s || s === '-' || s.trim() === '') return null;
  const n = parseFloat(s.replace('%', '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

function _parseFechaEvol(s) {
  // Formato: "ene-24", "dic-23", etc.
  const m = s.trim().toLowerCase().match(/^([a-z]+)-(\d{2})$/);
  if (!m) return null;
  const [, mes, yy] = m;
  const qData = MONTH_TO_Q[mes];
  if (!qData) return null;
  const year = 2000 + parseInt(yy);
  const q = qData[0];
  return { periodo: `${year}-Q${q}`, year, q };
}

function _calcVacanciaPorCuartal(rows) {
  // Columna de ocupación real
  const COL_OCC = 'Arriendos acumulados reales (%)';
  if (!rows.length || !(COL_OCC in rows[0])) return null;

  // Agrupar valores de ocupación por cuartal
  const byQ = {};   // "2024-Q1" → [occ%, occ%, occ%]
  for (const row of rows) {
    const fecha = row['Fecha'];
    if (!fecha) continue;
    const parsed = _parseFechaEvol(fecha);
    if (!parsed) continue;
    const occ = _parseOcupacion(row[COL_OCC]);
    if (occ === null) continue;   // saltar filas sin datos reales
    if (!byQ[parsed.periodo]) byQ[parsed.periodo] = [];
    byQ[parsed.periodo].push(occ);
  }

  if (!Object.keys(byQ).length) return null;

  // Promediar por cuartal y calcular vacancia
  const result = {};
  for (const [periodo, vals] of Object.entries(byQ)) {
    const avgOcc = _avg(vals);
    result[periodo] = avgOcc !== null ? 100 - avgOcc : null;
  }
  return result;
}

// ── Carga portfolio desde Google Sheets ───────────────────────────────────

async function _loadPortfolio() {
  if (_portfolioLoading) return;
  _portfolioLoading = true;

  const btn = $('histPortfolioBtn');
  if (btn) { btn.textContent = 'Cargando…'; btn.disabled = true; }

  try {
    for (const [key, url] of Object.entries(EVOL_URL)) {
      const text = await fetch(url).then(r => {
        if (!r.ok) throw new Error(`Error cargando ${key} (HTTP ${r.status})`);
        return r.text();
      });
      const rows = _parseCsv(text);
      const result = _calcVacanciaPorCuartal(rows);
      _portfolioVac[key] = result;
    }

    const loaded = Object.entries(_portfolioVac).filter(([, v]) => v);
    if (btn) {
      if (loaded.length) {
        const summary = loaded.map(([k, v]) => {
          const periods = Object.keys(v).sort();
          const last = v[periods[periods.length - 1]];
          return `${k}: ${last?.toFixed(1) ?? '—'}% vac. (últ. cuartal)`;
        });
        btn.textContent = summary.join(' · ');
        btn.classList.add('active');
      } else {
        btn.textContent = 'Sin datos de evolución';
      }
      btn.disabled = false;
    }
    _render();
  } catch (err) {
    console.error(err);
    if (btn) { btn.textContent = 'Error al cargar'; btn.disabled = false; }
    alert('Error cargando portfolio: ' + err.message);
  } finally {
    _portfolioLoading = false;
  }
}

function _clearPortfolio() {
  _portfolioVac.IRR = null;
  _portfolioVac.ECH = null;
  const btn = $('histPortfolioBtn');
  if (btn) { btn.textContent = 'Cargar Portfolio SITU'; btn.classList.remove('active'); btn.disabled = false; }
  _render();
}

// ── Carga de datos de mercado ──────────────────────────────────────────────

async function _loadSelected() {
  if (!_selected.size) {
    _st.rows = [];
    _render();
    return;
  }
  $('histLoadingMsg').style.display = '';
  const results = await Promise.all(
    [..._selected].map(i => fetch(COMUNAS[i].file).then(r => r.json()))
  );
  _st.rows     = results.flat();
  _st.progFilt = new Set();
  _st.proyFilt = null;
  _xFrom = ''; _xTo = '';
  $('histLoadingMsg').style.display = 'none';
  _populateFiltros();
  const allPeriodos = [...new Set(_st.rows.map(r => r['Período Key']))].sort();
  _populateXSelectors(allPeriodos);
  _render();
}

// ── Filtros ────────────────────────────────────────────────────────────────

function _populateFiltros() {
  const programas = [...new Set(_st.rows.map(r => r['Programa']))]
    .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));
  const chipsCont = $('histProgChips');
  chipsCont.innerHTML = programas.map(p => {
    const c = PROGRAM_COLORS[p] ?? '#94a3b8';
    return `<button class="prog-chip" data-prog="${p}" style="border-color:${c}">${p}</button>`;
  }).join('');
  chipsCont.querySelectorAll('.prog-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.prog;
      _st.progFilt.has(p) ? _st.progFilt.delete(p) : _st.progFilt.add(p);
      btn.classList.toggle('active', _st.progFilt.has(p));
      if (btn.classList.contains('active')) {
        btn.style.background = PROGRAM_COLORS[p] ?? '#94a3b8';
        btn.style.color = '#fff';
      } else {
        btn.style.background = '';
        btn.style.color = '';
      }
      _render();
    });
  });

  const proyectos = [...new Set(_st.rows.map(r => r['Proyecto']))].sort();
  const sel = $('histProyectoSel');
  sel.innerHTML = '<option value="">Todos los proyectos</option>' +
    proyectos.map(p => `<option value="${p}">${p}</option>`).join('');
  sel.value   = '';
  sel.onchange = () => { _st.proyFilt = sel.value || null; _render(); };
}

// ── Series ────────────────────────────────────────────────────────────────

function _filtered() {
  return _st.rows.filter(r => {
    if (_st.progFilt.size && !_st.progFilt.has(r['Programa'])) return false;
    if (_st.proyFilt && r['Proyecto'] !== _st.proyFilt) return false;
    return true;
  });
}

// ── Copiar gráfico al portapapeles ─────────────────────────────────────────

async function _copyChart(chart, wrapEl, btnEl) {
  if (!chart || !wrapEl) return;
  const scale = 3;
  const origDPR = chart.options.devicePixelRatio ?? window.devicePixelRatio;
  const origW = chart.width, origH = chart.height;
  chart.options.devicePixelRatio = scale;
  chart.resize(wrapEl.clientWidth, wrapEl.clientHeight);
  const url = chart.toBase64Image('image/png', 1);
  chart.options.devicePixelRatio = origDPR;
  chart.resize(origW, origH);
  chart.update('none');
  try {
    const blob = await fetch(url).then(r => r.blob());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    if (btnEl) {
      const orig = btnEl.textContent;
      btnEl.textContent = '¡Copiado!';
      btnEl.classList.add('copied');
      setTimeout(() => { btnEl.textContent = orig; btnEl.classList.remove('copied'); }, 1800);
    }
  } catch (e) {
    alert('No se pudo copiar: ' + e.message);
  }
}

// ── Populate X-range selectors ─────────────────────────────────────────────

function _populateXSelectors(allPeriodos) {
  const fromSel = $('histXFrom');
  const toSel   = $('histXTo');
  if (!fromSel || !toSel) return;
  const opts = allPeriodos.map(p => `<option value="${p}">${p}</option>`).join('');
  fromSel.innerHTML = `<option value="">Inicio</option>` + opts;
  toSel.innerHTML   = `<option value="">Fin</option>`    + opts;
  // Restaurar valores previos si siguen siendo válidos
  if (_xFrom && allPeriodos.includes(_xFrom)) fromSel.value = _xFrom;
  if (_xTo   && allPeriodos.includes(_xTo))   toSel.value   = _xTo;
}

function _buildSeries(rows, metrica) {
  const allPeriodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  // Aplicar rango X
  const periodos = allPeriodos.filter(p =>
    (!_xFrom || p >= _xFrom) && (!_xTo || p <= _xTo)
  );
  const programas = [...new Set(rows.map(r => r['Programa']))]
    .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));

  const datasets = _showAvg ? [] : programas.map(prog => {
    const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
    const data  = periodos.map(per => {
      const vals = rows
        .filter(r => r['Período Key'] === per && r['Programa'] === prog)
        .map(r => r[metrica]);
      return _avg(vals);
    });
    return {
      label: prog, data,
      borderColor: color, backgroundColor: color + '22',
      borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
    };
  });

  if (_showAvg) {
    const avgData = periodos.map(per => {
      const vals = rows.filter(r => r['Período Key'] === per).map(r => r[metrica]);
      return _avg(vals);
    });
    datasets.push({
      label: 'Promedio mercado',
      data: avgData,
      borderColor: AVG_COLOR,
      backgroundColor: AVG_COLOR + '11',
      borderWidth: 2.5,
      pointRadius: 4,
      pointStyle: 'diamond',
      tension: 0.3,
      spanGaps: true,
      order: 0,
    });
  }

  // Serie propia (JSON cargado manualmente)
  if (_internalRows.length) {
    const internalKey = metrica === 'Arriendo UF' ? 'arriendo_uf' : 'vacancia_pct';
    const internalData = periodos.map(per => {
      const match = _internalRows.find(r => r.periodo === per);
      return match?.[internalKey] ?? null;
    });
    datasets.push({
      label: _internalLabel,
      data: internalData,
      borderColor: '#e11d48',
      backgroundColor: '#e11d4822',
      borderWidth: 2.5,
      borderDash: [10, 4],
      pointRadius: 5,
      tension: 0.3,
      spanGaps: true,
      order: -1,
    });
  }

  // Portfolio SITU — solo en gráfico de vacancia, como serie histórica real por cuartal
  if (metrica === 'Vacancia (%)') {
    for (const [key, vacByQ] of Object.entries(_portfolioVac)) {
      if (!vacByQ) continue;
      const color = PORTFOLIO_COLORS[key];
      const data = periodos.map(per => vacByQ[per] ?? null);
      datasets.push({
        label: `${key} (portfolio)`,
        data,
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2.5,
        borderDash: [6, 3],
        pointRadius: 5,
        pointStyle: 'triangle',
        tension: 0.3,
        spanGaps: true,
        order: -2,
      });
    }
  }

  return { periodos, datasets };
}

function _renderCharts(rows) {
  const opts = yLabel => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: ctx =>
        `${ctx.dataset.label}: ${ctx.parsed.y != null
          ? ctx.parsed.y.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '—'}`
      }},
    },
    scales: {
      x: { ticks: { font: { size: 10 } } },
      y: { title: { display: true, text: yLabel }, ticks: { font: { size: 10 } } },
    },
  });

  const { periodos: p1, datasets: ds1 } = _buildSeries(rows, 'Arriendo UF');
  const { periodos: p2, datasets: ds2 } = _buildSeries(rows, 'Vacancia (%)');

  if (_chartRent) _chartRent.destroy();
  _chartRent = new Chart($('histChartRent'), {
    type: 'line', data: { labels: p1, datasets: ds1 }, options: opts('Arriendo UF'),
  });

  if (_chartVac) _chartVac.destroy();
  _chartVac = new Chart($('histChartVac'), {
    type: 'line', data: { labels: p2, datasets: ds2 }, options: opts('Vacancia (%)'),
  });
}

function _render() {
  const rows = _filtered();
  const hasData = rows.length > 0;

  $('histEmpty').style.display   = hasData ? 'none'  : '';
  $('histCharts').style.display  = hasData ? 'grid'  : 'none';
  $('histFiltros').style.display = hasData ? 'flex'  : 'none';

  if (hasData) _renderCharts(rows);
}

// ── Carga serie interna (JSON manual) ─────────────────────────────────────

function _loadInternalFile(file) {
  _internalLabel = file.name.replace(/\.json$/i, '');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('El archivo debe ser un array JSON.');
      _internalRows = data.filter(r => r.periodo && (r.vacancia_pct != null || r.arriendo_uf != null));
      if (!_internalRows.length) throw new Error('No se encontraron filas válidas. Verifica el formato.');
      $('histInternalName').textContent = _internalLabel;
      $('histInternalClear').style.display = '';
      _render();
    } catch (err) {
      alert('Error leyendo serie propia: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function _clearInternal() {
  _internalRows = [];
  $('histInternalName').textContent = '';
  $('histInternalClear').style.display = 'none';
  $('histInternalFile').value = '';
  _render();
}

// ── Init ──────────────────────────────────────────────────────────────────

function _initComunaChips() {
  const cont = $('histComunaChips');
  cont.innerHTML = COMUNAS.map((c, i) =>
    `<button class="saved-dataset-btn" data-idx="${i}">${c.label}</button>`
  ).join('');
  cont.querySelectorAll('.saved-dataset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      _selected.has(idx) ? _selected.delete(idx) : _selected.add(idx);
      btn.classList.toggle('active', _selected.has(idx));
      _loadSelected();
    });
  });

  const avgBtn = $('histAvgBtn');
  if (avgBtn) {
    avgBtn.addEventListener('click', () => {
      _showAvg = !_showAvg;
      avgBtn.classList.toggle('active', _showAvg);
      avgBtn.style.background = _showAvg ? AVG_COLOR : '';
      avgBtn.style.color      = _showAvg ? '#fff' : '';
      avgBtn.style.borderColor = _showAvg ? AVG_COLOR : '';
      _render();
    });
  }

  const portfolioBtn = $('histPortfolioBtn');
  if (portfolioBtn) {
    portfolioBtn.addEventListener('click', () => {
      const anyLoaded = Object.values(_portfolioVac).some(v => v);
      if (anyLoaded) { _clearPortfolio(); return; }
      _loadPortfolio();
    });
  }

  $('histInternalFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) _loadInternalFile(file);
  });
  $('histInternalClear')?.addEventListener('click', _clearInternal);

  // Rango eje X
  $('histXFrom')?.addEventListener('change', e => { _xFrom = e.target.value; _render(); });
  $('histXTo')?.addEventListener('change',   e => { _xTo   = e.target.value; _render(); });

  // Copy buttons
  $('histCopyRent')?.addEventListener('click', () =>
    _copyChart(_chartRent, $('histWrapRent'), $('histCopyRent')));
  $('histCopyVac')?.addEventListener('click', () =>
    _copyChart(_chartVac, $('histWrapVac'), $('histCopyVac')));
}

export function renderHistorico() {
  if (!_initialized) {
    _initComunaChips();
    _initialized = true;
  }
  if (_st.rows.length) _render();
}
