import { $, debounce } from './utils.js';

const STORAGE_KEY = 'visor_mp_renta_v1';

// Date.now() puede repetirse si se agregan dos tipologías en el mismo milisegundo
// (ej. doble click), dejando ids duplicados y rompiendo los lookups por id.
let _idCounter = 0;
const _nextId = () => `${Date.now()}_${_idCounter++}`;

// ── Global state ───────────────────────────────────────────────────────────
export const mp = {
  proyecto:    '',
  direccion:   '',
  tipologias:  [], // [{ id, nombre, sup, renta, ufm2 }]
  geocoords:   null, // { lat, lng } — never persisted
  inComp:      false,
  inMapa:      false,
  inDistrib:   false,
  inSvp:       false,
  inProy:      false,
};

let _initialized = false;

// ── Persistence ────────────────────────────────────────────────────────────
function _save() {
  try {
    const { geocoords, ...toSave } = mp; // eslint-disable-line no-unused-vars
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
}

// ── Geocoding ──────────────────────────────────────────────────────────────
async function _geocode(addr) {
  const statusEl = $('#mpGeoStatus');
  if (!addr || addr.trim().length < 5) {
    mp.geocoords = null;
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'mp-geo-status'; }
    document.dispatchEvent(new CustomEvent('mpchange'));
    return;
  }
  if (statusEl) { statusEl.textContent = 'Buscando…'; statusEl.className = 'mp-geo-status mp-geo-searching'; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    mp.geocoords = data.length
      ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      : null;
    if (statusEl) {
      statusEl.textContent  = mp.geocoords ? '✓ Ubicado' : '✗ No encontrado';
      statusEl.className    = 'mp-geo-status ' + (mp.geocoords ? 'mp-geo-ok' : 'mp-geo-err');
    }
  } catch {
    mp.geocoords = null;
    if (statusEl) { statusEl.textContent = '✗ Error de red'; statusEl.className = 'mp-geo-status mp-geo-err'; }
  }
  document.dispatchEvent(new CustomEvent('mpchange'));
}

const _debouncedGeocode = debounce(_geocode, 1200);

// ── Typology card rendering ────────────────────────────────────────────────
function _renderTipos() {
  const container = $('#mpTiposContainer');
  if (!container) return;
  container.innerHTML = '';

  for (const tipo of mp.tipologias) {
    const card = document.createElement('div');
    card.className = 'mp-tipo-card';
    const typeOptions = ['S', '1D', '2D', '3D', '4D'].map(opt =>
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
          <span>Renta UF</span>
          <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—"
            data-id="${tipo.id}" data-metric="renta" value="${tipo.renta ?? ''}" />
        </label>
        <label class="mp-metric-row">
          <span>UF/m²</span>
          <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—"
            data-id="${tipo.id}" data-metric="ufm2" value="${tipo.ufm2 ?? ''}" />
        </label>
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
        if (t) {
          const v = e.target.value.trim();
          t[e.target.dataset.metric] = v === '' ? null : Number(v);
          _save();
        }
      });
    });

    container.appendChild(card);
  }
}

// ── Public init (called once after data loads) ─────────────────────────────
export function initMpPanel() {
  if (_initialized) {
    // On subsequent file loads, just make sure the panel is visible
    $('#miProyectoSection')?.classList.remove('hidden');
    return;
  }
  _initialized = true;
  _load();

  $('#miProyectoSection')?.classList.remove('hidden');

  // Restore field values
  const set = (id, val) => { const el = $(`#${id}`); if (el) el.value = val ?? ''; };
  
  // Soporte por si no has actualizado el HTML aún de mpEdificio a mpProyecto
  set('mpProyecto',  mp.proyecto);
  if (!$('#mpProyecto')) set('mpEdificio', mp.proyecto); 
  
  set('mpDireccion', mp.direccion);
  if ($('#mpInComp'))    $('#mpInComp').checked    = mp.inComp;
  if ($('#mpInMapa'))    $('#mpInMapa').checked    = mp.inMapa;
  if ($('#mpInDistrib')) $('#mpInDistrib').checked = mp.inDistrib;
  if ($('#mpInSvp'))     $('#mpInSvp').checked     = mp.inSvp;
  if ($('#mpInProy'))    $('#mpInProy').checked    = mp.inProy;

  // Trigger geocoding if address is already saved
  if (mp.direccion) _geocode(mp.direccion);

  // Collapse toggle
  $('#mpPanelHeader')?.addEventListener('click', () => {
    const body    = $('#mpPanelBody');
    const chevron = $('#mpChevron');
    body?.classList.toggle('mp-collapsed');
    if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
  });

  // Field bindings
  const inputProy = $('#mpProyecto') || $('#mpEdificio');
  inputProy?.addEventListener('input', e => { mp.proyecto = e.target.value; _save(); });
  
  $('#mpDireccion')?.addEventListener('input', e => {
    mp.direccion = e.target.value;
    _save();
    _debouncedGeocode(mp.direccion);
  });

  $('#mpInComp')?.addEventListener('change',    e => { mp.inComp    = e.target.checked; _save(); });
  $('#mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _save(); });
  $('#mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _save(); });
  $('#mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _save(); });
  $('#mpInProy')?.addEventListener('change',    e => { mp.inProy    = e.target.checked; _save(); });

  $('#mpAddTipo')?.addEventListener('click', () => {
    mp.tipologias.push({ id: _nextId(), nombre: '', sup: null, renta: null, ufm2: null });
    _renderTipos();
    _save();
  });

  _renderTipos();
}