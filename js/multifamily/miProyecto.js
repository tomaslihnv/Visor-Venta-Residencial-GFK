import { debounce } from '../core/utils.js';

const STORAGE_KEY = 'visor_mp_mf_v1';
const TIPO_OPTIONS = ['ESTUDIO', '1D1B', '2D1B', '2D2B'];

// Date.now() puede repetirse si se agregan dos tipologías en el mismo milisegundo
// (ej. doble click), dejando ids duplicados y rompiendo los lookups por id.
let _idCounter = 0;
const _nextId = () => `${Date.now()}_${_idCounter++}`;

// Multifamily Mi Proyecto — un edificio, con unidades por tipología
export const mp = {
  proyecto:  '',
  direccion: '',
  geocoords: null,
  // Métricas del edificio (a nivel de edificio completo)
  stock:    null,
  vacancia: null,
  // Unidades por tipología: [{ id, nombre, sup, ufm2, renta }]
  // renta se calcula automáticamente como sup * ufm2.
  tipologias: [],
  // Incluir en
  inComp:   false,
  inMapa:   false,
  inDistrib: false,
  inSvp:    false,
  inCruz:   false,
  inProy:   false,
};

let _initialized = false;

function _save() {
  try {
    const { geocoords, ...toSave } = mp;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
  document.dispatchEvent(new CustomEvent('mpchange'));
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(mp, JSON.parse(raw));
  } catch {}
  mp.geocoords = null;
  mp.tipologias ??= [];
}

async function _geocode(addr) {
  const statusEl = document.getElementById('mpGeoStatus');
  if (!addr || addr.trim().length < 5) {
    mp.geocoords = null;
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'mp-geo-status'; }
    document.dispatchEvent(new CustomEvent('mpchange'));
    return;
  }
  if (statusEl) { statusEl.textContent = 'Buscando…'; statusEl.className = 'mp-geo-status mp-geo-searching'; }
  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    mp.geocoords = data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
    if (statusEl) {
      statusEl.textContent = mp.geocoords ? '✓ Ubicado' : '✗ No encontrado';
      statusEl.className   = 'mp-geo-status ' + (mp.geocoords ? 'mp-geo-ok' : 'mp-geo-err');
    }
  } catch {
    mp.geocoords = null;
    if (statusEl) { statusEl.textContent = '✗ Error de red'; statusEl.className = 'mp-geo-status mp-geo-err'; }
  }
  document.dispatchEvent(new CustomEvent('mpchange'));
}

const _debouncedGeocode = debounce(_geocode, 1200);

function _fmtRenta(t) {
  return t.sup != null && t.ufm2 != null
    ? (t.sup * t.ufm2).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—';
}

// ── Tarjetas de tipología ───────────────────────────────────────────────────
function _renderTipos() {
  const container = document.getElementById('mpTiposContainer');
  if (!container) return;
  container.innerHTML = '';

  for (const tipo of mp.tipologias) {
    const card = document.createElement('div');
    card.className = 'mp-tipo-card';
    const typeOptions = TIPO_OPTIONS.map(opt =>
      `<option value="${opt}"${tipo.nombre === opt ? ' selected' : ''}>${opt}</option>`
    ).join('');
    card.innerHTML = `
      <button class="mp-remove-tipo" data-id="${tipo.id}" title="Eliminar">×</button>
      <div class="mp-tipo-metrics">
        <div class="mp-metric-row">
          <span>Tipología</span>
          <select class="mp-tipo-name mp-tipo-select mp-input">
            <option value="">—</option>
            ${typeOptions}
          </select>
        </div>
        <label class="mp-metric-row">
          <span>Útil m²</span>
          <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—"
            data-id="${tipo.id}" data-metric="sup" value="${tipo.sup ?? ''}" />
        </label>
        <label class="mp-metric-row">
          <span>UF/m²</span>
          <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—"
            data-id="${tipo.id}" data-metric="ufm2" value="${tipo.ufm2 ?? ''}" />
        </label>
        <div class="mp-metric-row">
          <span>Renta UF</span>
          <span class="mp-metric-computed">${_fmtRenta(tipo)}</span>
        </div>
      </div>`;

    card.querySelector('.mp-tipo-name').addEventListener('change', e => {
      const t = mp.tipologias.find(t => t.id === tipo.id);
      if (t) { t.nombre = e.target.value; _save(); }
    });

    card.querySelector('.mp-remove-tipo').addEventListener('click', () => {
      mp.tipologias = mp.tipologias.filter(t => t.id !== tipo.id);
      _renderTipos();
      _save();
    });

    card.querySelectorAll('.mp-metric-input').forEach(input => {
      input.addEventListener('input', e => {
        const t = mp.tipologias.find(t => t.id === tipo.id);
        if (!t) return;
        const v = e.target.value.trim();
        t[e.target.dataset.metric] = v === '' ? null : Number(v);
        t.renta = t.sup != null && t.ufm2 != null ? t.sup * t.ufm2 : null;
        const computedEl = card.querySelector('.mp-metric-computed');
        if (computedEl) computedEl.textContent = _fmtRenta(t);
        _save();
      });
    });

    container.appendChild(card);
  }
}

// ── Unidades tipo import/export ─────────────────────────────────────────────
export function getTiposState() {
  return { proyecto: mp.proyecto, tipologias: mp.tipologias };
}

export function applyTiposState(tipologias) {
  // Regenerar ids: evita colisiones con las tipologías ya cargadas en el panel.
  mp.tipologias = (tipologias ?? []).map(t => ({ ...t, id: _nextId() }));
  _renderTipos();
  _save();
}

// ── Public init (called once after data loads) ─────────────────────────────
export function initMpPanel() {
  if (_initialized) {
    document.getElementById('miProyectoSection')?.classList.remove('hidden');
    return;
  }
  _initialized = true;
  _load();

  document.getElementById('miProyectoSection')?.classList.remove('hidden');

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };
  set('mpEdificio',  mp.proyecto);
  set('mpDireccion', mp.direccion);
  set('mpStock',     mp.stock ?? '');
  set('mpVacancia',  mp.vacancia ?? '');

  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('mpInComp',    mp.inComp);
  setChk('mpInMapa',    mp.inMapa);
  setChk('mpInDistrib', mp.inDistrib);
  setChk('mpInSvp',     mp.inSvp);
  setChk('mpInCruz',    mp.inCruz);
  setChk('mpInProy',    mp.inProy);

  if (mp.direccion) _geocode(mp.direccion);

  document.getElementById('mpPanelHeader')?.addEventListener('click', () => {
    const body    = document.getElementById('mpPanelBody');
    const chevron = document.getElementById('mpChevron');
    body?.classList.toggle('mp-collapsed');
    if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
  });

  document.getElementById('mpEdificio')?.addEventListener('input', e => { mp.proyecto = e.target.value; _save(); });
  document.getElementById('mpDireccion')?.addEventListener('input', e => {
    mp.direccion = e.target.value; _save(); _debouncedGeocode(mp.direccion);
  });

  // Metric inputs
  const numInput = (id, field) => {
    document.getElementById(id)?.addEventListener('input', e => {
      const v = e.target.value.trim();
      mp[field] = v === '' ? null : Number(v);
      _save();
    });
  };
  numInput('mpStock',    'stock');
  numInput('mpVacancia', 'vacancia');

  document.getElementById('mpInComp')?.addEventListener('change',    e => { mp.inComp    = e.target.checked; _save(); });
  document.getElementById('mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _save(); });
  document.getElementById('mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _save(); });
  document.getElementById('mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _save(); });
  document.getElementById('mpInCruz')?.addEventListener('change',    e => { mp.inCruz    = e.target.checked; _save(); });
  document.getElementById('mpInProy')?.addEventListener('change',    e => { mp.inProy    = e.target.checked; _save(); });

  document.getElementById('mpAddTipo')?.addEventListener('click', () => {
    mp.tipologias.push({ id: _nextId(), nombre: '', sup: null, ufm2: null, renta: null });
    _renderTipos();
    _save();
  });

  _renderTipos();
}
