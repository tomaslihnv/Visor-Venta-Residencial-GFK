import { debounce } from '../core/utils.js';

const STORAGE_KEY = 'visor_mp_bd_v1';

export const mp = {
  proyecto:   '',
  direccion:  '',
  geocoords:  null,
  util:       null,
  ufm2:       null,
  tipologias: [],
  inMapa:     false,
  inSvp:      false,
  inDistrib:  false,
};

let _initialized = false;

function _syncTipologias() {
  mp.tipologias = [{
    id:     'mp_bd',
    nombre: mp.proyecto || 'Mi Proyecto',
    sup:    mp.util,
    ufm2:   mp.ufm2,
    renta:  mp.ufm2 != null && mp.util != null ? mp.ufm2 * mp.util : null,
  }];
}

function _save() {
  try {
    const { geocoords, tipologias, ...toSave } = mp;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
  _syncTipologias();
  document.dispatchEvent(new CustomEvent('mpchange'));
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(mp, JSON.parse(raw));
  } catch {}
  mp.geocoords  = null;
  mp.tipologias = [];
  _syncTipologias();
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

// ── Unidades tipo import/export ─────────────────────────────────────────────
// Bodegas es un visor "flat" (una sola métrica por proyecto, no tarjetas de
// tipología). Exportamos/importamos igual mp.tipologias (síntesis automática
// vía _syncTipologias) para reusar el mismo formato de archivo que el resto.
export function getTiposState() {
  return { proyecto: mp.proyecto, tipologias: mp.tipologias };
}

export function applyTiposState(tipologias) {
  const t = (tipologias ?? [])[0] ?? null;
  mp.util = t?.sup  ?? null;
  mp.ufm2 = t?.ufm2 ?? null;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('mpUtil', mp.util);
  set('mpUfm2', mp.ufm2);

  _save();
}

export function initMpPanel() {
  if (_initialized) {
    document.getElementById('miProyectoSection')?.classList.remove('hidden');
    return;
  }
  _initialized = true;
  _load();

  document.getElementById('miProyectoSection')?.classList.remove('hidden');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('mpNombre',    mp.proyecto);
  set('mpDireccion', mp.direccion);
  set('mpUtil',      mp.util ?? '');
  set('mpUfm2',      mp.ufm2 ?? '');

  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('mpInMapa',    mp.inMapa);
  setChk('mpInSvp',     mp.inSvp);
  setChk('mpInDistrib', mp.inDistrib);

  if (mp.direccion) _geocode(mp.direccion);

  document.getElementById('mpPanelHeader')?.addEventListener('click', () => {
    const body    = document.getElementById('mpPanelBody');
    const chevron = document.getElementById('mpChevron');
    body?.classList.toggle('mp-collapsed');
    if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
  });

  document.getElementById('mpNombre')?.addEventListener('input',    e => { mp.proyecto  = e.target.value; _save(); });
  document.getElementById('mpDireccion')?.addEventListener('input', e => { mp.direccion = e.target.value; _save(); _debouncedGeocode(mp.direccion); });

  const numInput = (id, field) => {
    document.getElementById(id)?.addEventListener('input', e => {
      const v = e.target.value.trim();
      mp[field] = v === '' ? null : Number(v);
      _save();
    });
  };
  numInput('mpUtil', 'util');
  numInput('mpUfm2', 'ufm2');

  document.getElementById('mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _save(); });
  document.getElementById('mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _save(); });
  document.getElementById('mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _save(); });
}
