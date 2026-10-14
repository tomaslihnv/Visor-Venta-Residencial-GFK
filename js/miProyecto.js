import { $ } from './utils.js';
import { initMyProjects } from '../shared/myProjects.js';
import { initMyProjectsModal } from '../shared/myProjectsModal.js';

const SELECTED_ID_KEY = 'visor_mp_selected_id_v1';
const TOGGLES_KEY     = 'visor_mp_toggles_v1';

const MyProjects      = initMyProjects();
const MyProjectsModal = initMyProjectsModal();

// ── Global state ───────────────────────────────────────────────────────────
// Mismo contrato que antes (edificio, propietario, direccion, tipologias,
// geocoords, inComp/inMapa/inDistrib/inSvp/inProy) para no tener que tocar
// comparativa.js / map.js / chart.js, que ya leen `mp` por referencia. Lo
// único que cambia es CÓMO se llena: antes venía de inputs editables acá
// mismo, ahora viene de un proyecto elegido en el modal compartido
// (shared/myProjectsModal.js), respaldado en Firestore (shared/myProjects.js).
export const mp = {
  edificio:    '',
  propietario: '', // no viene de Firestore — reservado por si algún consumidor lo usa
  direccion:   '',
  tipologias:  [], // [{ id, nombre, sup, ufm2, cantidad, arriendoUfM2Mes }]
  geocoords:   null, // { lat, lng } — nunca persistido, se recalcula al seleccionar
  inComp:      false,
  inMapa:      false,
  inDistrib:   false,
  inSvp:       false,
  inProy:      false,
};

let _selectedId = null;
// Usado por Filtros Guardados para saber a qué proyecto atar el filtro
// (relación 1:N, un proyecto tiene muchos filtros guardados).
export function getSelectedProjectId() { return _selectedId; }
let _initialized = false;

// ── Toggles "incluir en" — preferencia LOCAL del navegador, independiente
// del proyecto elegido (si fueran parte del documento compartido, dos
// personas viendo el mismo proyecto en pestañas distintas pelearían por
// ese estado) ────────────────────────────────────────────────────────────
function _saveToggles() {
  try {
    localStorage.setItem(TOGGLES_KEY, JSON.stringify({
      inComp: mp.inComp, inMapa: mp.inMapa, inDistrib: mp.inDistrib, inSvp: mp.inSvp, inProy: mp.inProy,
    }));
  } catch {}
}

function _loadToggles() {
  try {
    const raw = localStorage.getItem(TOGGLES_KEY);
    if (raw) Object.assign(mp, JSON.parse(raw));
  } catch {}
}

function _notifyChange() {
  document.dispatchEvent(new CustomEvent('mpchange'));
}

// ── Geocoding ──────────────────────────────────────────────────────────────
async function _geocode(addr) {
  const statusEl = $('#mpGeoStatus');
  if (!addr || addr.trim().length < 5) {
    mp.geocoords = null;
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'mp-geo-status'; }
    _notifyChange();
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
  _notifyChange();
}

// Convención de Venta: 'S' para Estudio, '1D'/'2D'/'3D'/'4D' para el resto
// (los baños no se usan acá, Venta nunca los trackeó por tipología).
function _tipoNombreVenta(t) {
  if (t.dormitorios === 'Estudio') return 'S';
  return t.dormitorios ? `${t.dormitorios}D` : '';
}

// ── Selección de proyecto ────────────────────────────────────────────────
function _applyProject(project) {
  mp.edificio    = project?.nombre ?? '';
  mp.direccion   = project?.direccion ?? '';
  mp.tipologias  = (project?.tipologias ?? []).map(t => ({
    id: t.id, nombre: _tipoNombreVenta(t), sup: t.sup ?? null, ufm2: t.ufm2 ?? null,
    cantidad: t.cantidad ?? null, arriendoUfM2Mes: t.arriendoUfM2Mes ?? null,
  }));
  mp.geocoords = null; // se recalcula abajo
}

function _renderSelector() {
  const noneHint = $('#mpNoneHint');
  const info     = $('#mpSelectedInfo');
  const nombreEl = $('#mpSelectedNombre');
  const direccionEl = $('#mpSelectedDireccion');
  const removeBtn = $('#mpRemoveBtn');
  const editBtn   = $('#mpEditBtn');
  const includes  = $('#mpIncludes');

  const hasProject = !!mp.edificio;
  if (noneHint) noneHint.classList.toggle('hidden', hasProject);
  if (info)     info.classList.toggle('hidden', !hasProject);
  if (removeBtn) removeBtn.classList.toggle('hidden', !hasProject);
  if (editBtn)   editBtn.classList.toggle('hidden', !hasProject || !MyProjects.canEdit(MyProjects.getProject(_selectedId)));
  if (includes) includes.classList.toggle('hidden', !hasProject);
  if (nombreEl) nombreEl.textContent = mp.edificio;
  if (direccionEl) direccionEl.textContent = mp.direccion || 'Sin dirección';
}

function _selectProject(project) {
  _selectedId = project.id;
  try { localStorage.setItem(SELECTED_ID_KEY, _selectedId); } catch {}
  _applyProject(project);
  _renderSelector();
  if (mp.direccion) _geocode(mp.direccion);
  else _notifyChange();
}

function _removeProject() {
  _selectedId = null;
  try { localStorage.removeItem(SELECTED_ID_KEY); } catch {}
  mp.edificio = ''; mp.direccion = ''; mp.tipologias = []; mp.geocoords = null;
  _renderSelector();
  _notifyChange();
}

// ── Public init (called once after data loads) ─────────────────────────────
export function initMpPanel() {
  if (_initialized) {
    $('#miProyectoSection')?.classList.remove('hidden');
    return;
  }
  _initialized = true;
  _loadToggles();

  $('#miProyectoSection')?.classList.remove('hidden');
  if ($('#mpInComp'))    $('#mpInComp').checked    = mp.inComp;
  if ($('#mpInMapa'))    $('#mpInMapa').checked    = mp.inMapa;
  if ($('#mpInDistrib')) $('#mpInDistrib').checked = mp.inDistrib;
  if ($('#mpInSvp'))     $('#mpInSvp').checked     = mp.inSvp;
  if ($('#mpInProy'))    $('#mpInProy').checked    = mp.inProy;

  $('#mpInComp')?.addEventListener('change',    e => { mp.inComp    = e.target.checked; _saveToggles(); _notifyChange(); });
  $('#mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _saveToggles(); _notifyChange(); });
  $('#mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _saveToggles(); _notifyChange(); });
  $('#mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _saveToggles(); _notifyChange(); });
  $('#mpInProy')?.addEventListener('change',    e => { mp.inProy    = e.target.checked; _saveToggles(); _notifyChange(); });

  $('#mpOpenModalBtn')?.addEventListener('click', () => {
    MyProjectsModal.open({ onSelect: _selectProject });
  });
  $('#mpEditBtn')?.addEventListener('click', () => {
    if (!_selectedId) return;
    MyProjectsModal.open({ onSelect: _selectProject, editProjectId: _selectedId });
  });

  // Collapse toggle del panel
  $('#mpPanelHeader')?.addEventListener('click', () => {
    const body    = $('#mpPanelBody');
    const chevron = $('#mpChevron');
    body?.classList.toggle('mp-collapsed');
    if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
  });
  $('#mpRemoveBtn')?.addEventListener('click', _removeProject);

  // Restaurar el proyecto elegido la última vez, apenas Firestore lo traiga.
  try { _selectedId = localStorage.getItem(SELECTED_ID_KEY); } catch { _selectedId = null; }
  if (_selectedId) {
    MyProjects.onChange(() => {
      if (!_selectedId) return;
      const project = MyProjects.getProject(_selectedId);
      if (project && !mp.edificio) {
        _applyProject(project);
        _renderSelector();
        if (mp.direccion) _geocode(mp.direccion);
      }
    });
  }

  _renderSelector();
}
