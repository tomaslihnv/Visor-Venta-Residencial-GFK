import { flattenEntitiesHistorico } from './api.js';

// Tab 2 (evolución/absorción mensual) de cada portfolio
const EVOL_URL = {
  IRR: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_SrPMC9v_h6szyyZUjhqywYeyrwp8AwiguskyC7PzNt8CCE_W6HA_wUTrKA1PWew77AAC1qhVR88i/pub?gid=777209700&single=true&output=csv',
  ECH: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRAuordQ35zGoq-VV0PTJYtoebha0PyUuWS1YTPLo69nTzytyNzg9AtOUMegCmhV1Q7_Ouiv8YGQCXv/pub?gid=1582918076&single=true&output=csv',
};

const PORTFOLIO_COLORS = { IRR: '#2563eb', ECH: '#16a34a' };

// Máximo 8 slots categóricos (regla del skill de dataviz: nunca ciclar más
// hues, o un 9no color se vuelve indistinguible bajo CVD). Las 3 tipologías
// más grandes/infrecuentes (3D2B, 3D3B, 4D4B) se pliegan en "OTROS" — ver
// _foldPrograma() — en vez de generar más colores.
const PROGRAMAS_ORDER = ['ESTUDIO', 'LOFT', '1D1B', '1D2B', '2D1B', '2D2B', '3D1B', 'OTROS'];
const FOLDED_PROGRAMS = new Set(['3D2B', '3D3B', '4D4B']);
function _foldPrograma(p) { return FOLDED_PROGRAMS.has(p) ? 'OTROS' : p; }

// Paleta categórica validada con scripts/validate_palette.js del skill de
// dataviz (7 hues + gris neutro para "OTROS", que no es una identidad sino
// un residual). Corrida real: PASS en banda de luminosidad, piso de croma,
// separación CVD (peor par ΔE 9.1) y piso de visión normal (peor par ΔE
// 19.6). El contraste vs. superficie da WARN por debajo de 3:1 en 3 slots —
// esperado para hues claros, cubierto por la leyenda (arriba, siempre
// visible), no por el color solo.
const PROGRAM_COLORS  = {
  'ESTUDIO': '#2a78d6', 'LOFT': '#008300',
  '1D1B':    '#e87ba4', '1D2B': '#eda100',
  '2D1B':    '#1baf7a', '2D2B': '#eb6834',
  '3D1B':    '#4a3aa7', 'OTROS': '#64748b',
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
// Un solo chart activo, navegado por botones "Vista" (mismo patrón que
// Distribución/SVP/Cruz) en vez de 4 canvases simultáneos.
let _chart = null;
let _histMode = 'rent'; // 'rent' | 'vac' | 'stock' | 'stockvac'
const _stockVacProgFilt = new Set(); // vacío = TODOS (una sola barra de stock total)
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

// Mismo helper y misma paleta de opacidad que las barras de Densidad en
// Distribución (fill 0.55 / borde 0.85) — para que las barras de Histórico
// (Stock, Stock+Vacancia, Absorción) hablen el mismo lenguaje visual.
function _hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!m) return `rgba(59,130,246,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
const _histBarFill   = hex => _hexToRgba(hex, 0.55);
const _histBarBorder = hex => _hexToRgba(hex, 0.85);

// ── Opciones visuales (panel ⚙ Visual, mismo patrón que Distribución/SVP/Cruz) ─
function _histFontSize() { return parseInt($('histFontSize')?.value ?? '11'); }
function _histGridOn()   { return $('histGridToggle') ? $('histGridToggle').checked : true; }
// Colores elegibles por el usuario (panel Visual) — aplican a las series
// "TODOS" (sin desglose por tipología), donde no hay una paleta categórica
// de por medio: barra de Stock total, línea de Vacancia/Absorción/Promedio
// mercado. Cuando hay desglose por tipología se sigue usando PROGRAM_COLORS,
// igual que en Dispersión/Cruz/Proyectos.
function _histBarColor()  { return $('histBarColor')?.value ?? '#2a78d6'; }
function _histLineColor() { return $('histLineColor')?.value ?? '#16a34a'; }

function _avg(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function _sum(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

// Vacancia ponderada: sum(Disponibilidad) / sum(Stock) — NO el promedio
// simple de la columna "Vacancia (%)" ya calculada por fila. Promediar esa
// columna sin ponderar hace que un proyecto de 2 unidades pese lo mismo que
// uno de 500, y por eso la vacancia de mercado no se movía en línea con el
// stock disponible real. Solo se consideran filas con AMBOS campos
// presentes, para que numerador y denominador cuenten exactamente las
// mismas filas.
function _weightedVacancia(rows) {
  const valid = rows.filter(r =>
    r['Stock'] != null && !isNaN(r['Stock']) &&
    r['Disponibilidad'] != null && !isNaN(r['Disponibilidad'])
  );
  if (!valid.length) return null;
  const totalStock = valid.reduce((s, r) => s + r['Stock'], 0);
  const totalDispo = valid.reduce((s, r) => s + r['Disponibilidad'], 0);
  if (!totalStock) return null;
  return Math.round((totalDispo / totalStock) * 100 * 10) / 10;
}

// Promedio que ignora 0 — en Arriendo UF, 0 significa "nada disponible ese
// trimestre para ese programa" (no un precio real), y promediarlo tal cual
// arrastra el promedio de mercado hacia abajo sin motivo.
function _avgPositive(arr) {
  const v = arr.filter(x => x != null && !isNaN(x) && x > 0);
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
// El histórico se arma sobre la consulta a Inciti activa (main.js deja las
// entidades en window._mfHistoricoSource al confirmar una carga), no sobre
// snapshots JSON guardados: entity.periods ya trae la serie trimestral
// completa por proyecto.

function _loadFromCurrentQuery() {
  const source = window._mfHistoricoSource;
  const sourceLabel = $('histSourceLabel');

  if (!source?.entities?.length) {
    _st.rows = [];
    if (sourceLabel) sourceLabel.textContent = '';
    _render();
    return;
  }

  // Plegar tipologías raras en "OTROS" acá, en el único punto de entrada de
  // datos — así chips, series y KPIs ya ven máximo 8 programas sin tener
  // que repetir el fold en cada función que agrupa por 'Programa'.
  _st.rows = flattenEntitiesHistorico(source.entities)
    .map(r => ({ ...r, Programa: _foldPrograma(r['Programa']) }));
  _st.progFilt = new Set();
  _st.proyFilt = null;
  _xFrom = ''; _xTo = '';
  if (sourceLabel) sourceLabel.textContent = source.label ?? '';
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

  _populateStockVacChips(programas);
}

// Chips de tipología propios del gráfico Stock + Vacancia: multi-selección
// (ESTUDIO, 1D1B, 2D1B, ...) más un chip "TODOS" que agrupa todo en una
// sola barra. Vacío = TODOS.
function _populateStockVacChips(programas) {
  const cont = $('histStockVacChips');
  if (!cont) return;
  _stockVacProgFilt.clear();

  const todosChip = `<button class="prog-chip active" data-prog="__todos__" style="background:#1e3a5f;color:#fff;">TODOS</button>`;
  const progChips = programas.map(p => {
    const c = PROGRAM_COLORS[p] ?? '#94a3b8';
    return `<button class="prog-chip" data-prog="${p}" style="border-color:${c}">${p}</button>`;
  }).join('');
  cont.innerHTML = todosChip + progChips;

  const paint = (btn, active, prog) => {
    btn.classList.toggle('active', active);
    btn.style.background = active ? (PROGRAM_COLORS[prog] ?? '#1e3a5f') : '';
    btn.style.color      = active ? '#fff' : '';
  };

  cont.querySelectorAll('.prog-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const prog = btn.dataset.prog;
      if (prog === '__todos__') {
        _stockVacProgFilt.clear();
        cont.querySelectorAll('.prog-chip').forEach(b => paint(b, b.dataset.prog === '__todos__', null));
      } else {
        _stockVacProgFilt.has(prog) ? _stockVacProgFilt.delete(prog) : _stockVacProgFilt.add(prog);
        paint(btn, _stockVacProgFilt.has(prog), prog);
        // "TODOS" queda activo solo cuando no hay tipologías elegidas a mano.
        const todosBtn = cont.querySelector('[data-prog="__todos__"]');
        if (todosBtn) paint(todosBtn, _stockVacProgFilt.size === 0, null);
      }
      _render();
    });
  });
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
  const scale = 3, pad = 32;
  // Misma "Proporción" (botones + custom) que Distribución/SVP/Cruz/Proyectos.
  const customVal = parseFloat($('histRatioCustom')?.value ?? '');
  const ratio = (!isNaN(customVal) && customVal > 0)
    ? String(customVal)
    : (document.querySelector('.hist-ratio-btn.active')?.dataset.ratio ?? 'auto');
  const origDPR = chart.options.devicePixelRatio ?? window.devicePixelRatio;
  const origW = chart.width, origH = chart.height;
  const exportW = wrapEl.clientWidth - pad;
  const exportH = ratio === 'auto' ? origH : Math.round(exportW / parseFloat(ratio));
  chart.options.devicePixelRatio = scale;
  chart.resize(exportW, exportH);
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

function _buildSeries(rows, metrica, agg = _avg) {
  const allPeriodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  // Aplicar rango X
  const periodos = allPeriodos.filter(p =>
    (!_xFrom || p >= _xFrom) && (!_xTo || p <= _xTo)
  );
  const programas = [...new Set(rows.map(r => r['Programa']))]
    .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));

  const isVacancia = metrica === 'Vacancia (%)';
  const isArriendo = metrica === 'Arriendo UF';
  const _aggFor = subset => {
    if (isVacancia) return _weightedVacancia(subset);
    if (isArriendo) return _avgPositive(subset.map(r => r[metrica]));
    return agg(subset.map(r => r[metrica]));
  };

  const datasets = _showAvg ? [] : programas.map(prog => {
    const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
    const data  = periodos.map(per =>
      _aggFor(rows.filter(r => r['Período Key'] === per && r['Programa'] === prog))
    );
    return {
      label: prog, data,
      borderColor: color, backgroundColor: color + '1a',
      borderWidth: 2, pointRadius: 4, tension: 0.3, spanGaps: true,
    };
  });

  if (_showAvg) {
    const avgData = periodos.map(per =>
      _aggFor(rows.filter(r => r['Período Key'] === per))
    );
    const avgColor = _histLineColor();
    datasets.push({
      label: agg === _sum ? 'Total mercado' : 'Promedio mercado',
      data: avgData,
      borderColor: avgColor,
      backgroundColor: avgColor + '11',
      borderWidth: 2.5,
      pointRadius: 4,
      pointStyle: 'diamond',
      tension: 0.3,
      spanGaps: true,
      order: 0,
    });
  }

  // Serie propia (JSON cargado manualmente) — solo aplica a Arriendo/Vacancia,
  // el formato de JSON manual no trae stock.
  if (_internalRows.length && (metrica === 'Arriendo UF' || metrica === 'Vacancia (%)')) {
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

// Stock (barras, TODOS o por tipología) + Vacancia (línea, eje secundario).
// Es un gráfico de eje dual a propósito — la gracia de esta tarjeta es ver
// ambas series juntas. Ambos ejes parten en 0 (beginAtZero) para no
// exagerar la correlación visual estirando/recortando alguno de los dos.
function _buildStockVacSeries(rows) {
  const allPeriodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  const periodos = allPeriodos.filter(p =>
    (!_xFrom || p >= _xFrom) && (!_xTo || p <= _xTo)
  );

  const datasets = [];
  // Filas a considerar para la línea de vacancia: si hay tipologías elegidas,
  // la vacancia también se acota a esas (para que ambas series hablen de lo
  // mismo); con TODOS, es la vacancia de mercado completa.
  const vacRows = _stockVacProgFilt.size
    ? rows.filter(r => _stockVacProgFilt.has(r['Programa']))
    : rows;

  if (_stockVacProgFilt.size) {
    const programas = [...new Set(rows.map(r => r['Programa']))]
      .filter(p => _stockVacProgFilt.has(p))
      .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));
    programas.forEach(prog => {
      const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
      const data = periodos.map(per => _sum(
        rows.filter(r => r['Período Key'] === per && r['Programa'] === prog).map(r => r['Stock'])
      ));
      datasets.push({
        type: 'bar', label: prog, data,
        backgroundColor: _histBarFill(color), borderColor: _histBarBorder(color), borderWidth: 1,
        barPercentage: 1.0, categoryPercentage: 1.0,
        stack: 'stock', order: 2, yAxisID: 'y',
      });
    });
  } else {
    const barColor = _histBarColor();
    const data = periodos.map(per => _sum(
      rows.filter(r => r['Período Key'] === per).map(r => r['Stock'])
    ));
    datasets.push({
      type: 'bar', label: 'Stock total', data,
      backgroundColor: _histBarFill(barColor), borderColor: _histBarBorder(barColor), borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0,
      stack: 'stock', order: 2, yAxisID: 'y',
    });
  }

  const vacData = periodos.map(per =>
    _weightedVacancia(vacRows.filter(r => r['Período Key'] === per))
  );
  const vacColor = _histLineColor();
  datasets.push({
    type: 'line', label: 'Vacancia (%)', data: vacData,
    borderColor: vacColor, backgroundColor: vacColor + '19',
    borderWidth: 2, pointRadius: 4, pointStyle: 'circle', tension: 0.3,
    spanGaps: true, fill: true, order: 0, yAxisID: 'y1',
  });

  return { periodos, datasets };
}

// Absorción neta = variación de unidades ocupadas entre un período y el
// anterior: Ocupadas_t = Stock_t - Disponibilidad_t; Absorción_t =
// Ocupadas_t - Ocupadas_(t-1). Positivo = se arrendaron más unidades de las
// que se liberaron ese período (velocidad de arriendo); negativo = la
// vacancia creció más rápido que el stock. El primer período de la serie
// completa (allPeriodos, no el rango filtrado) queda sin dato porque no hay
// período anterior con el que comparar — así el rango de fechas (Eje X) no
// cambia el valor del primer punto visible.
function _buildAbsorcionSeries(rows) {
  const allPeriodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  const periodos = allPeriodos.filter(p =>
    (!_xFrom || p >= _xFrom) && (!_xTo || p <= _xTo)
  );

  const occupiedFor = subset => {
    const stock = _sum(subset.map(r => r['Stock']));
    const dispo = _sum(subset.map(r => r['Disponibilidad']));
    return (stock != null && dispo != null) ? stock - dispo : null;
  };

  // { absUnits: [...], pctStock: [...] } — pctStock = absorción como % del
  // stock del período anterior, para leer "velocidad" además de unidades.
  const _seriesFor = filterRows => {
    const occByPeriod = {};
    const stockByPeriod = {};
    for (const p of allPeriodos) {
      const subset = filterRows.filter(r => r['Período Key'] === p);
      occByPeriod[p] = occupiedFor(subset);
      stockByPeriod[p] = _sum(subset.map(r => r['Stock']));
    }
    const absUnits = [], pctStock = [];
    periodos.forEach(p => {
      const idx = allPeriodos.indexOf(p);
      if (idx <= 0) { absUnits.push(null); pctStock.push(null); return; }
      const prevP = allPeriodos[idx - 1];
      const cur = occByPeriod[p], prev = occByPeriod[prevP], prevStock = stockByPeriod[prevP];
      if (cur == null || prev == null) { absUnits.push(null); pctStock.push(null); return; }
      const diff = cur - prev;
      absUnits.push(diff);
      pctStock.push(prevStock ? (diff / prevStock) * 100 : null);
    });
    return { absUnits, pctStock };
  };

  const _signColor = ctx => (ctx.raw == null ? '#cbd5e1' : ctx.raw >= 0 ? '#16a34a' : '#dc2626');
  const barFill   = ctx => _histBarFill(_signColor(ctx));
  const barBorder = ctx => _histBarBorder(_signColor(ctx));

  const datasets = [];
  if (_stockVacProgFilt.size) {
    const programas = [...new Set(rows.map(r => r['Programa']))]
      .filter(p => _stockVacProgFilt.has(p))
      .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));
    programas.forEach(prog => {
      const { absUnits, pctStock } = _seriesFor(rows.filter(r => r['Programa'] === prog));
      const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
      datasets.push({
        type: 'bar', label: prog, data: absUnits, pctStock,
        backgroundColor: _histBarFill(color), borderColor: _histBarBorder(color), borderWidth: 1,
        barPercentage: 1.0, categoryPercentage: 1.0, stack: 'abs',
      });
    });
  } else {
    const { absUnits, pctStock } = _seriesFor(rows);
    datasets.push({
      type: 'bar', label: 'Absorción neta', data: absUnits, pctStock,
      backgroundColor: barFill, borderColor: barBorder, borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0,
    });
  }

  return { periodos, datasets };
}

// Stock (barras, TODOS o por tipología) + Absorción neta (línea, eje
// secundario) — mismo patrón dual-axis que Stock + Vacancia, pero pareando
// el nivel de stock con su velocidad de arriendo en vez de la vacancia.
function _buildStockAbsSeries(rows) {
  const allPeriodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  const periodos = allPeriodos.filter(p =>
    (!_xFrom || p >= _xFrom) && (!_xTo || p <= _xTo)
  );

  const absRows = _stockVacProgFilt.size
    ? rows.filter(r => _stockVacProgFilt.has(r['Programa']))
    : rows;

  const occupiedFor = subset => {
    const stock = _sum(subset.map(r => r['Stock']));
    const dispo = _sum(subset.map(r => r['Disponibilidad']));
    return (stock != null && dispo != null) ? stock - dispo : null;
  };
  const occByPeriod = {};
  for (const p of allPeriodos) {
    occByPeriod[p] = occupiedFor(absRows.filter(r => r['Período Key'] === p));
  }
  const absData = periodos.map(p => {
    const idx = allPeriodos.indexOf(p);
    if (idx <= 0) return null;
    const cur = occByPeriod[p], prev = occByPeriod[allPeriodos[idx - 1]];
    return (cur != null && prev != null) ? cur - prev : null;
  });

  const datasets = [];
  if (_stockVacProgFilt.size) {
    const programas = [...new Set(rows.map(r => r['Programa']))]
      .filter(p => _stockVacProgFilt.has(p))
      .sort((a, b) => PROGRAMAS_ORDER.indexOf(a) - PROGRAMAS_ORDER.indexOf(b));
    programas.forEach(prog => {
      const color = PROGRAM_COLORS[prog] ?? '#94a3b8';
      const data = periodos.map(per => _sum(
        rows.filter(r => r['Período Key'] === per && r['Programa'] === prog).map(r => r['Stock'])
      ));
      datasets.push({
        type: 'bar', label: prog, data,
        backgroundColor: _histBarFill(color), borderColor: _histBarBorder(color), borderWidth: 1,
        barPercentage: 1.0, categoryPercentage: 1.0,
        stack: 'stock', order: 2, yAxisID: 'y',
      });
    });
  } else {
    const barColor = _histBarColor();
    const data = periodos.map(per => _sum(
      rows.filter(r => r['Período Key'] === per).map(r => r['Stock'])
    ));
    datasets.push({
      type: 'bar', label: 'Stock total', data,
      backgroundColor: _histBarFill(barColor), borderColor: _histBarBorder(barColor), borderWidth: 1,
      barPercentage: 1.0, categoryPercentage: 1.0,
      stack: 'stock', order: 2, yAxisID: 'y',
    });
  }

  const absColor = _histLineColor();
  datasets.push({
    type: 'line', label: 'Absorción neta', data: absData,
    borderColor: absColor, backgroundColor: absColor + '19',
    borderWidth: 2, pointRadius: 4, pointStyle: 'circle', tension: 0.3,
    spanGaps: true, fill: false, order: 0, yAxisID: 'y1',
  });

  return { periodos, datasets };
}

const _MODE_META = {
  rent:     { metric: 'Arriendo UF',   agg: _avg, yLabel: 'Arriendo UF',       unit: ' UF' },
  vac:      { metric: 'Vacancia (%)',  agg: _avg, yLabel: 'Vacancia (%)',      unit: '%' },
  stock:    { metric: 'Stock',         agg: _sum, yLabel: 'Stock (unidades)',  unit: ' unid.' },
};

function _lineOpts(yLabel, unit, fs, gridOn) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: 54, top: Math.max(18, fs * 1.5) } },
    elements: { line: { borderCapStyle: 'round', borderJoinStyle: 'round' } },
    plugins: {
      legend: { position: 'top', align: 'center', labels: { boxWidth: 12, font: { size: fs }, color: '#475569' } },
      tooltip: {
        backgroundColor: '#1e293b', padding: 10, cornerRadius: 8,
        titleFont: { size: fs + 1, weight: '600' }, bodyFont: { size: fs + 1 },
        callbacks: { label: ctx =>
          `${ctx.dataset.label}: ${ctx.parsed.y != null
            ? ctx.parsed.y.toLocaleString('es-CL', { maximumFractionDigits: 2 }) + unit : '—'}`
        },
      },
    },
    scales: {
      x: { grid: { color: '#f1f5f9', display: gridOn }, border: { color: '#e2e8f0' }, ticks: { font: { size: fs - 1 }, color: '#94a3b8' } },
      y: {
        beginAtZero: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { display: false },
        title: { display: true, text: yLabel, font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
    },
  };
}

function _stockVacOpts(fs, gridOn) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: 12, top: Math.max(18, fs * 1.5) } },
    plugins: {
      legend: { position: 'top', align: 'center', labels: { boxWidth: 12, font: { size: fs }, color: '#475569' } },
      tooltip: {
        backgroundColor: '#1e293b', padding: 10, cornerRadius: 8,
        titleFont: { size: fs + 1, weight: '600' }, bodyFont: { size: fs + 1 },
        callbacks: { label: ctx => {
          const unit = ctx.dataset.yAxisID === 'y1' ? '%' : ' unid.';
          return ` ${ctx.dataset.label}: ${ctx.parsed.y != null
            ? ctx.parsed.y.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + unit : '—'}`;
        } },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { color: '#e2e8f0' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
      y: {
        stacked: true, beginAtZero: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { display: false },
        title: { display: true, text: 'Stock (unidades)', font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
      y1: {
        beginAtZero: true, position: 'right',
        grid: { drawOnChartArea: false }, border: { display: false },
        title: { display: true, text: 'Vacancia (%)', font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
    },
  };
}

function _stockAbsOpts(fs, gridOn) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: 12, top: Math.max(18, fs * 1.5) } },
    plugins: {
      legend: { position: 'top', align: 'center', labels: { boxWidth: 12, font: { size: fs }, color: '#475569' } },
      tooltip: {
        backgroundColor: '#1e293b', padding: 10, cornerRadius: 8,
        titleFont: { size: fs + 1, weight: '600' }, bodyFont: { size: fs + 1 },
        callbacks: { label: ctx => {
          if (ctx.dataset.yAxisID === 'y1') {
            const v = ctx.parsed.y;
            return ` ${ctx.dataset.label}: ${v != null ? (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('es-CL') + ' unid.' : '—'}`;
          }
          return ` ${ctx.dataset.label}: ${ctx.parsed.y != null
            ? ctx.parsed.y.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' unid.' : '—'}`;
        } },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { color: '#e2e8f0' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
      y: {
        stacked: true, beginAtZero: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { display: false },
        title: { display: true, text: 'Stock (unidades)', font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
      y1: {
        position: 'right',
        grid: { drawOnChartArea: false }, border: { display: false },
        title: { display: true, text: 'Absorción neta (unidades)', font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
    },
  };
}

// ── Anti-solape de etiquetas ────────────────────────────────────────────────
// Con varias tipologías/series en el mismo gráfico, los textos de valor
// terminan pisándose entre sí. En vez de ocultar el que sobra, cada label
// candidato se compara contra las cajas ya dibujadas en ese frame (guardadas
// en chart._histLabelRects) y si solapa se va empujando más lejos de su
// punto/barra ancla (en pasos de una altura de línea) hasta encontrar hueco
// libre — nunca desaparece, en el peor caso queda apilado más arriba/abajo.
// _labelResetPlugin limpia esa lista una vez por frame, antes de que corra
// cualquier plugin de etiquetas (debe ir primero en el array `plugins`).
const _labelResetPlugin = {
  id: 'histLabelReset',
  beforeDatasetsDraw(chart) { chart._histLabelRects = []; },
};

// Posiciones arrastradas a mano por el usuario — persisten por modo/label
// mientras la pestaña sigue abierta (se pierden si se recarga la consulta),
// mismo espíritu que el drag de las etiquetas "mediana"/marcadores en
// Proyectos/Distribución, pero implementado a mano porque estas etiquetas
// se dibujan directo en canvas (no son elementos del plugin annotation).
const _histLabelOffsets = {}; // { [mode]: { [key]: {dx, dy, touched} } }
function _labelOffsetFor(mode, key) {
  const byMode = (_histLabelOffsets[mode] ??= {});
  return (byMode[key] ??= { dx: 0, dy: 0, touched: false });
}

function _tryPlaceLabel(chart, ctx, text, x, y, baseline, key) {
  const w = ctx.measureText(text).width;
  const h = (parseInt(ctx.font, 10) || 11) + 2;
  const off = key ? _labelOffsetFor(_histMode, key) : null;
  let placedX = x, placedY = y;

  if (off?.touched) {
    // El usuario ya la movió a mano — respetar esa posición sin anti-solape.
    placedX = x + off.dx;
    placedY = y + off.dy;
  } else {
    const dir = baseline === 'bottom' ? -1 : 1; // empujar más lejos del ancla
    // Nunca empujar la etiqueta fuera del canvas — si no queda hueco dentro
    // de esos límites, se deja apilada en el borde (posiblemente pisando
    // otra) en vez de quedar dibujada fuera de vista, indistinguible de
    // "desaparecida".
    const minY = h;
    const maxY = chart.height - 4;
    const MAX_STEPS = 8;
    const rects = chart._histLabelRects || (chart._histLabelRects = []);
    for (let n = 0; n <= MAX_STEPS; n++) {
      const testY = Math.min(maxY, Math.max(minY, y + dir * n * h));
      const rectY = baseline === 'bottom' ? testY - h : testY;
      const rect = { x: x - w / 2 - 2, y: rectY, w: w + 4, h };
      const overlaps = rects.some(r =>
        rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y
      );
      if (!overlaps || n === MAX_STEPS) { placedY = testY; break; }
    }
  }

  const rects = chart._histLabelRects || (chart._histLabelRects = []);
  const rectY = baseline === 'bottom' ? placedY - h : placedY;
  rects.push({ x: placedX - w / 2 - 2, y: rectY, w: w + 4, h, key });
  ctx.textBaseline = baseline;
  ctx.fillText(text, placedX, placedY);
}

// Etiqueta con las unidades de stock absorbidas (consumidas) ese trimestre,
// sobre (positivo) o bajo (negativo) cada barra — mismo patrón que las
// etiquetas de cantidad del histograma de Densidad.
function _absorcionLabelsPlugin(fs) {
  return {
    id: 'absorcionLabels',
    afterDraw(chart) {
      const { ctx: c } = chart;
      c.save();
      c.font = `bold ${fs}px system-ui, sans-serif`;
      c.textAlign = 'center';
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (val == null) return;
          c.fillStyle = val >= 0 ? '#16a34a' : '#dc2626';
          const baseline = val >= 0 ? 'bottom' : 'top';
          const y = val >= 0 ? bar.y - 3 : bar.y + 3;
          const text = `${val >= 0 ? '+' : ''}${Math.round(val).toLocaleString('es-CL')}`;
          _tryPlaceLabel(chart, c, text, bar.x, y, baseline, `abs-${di}-${i}`);
        });
      });
      c.restore();
    },
  };
}

// Etiquetas de valor para gráficos de línea (Arriendo/Vacancia/Stock) — un
// texto sobre cada punto con el valor formateado, mismo lenguaje visual que
// las etiquetas de barras de Absorción/Stock+Vacancia.
function _lineLabelsPlugin(fs, fmt) {
  return {
    id: 'lineLabels',
    afterDraw(chart) {
      const { ctx: c } = chart;
      c.save();
      c.font = `600 ${fs - 1}px system-ui, sans-serif`;
      c.textAlign = 'center';
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'bar') return;
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        c.fillStyle = ds.borderColor ?? '#334155';
        meta.data.forEach((pt, i) => {
          const val = ds.data[i];
          if (val == null) return;
          _tryPlaceLabel(chart, c, fmt(val), pt.x, pt.y - 6, 'bottom', `line-${di}-${i}`);
        });
      });
      c.restore();
    },
  };
}

// Etiquetas de valor sobre las barras de Stock (Stock + Vacancia) — mismo
// patrón que _absorcionLabelsPlugin pero para valores siempre positivos
// (stock nunca es negativo), así que siempre van arriba de la barra.
function _stockBarLabelsPlugin(fs) {
  return {
    id: 'stockBarLabels',
    afterDraw(chart) {
      const { ctx: c } = chart;
      c.save();
      c.font = `bold ${fs - 1}px system-ui, sans-serif`;
      c.textAlign = 'center';
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type !== 'bar') return;
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        c.fillStyle = '#334155';
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (val == null) return;
          _tryPlaceLabel(chart, c, Math.round(val).toLocaleString('es-CL'), bar.x, bar.y - 3, 'bottom', `bar-${di}-${i}`);
        });
      });
      c.restore();
    },
  };
}

function _absorcionOpts(fs, gridOn) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: Math.max(20, fs * 2), bottom: Math.max(16, fs * 1.5), right: 12 } },
    plugins: {
      legend: { position: 'top', align: 'center', labels: { boxWidth: 12, font: { size: fs }, color: '#475569' } },
      tooltip: {
        backgroundColor: '#1e293b', padding: 10, cornerRadius: 8,
        titleFont: { size: fs + 1, weight: '600' }, bodyFont: { size: fs + 1 },
        callbacks: { label: ctx => {
          if (ctx.parsed.y == null) return ` ${ctx.dataset.label}: —`;
          const units = ctx.parsed.y;
          const pct = ctx.dataset.pctStock?.[ctx.dataIndex];
          const pctStr = pct != null ? ` (${pct >= 0 ? '+' : ''}${pct.toLocaleString('es-CL', { maximumFractionDigits: 1 })}% del stock)` : '';
          return ` ${ctx.dataset.label}: ${units >= 0 ? '+' : ''}${Math.round(units).toLocaleString('es-CL')} unid.${pctStr}`;
        } },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { color: '#e2e8f0' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
      y: {
        stacked: true, beginAtZero: true,
        grid: { color: '#f1f5f9', display: gridOn }, border: { display: false },
        title: { display: true, text: 'Absorción neta (unidades)', font: { size: fs, weight: '600' }, color: '#64748b' },
        ticks: { font: { size: fs - 1 }, color: '#94a3b8' },
      },
    },
  };
}

// Renderiza SOLO el chart de la vista activa (_histMode) en el único canvas
// #histChart — igual lógica de navegación que los botones "Vista" de
// Distribución/SVP/Cruz, en vez de 4 canvases simultáneos.
function _renderActiveChart(rows) {
  const fs = _histFontSize();
  const gridOn = _histGridOn();
  const subtitle = periodos => periodos.length
    ? `${periodos[0]} – ${periodos[periodos.length - 1]}`
    : '';

  // Los chips de tipología (TODOS / por programa) los usan tanto Stock +
  // Vacancia como Absorción — ambos parten de las mismas columnas Stock /
  // Disponibilidad, así que comparten el mismo filtro.
  const stockVacChipsEl = $('histStockVacChips');
  if (stockVacChipsEl) stockVacChipsEl.style.display = (_histMode === 'stockvac' || _histMode === 'absorcion' || _histMode === 'stockabs') ? '' : 'none';

  if (_chart) { _chart.destroy(); _chart = null; }
  const canvas = $('histChart');
  if (!canvas) return;

  if (_histMode === 'stockvac') {
    // Stock (barras, por tipología o TODOS) + Vacancia (línea, eje secundario)
    // en un solo gráfico — a propósito: la gracia es verlos juntos. Mitigado
    // con ambos ejes en beginAtZero (nada de recortar el 0 para "estirar" la
    // correlación) y encodings bien distintos (relleno sólido vs. línea).
    const { periodos, datasets } = _buildStockVacSeries(rows);
    const sub = $('histSub'); if (sub) sub.textContent = subtitle(periodos);
    _chart = new Chart(canvas, {
      type: 'bar', data: { labels: periodos, datasets }, options: _stockVacOpts(fs, gridOn),
      plugins: [_labelResetPlugin, _stockBarLabelsPlugin(fs)],
    });
    return;
  }

  if (_histMode === 'stockabs') {
    // Stock (barras) + Absorción neta (línea, eje secundario) — pareo directo
    // de nivel de stock con velocidad de arriendo.
    const { periodos, datasets } = _buildStockAbsSeries(rows);
    const sub = $('histSub'); if (sub) sub.textContent = subtitle(periodos);
    const absFmt = v => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('es-CL');
    _chart = new Chart(canvas, {
      type: 'bar', data: { labels: periodos, datasets }, options: _stockAbsOpts(fs, gridOn),
      plugins: [_labelResetPlugin, _stockBarLabelsPlugin(fs), _lineLabelsPlugin(fs, absFmt)],
    });
    return;
  }

  if (_histMode === 'absorcion') {
    const { periodos, datasets } = _buildAbsorcionSeries(rows);
    const sub = $('histSub'); if (sub) sub.textContent = subtitle(periodos);
    _chart = new Chart(canvas, {
      type: 'bar', data: { labels: periodos, datasets }, options: _absorcionOpts(fs, gridOn),
      plugins: [_labelResetPlugin, _absorcionLabelsPlugin(fs)],
    });
    return;
  }

  const meta = _MODE_META[_histMode] ?? _MODE_META.rent;
  const { periodos, datasets } = _buildSeries(rows, meta.metric, meta.agg);
  const sub = $('histSub'); if (sub) sub.textContent = subtitle(periodos);
  const fmt = v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + meta.unit;
  _chart = new Chart(canvas, {
    type: 'line', data: { labels: periodos, datasets }, options: _lineOpts(meta.yLabel, meta.unit, fs, gridOn),
    plugins: [_labelResetPlugin, _lineLabelsPlugin(fs, fmt)],
  });
}

// ── KPIs resumen ────────────────────────────────────────────────────────────

// goodUp: true/false colorea la variación como buena/mala (verde/rojo);
// null la deja neutra (gris) — usar cuando subir o bajar no es en sí bueno
// ni malo (ej. Stock: más unidades no es "mejor", solo informativo).
function _deltaHtml(curr, prevVal, goodUp) {
  if (curr == null || prevVal == null || prevVal === 0) return '';
  const diff = curr - prevVal;
  const pct  = (diff / Math.abs(prevVal)) * 100;
  const isPos = diff > 0;
  const cls   = goodUp === null ? 'vs-zero'
    : diff === 0 ? 'vs-zero' : ((isPos === goodUp) ? 'vs-pos' : 'vs-neg');
  const arrow = diff === 0 ? '·' : (isPos ? '▲' : '▼');
  return `<span class="hist-kpi-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function _renderKpis(rows) {
  const cont = $('histKpis');
  if (!cont) return;

  const periodos = [...new Set(rows.map(r => r['Período Key']))].sort();
  if (!periodos.length) { cont.style.display = 'none'; return; }

  const last = periodos[periodos.length - 1];
  const prev = periodos.length > 1 ? periodos[periodos.length - 2] : null;
  const avgFor = (per, metrica) => _avgPositive(rows.filter(r => r['Período Key'] === per).map(r => r[metrica]));

  const sumFor = (per, metrica) => _sum(rows.filter(r => r['Período Key'] === per).map(r => r[metrica]));

  const rentLast = avgFor(last, 'Arriendo UF');
  const rentPrev = prev ? avgFor(prev, 'Arriendo UF') : null;
  const vacLast  = _weightedVacancia(rows.filter(r => r['Período Key'] === last));
  const vacPrev  = prev ? _weightedVacancia(rows.filter(r => r['Período Key'] === prev)) : null;
  const stockLast = sumFor(last, 'Stock');
  const stockPrev = prev ? sumFor(prev, 'Stock') : null;

  // Absorción neta del último período: Ocupadas = Stock - Disponibilidad,
  // Absorción = Ocupadas_último - Ocupadas_previo (mismo cálculo que la
  // vista "Absorción" del gráfico).
  const dispoLast = sumFor(last, 'Disponibilidad');
  const dispoPrev = prev ? sumFor(prev, 'Disponibilidad') : null;
  const occLast = (stockLast != null && dispoLast != null) ? stockLast - dispoLast : null;
  const occPrev = (stockPrev != null && dispoPrev != null) ? stockPrev - dispoPrev : null;
  const absLast = (occLast != null && occPrev != null) ? occLast - occPrev : null;

  const proyectos = new Set(rows.map(r => r['Proyecto'])).size;
  const comunas   = new Set(rows.map(r => r['Comuna']).filter(Boolean)).size;

  const fmtUF  = v => v != null ? v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) : '—';
  const fmtPct = v => v != null ? v.toFixed(1) : '—';
  const fmtInt = v => v != null ? Math.round(v).toLocaleString('es-CL') : '—';

  cont.style.display = 'grid';
  cont.innerHTML = `
    <div class="hist-kpi-card" style="--hist-kpi-accent:#2563eb;">
      <span class="hist-kpi-label">Arriendo UF prom.</span>
      <span class="hist-kpi-value">${fmtUF(rentLast)} ${_deltaHtml(rentLast, rentPrev, true)}</span>
      <span class="hist-kpi-sub">Último período: ${last}</span>
    </div>
    <div class="hist-kpi-card" style="--hist-kpi-accent:#dc2626;">
      <span class="hist-kpi-label">Vacancia</span>
      <span class="hist-kpi-value">${fmtPct(vacLast)}% ${_deltaHtml(vacLast, vacPrev, false)}</span>
      <span class="hist-kpi-sub">Último período: ${last}</span>
    </div>
    <div class="hist-kpi-card" style="--hist-kpi-accent:#d97706;">
      <span class="hist-kpi-label">Stock total</span>
      <span class="hist-kpi-value">${fmtInt(stockLast)} ${_deltaHtml(stockLast, stockPrev, null)}</span>
      <span class="hist-kpi-sub">Unidades · último período</span>
    </div>
    <div class="hist-kpi-card" style="--hist-kpi-accent:${absLast != null && absLast < 0 ? '#dc2626' : '#16a34a'};">
      <span class="hist-kpi-label">Absorción neta</span>
      <span class="hist-kpi-value">${absLast != null ? (absLast >= 0 ? '+' : '') + Math.round(absLast).toLocaleString('es-CL') : '—'}</span>
      <span class="hist-kpi-sub">Unidades · ${prev ?? '—'} → ${last}</span>
    </div>
    <div class="hist-kpi-card" style="--hist-kpi-accent:#059669;">
      <span class="hist-kpi-label">Proyectos</span>
      <span class="hist-kpi-value">${proyectos}</span>
      <span class="hist-kpi-sub">En la consulta actual</span>
    </div>
    <div class="hist-kpi-card" style="--hist-kpi-accent:#6d28d9;">
      <span class="hist-kpi-label">Comunas</span>
      <span class="hist-kpi-value">${comunas}</span>
      <span class="hist-kpi-sub">${periodos.length} períodos de histórico</span>
    </div>
  `;
}

function _render() {
  const rows = _filtered();
  const hasData = rows.length > 0;

  $('histEmpty').style.display     = hasData ? 'none'  : '';
  $('histCharts').style.display    = hasData ? 'flex'  : 'none';
  $('histChartArea').style.display = hasData ? ''      : 'none';
  $('histFiltros').style.display   = hasData ? 'flex'  : 'none';
  $('histKpis').style.display      = hasData ? 'grid'  : 'none';

  if (hasData) { _renderActiveChart(rows); _renderKpis(rows); }
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

function _initListeners() {
  const fontSlider = $('histFontSize');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const val = $('histFontSizeVal');
      if (val) val.textContent = fontSlider.value + 'px';
      _render();
    });
  }
  $('histGridToggle')?.addEventListener('change', _render);
  $('histBarColor')?.addEventListener('input', _render);
  $('histLineColor')?.addEventListener('input', _render);

  document.querySelectorAll('.hist-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const customEl = $('histRatioCustom');
      if (customEl) customEl.value = '';
    });
  });
  $('histRatioCustom')?.addEventListener('input', e => {
    if (e.target.value.trim() !== '') document.querySelectorAll('.hist-ratio-btn').forEach(b => b.classList.remove('active'));
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

  // Botones "Vista" — navegan entre series en el mismo canvas.
  document.querySelectorAll('.hist-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _histMode = btn.dataset.mode;
      _render();
    });
  });

  // Copy button (un solo chart activo)
  $('histCopyBtn')?.addEventListener('click', () =>
    _copyChart(_chart, $('histWrap'), $('histCopyBtn')));

  _initLabelDrag();
}

// Arrastrar las etiquetas de valor (mismo gesto que "mediana" en Proyectos o
// los marcadores en Distribución) — acá se implementa a mano porque estas
// etiquetas se dibujan directo en canvas dentro de nuestros propios plugins,
// no son elementos del plugin annotation. chart._histLabelRects trae las
// cajas del último frame dibujado (con su `key`), así que un click adentro
// de una caja identifica qué etiqueta mover; el offset queda guardado en
// _histLabelOffsets y se reaplica en cada redraw.
function _initLabelDrag() {
  const canvas = $('histChart');
  if (!canvas) return;
  let dragging = null; // { key, startMX, startMY, startDx, startDy }

  const hitTest = (mx, my) => {
    const rects = _chart?._histLabelRects;
    if (!rects) return null;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (r.key && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
  };

  canvas.addEventListener('mousedown', e => {
    const hit = hitTest(e.offsetX, e.offsetY);
    if (!hit) return;
    const off = _labelOffsetFor(_histMode, hit.key);
    dragging = { key: hit.key, startMX: e.offsetX, startMY: e.offsetY, startDx: off.dx, startDy: off.dy };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) {
      const canvasRect = canvas.getBoundingClientRect();
      const inside = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
      if (inside) {
        const hit = hitTest(e.clientX - canvasRect.left, e.clientY - canvasRect.top);
        canvas.style.cursor = hit ? 'grab' : '';
      }
      return;
    }
    if (!_chart) return;
    const canvasRect = canvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left, my = e.clientY - canvasRect.top;
    const off = _labelOffsetFor(_histMode, dragging.key);
    off.dx = dragging.startDx + (mx - dragging.startMX);
    off.dy = dragging.startDy + (my - dragging.startMY);
    off.touched = true;
    _chart.draw();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = null;
    canvas.style.cursor = '';
  });
}

// Referencia del último window._mfHistoricoSource ya cargado en _st.rows,
// para no re-procesar (y no perder los filtros que el usuario haya tocado)
// cada vez que se reabre el tab si la consulta activa no cambió.
let _loadedSourceRef = null;

export function renderHistorico() {
  if (!_initialized) {
    _initListeners();
    _initialized = true;
  }
  if (window._mfHistoricoSource !== _loadedSourceRef) {
    _loadedSourceRef = window._mfHistoricoSource;
    _loadFromCurrentQuery();
  } else {
    _render();
  }
}
