import { debounce } from '../core/utils.js';

const STORAGE_KEY = 'visor_mp_mf_v1';

// Multifamily Mi Proyecto — un edificio, sin tipologías
export const mp = {
  proyecto:  '',
  direccion: '',
  geocoords: null,
  // Métricas del edificio propio
  stock:    null,
  vacancia: null,
  arriendo: null,
  ufm2:     null,
  // Incluir en
  inComp:   false,
  inMapa:   false,
  inDistrib: false,
  inSvp:    false,
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
  set('mpArriendo',  mp.arriendo ?? '');
  set('mpUfm2',      mp.ufm2 ?? '');

  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('mpInComp',    mp.inComp);
  setChk('mpInMapa',    mp.inMapa);
  setChk('mpInDistrib', mp.inDistrib);
  setChk('mpInSvp',     mp.inSvp);
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
  numInput('mpArriendo', 'arriendo');
  numInput('mpUfm2',     'ufm2');

  document.getElementById('mpInComp')?.addEventListener('change',    e => { mp.inComp    = e.target.checked; _save(); });
  document.getElementById('mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _save(); });
  document.getElementById('mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _save(); });
  document.getElementById('mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _save(); });
  document.getElementById('mpInProy')?.addEventListener('change',    e => { mp.inProy    = e.target.checked; _save(); });
}
