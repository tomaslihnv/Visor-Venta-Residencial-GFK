import { $ } from '../core/utils.js';
import { initMyProjects } from '../../shared/myProjects.js';
import { initMyProjectsModal } from '../../shared/myProjectsModal.js';

const SELECTED_ID_KEY = 'visor_mp_mf_selected_id_v1';
const LOCAL_KEY        = 'visor_mp_mf_local_v1'; // toggles + vacancia — preferencia local, no viaja en el proyecto compartido

const MyProjects      = initMyProjects();
const MyProjectsModal = initMyProjectsModal();

// Multifamily Mi Proyecto — mismo contrato que antes (proyecto, direccion,
// geocoords, stock, vacancia, tipologias[], inComp/inMapa/inDistrib/inSvp/
// inCruz/inProy) para no tocar los módulos core/ que ya leen `mp` por
// parámetro (core/comparativa.js, core/chart-cruz.js, core/map.js,
// core/chart-proyectos.js, core/chart-svp.js, core/chart-distrib.js). Lo
// que cambia es CÓMO se llena: antes venía de inputs editables acá mismo,
// ahora viene de un proyecto elegido en el modal compartido
// (shared/myProjectsModal.js), respaldado en Firestore.
//
// Multifamily es un mercado de RENTA, no de venta — el campo 'ufm2' de acá
// representa renta UF/m²/mes (viene de arriendoUfM2Mes del proyecto
// compartido), y 'renta' es el total mensual calculado (sup * ufm2), igual
// que ya hacía este archivo antes de la migración.
export const mp = {
  proyecto:  '',
  direccion: '',
  geocoords: null,
  // Métricas del edificio — stock se deriva de la suma de unidades por
  // tipología; vacancia queda como dato LOCAL (ver _local más abajo) porque
  // es una foto del momento, no parte de la definición del proyecto.
  stock:    null,
  vacancia: null,
  tipologias: [], // [{ id, nombre, sup, ufm2, renta, unidades }]
  inComp:   false,
  inMapa:   false,
  inDistrib: false,
  inSvp:    false,
  inCruz:   false,
  inProy:   false,
};

let _selectedId = null;
// Usado por Filtros Guardados para saber a qué proyecto atar el filtro
// (relación 1:N, un proyecto tiene muchos filtros guardados).
export function getSelectedProjectId() { return _selectedId; }
let _initialized = false;

function _saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      vacancia: mp.vacancia,
      inComp: mp.inComp, inMapa: mp.inMapa, inDistrib: mp.inDistrib,
      inSvp: mp.inSvp, inCruz: mp.inCruz, inProy: mp.inProy,
    }));
  } catch {}
}

function _loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
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
  _notifyChange();
}

// Convención de Multifamily: 'ESTUDIO' o '{dormitorios}D{banos}B' (ej: '2D2B').
function _tipoNombreMultifamily(t) {
  if (t.dormitorios === 'Estudio') return 'ESTUDIO';
  if (!t.dormitorios) return '';
  return `${t.dormitorios}D${t.banos ?? '1'}B`;
}

// ── Selección de proyecto ────────────────────────────────────────────────
function _applyProject(project) {
  mp.proyecto  = project?.nombre ?? '';
  mp.direccion = project?.direccion ?? '';
  mp.tipologias = (project?.tipologias ?? []).map(t => ({
    id: t.id, nombre: _tipoNombreMultifamily(t), sup: t.sup ?? null,
    ufm2:  t.arriendoUfM2Mes ?? null, // renta UF/m²/mes en este visor
    renta: (t.sup != null && t.arriendoUfM2Mes != null) ? t.sup * t.arriendoUfM2Mes : null,
    unidades: t.cantidad ?? null,
  }));
  mp.stock = mp.tipologias.length
    ? mp.tipologias.reduce((s, t) => s + (Number(t.unidades) || 0), 0) || null
    : null;
  mp.geocoords = null; // se recalcula abajo
}

function _renderSelector() {
  const noneHint    = $('#mpNoneHint');
  const info        = $('#mpSelectedInfo');
  const nombreEl    = $('#mpSelectedNombre');
  const direccionEl = $('#mpSelectedDireccion');
  const removeBtn   = $('#mpRemoveBtn');
  const editBtn     = $('#mpEditBtn');
  const extras      = $('#mpExtras');

  const hasProject = !!mp.proyecto;
  if (noneHint)  noneHint.classList.toggle('hidden', hasProject);
  if (info)      info.classList.toggle('hidden', !hasProject);
  if (removeBtn) removeBtn.classList.toggle('hidden', !hasProject);
  if (editBtn)   editBtn.classList.toggle('hidden', !hasProject || !MyProjects.canEdit(MyProjects.getProject(_selectedId)));
  if (extras)    extras.classList.toggle('hidden', !hasProject);
  if (nombreEl)    nombreEl.textContent = mp.proyecto;
  if (direccionEl) direccionEl.textContent = mp.direccion || 'Sin dirección';

  const stockEl = $('#mpStockValue');
  if (stockEl) stockEl.textContent = mp.stock != null ? mp.stock.toLocaleString('es-CL') : '—';
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
  mp.proyecto = ''; mp.direccion = ''; mp.tipologias = []; mp.stock = null; mp.geocoords = null;
  _renderSelector();
  _notifyChange();
}

// ── Public init ──────────────────────────────────────────────────────────
// Nota: main.js llama esto de forma eager al cargar el módulo (no espera a
// que haya datos) — initMpPanel() ya era idempotente-safe para eso (no
// depende de que haya datos cargados), se mantiene igual.
export function initMpPanel() {
  if (_initialized) {
    $('#miProyectoSection')?.classList.remove('hidden');
    return;
  }
  _initialized = true;
  _loadLocal();

  $('#miProyectoSection')?.classList.remove('hidden');

  if ($('#mpVacancia')) $('#mpVacancia').value = mp.vacancia ?? '';
  if ($('#mpInComp'))    $('#mpInComp').checked    = mp.inComp;
  if ($('#mpInMapa'))    $('#mpInMapa').checked    = mp.inMapa;
  if ($('#mpInDistrib')) $('#mpInDistrib').checked = mp.inDistrib;
  if ($('#mpInSvp'))     $('#mpInSvp').checked     = mp.inSvp;
  if ($('#mpInCruz'))    $('#mpInCruz').checked    = mp.inCruz;
  if ($('#mpInProy'))    $('#mpInProy').checked    = mp.inProy;

  $('#mpVacancia')?.addEventListener('input', e => {
    const v = e.target.value.trim();
    mp.vacancia = v === '' ? null : Number(v);
    _saveLocal();
    _notifyChange();
  });

  $('#mpInComp')?.addEventListener('change',    e => { mp.inComp    = e.target.checked; _saveLocal(); _notifyChange(); });
  $('#mpInMapa')?.addEventListener('change',    e => { mp.inMapa    = e.target.checked; _saveLocal(); _notifyChange(); });
  $('#mpInDistrib')?.addEventListener('change', e => { mp.inDistrib = e.target.checked; _saveLocal(); _notifyChange(); });
  $('#mpInSvp')?.addEventListener('change',     e => { mp.inSvp     = e.target.checked; _saveLocal(); _notifyChange(); });
  $('#mpInCruz')?.addEventListener('change',    e => { mp.inCruz    = e.target.checked; _saveLocal(); _notifyChange(); });
  $('#mpInProy')?.addEventListener('change',    e => { mp.inProy    = e.target.checked; _saveLocal(); _notifyChange(); });

  $('#mpOpenModalBtn')?.addEventListener('click', () => {
    MyProjectsModal.open({ onSelect: _selectProject });
  });
  $('#mpEditBtn')?.addEventListener('click', () => {
    if (!_selectedId) return;
    MyProjectsModal.open({ onSelect: _selectProject, editProjectId: _selectedId });
  });
  $('#mpRemoveBtn')?.addEventListener('click', _removeProject);

  $('#mpPanelHeader')?.addEventListener('click', () => {
    const body    = $('#mpPanelBody');
    const chevron = $('#mpChevron');
    body?.classList.toggle('mp-collapsed');
    if (chevron) chevron.textContent = body?.classList.contains('mp-collapsed') ? '▸' : '▾';
  });

  // Restaurar el proyecto elegido la última vez, apenas Firestore lo traiga.
  try { _selectedId = localStorage.getItem(SELECTED_ID_KEY); } catch { _selectedId = null; }
  if (_selectedId) {
    MyProjects.onChange(() => {
      if (!_selectedId) return;
      const project = MyProjects.getProject(_selectedId);
      if (project && !mp.proyecto) {
        _applyProject(project);
        _renderSelector();
        if (mp.direccion) _geocode(mp.direccion);
      }
    });
  }

  _renderSelector();
}
