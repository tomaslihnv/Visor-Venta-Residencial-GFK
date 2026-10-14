// ── Modal compartido "Filtros guardados" ────────────────────────────────────
// Lista + cargar + actualizar + eliminar sobre la colección Firestore
// 'savedFilters' (ver shared/savedFilters.js). Más simple que el modal de
// Mi Proyecto: un filtro guardado es una foto del sidebar de filtros, no
// algo con vista de edición propia — "editarlo" es sobrescribir esa foto
// con el estado actual del sidebar (botón "Actualizar").
//
// Uso:
//   import { initSavedFiltersModal } from '../shared/savedFiltersModal.js';
//   const SavedFiltersModal = initSavedFiltersModal();
//   SavedFiltersModal.open({ projectId, visorId, getState, applyState });

import { initSavedFilters } from './savedFilters.js';

const SavedFilters = initSavedFilters();

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString('es-CL') : '';
}

let _instance = null;

export function initSavedFiltersModal() {
  if (_instance) return _instance;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="sfModalOverlay" class="hidden" style="position:fixed; inset:0; z-index:2100; background:rgba(15,23,42,0.45); display:flex; align-items:center; justify-content:center;">
      <div style="width:min(640px,94%); max-height:85vh; display:flex; flex-direction:column; background:#fff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); overflow:hidden;">
        <div class="rq-header" style="padding:16px 20px; border-bottom:1px solid #e5e7eb;">
          <h2>Filtros guardados</h2>
          <div class="rq-header-actions">
            <button type="button" id="sfCloseBtn" class="area-btn cancel">Cerrar</button>
          </div>
        </div>
        <div style="padding:16px 20px; overflow-y:auto; max-height:calc(85vh - 66px);">
          <div id="sfGrid" class="rq-grid"></div>
        </div>
      </div>
    </div>
  `);

  const overlay = document.getElementById('sfModalOverlay');
  const grid    = document.getElementById('sfGrid');

  let _projectId = null;
  let _visorId   = null;
  let _getState   = null;
  let _applyState = null;

  function _render() {
    const filtros = SavedFilters.getFiltersForProject(_projectId, _visorId);

    if (!filtros.length) {
      grid.innerHTML = '<p class="hint">Sin filtros guardados todavía para este proyecto.</p>';
      return;
    }

    grid.innerHTML = filtros.map(f => {
      const mine = SavedFilters.isOwner(f);
      const ownerTag = mine ? '' : ` · de ${_esc(f.ownerName || f.ownerEmail || 'otro usuario')}`;
      const fecha = _fmtDate(f.createdAt);
      return `
        <div class="rq-card" data-id="${f.id}">
          <h3>${_esc(f.nombre)}</h3>
          <p class="rq-card-meta">${fecha ? `Guardado ${fecha}` : ''}${ownerTag}</p>
          <div class="rq-card-actions">
            <button type="button" class="area-btn primary sf-btn-load">Cargar</button>
            ${mine ? '<button type="button" class="area-btn sf-btn-update">Actualizar</button>' : ''}
            ${mine ? '<button type="button" class="area-btn cancel sf-btn-delete">Eliminar</button>' : ''}
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.rq-card').forEach(card => {
      const id = card.dataset.id;
      const f = filtros.find(x => x.id === id);
      if (!f) return;
      card.querySelector('.sf-btn-load')?.addEventListener('click', () => {
        _applyState(f.filters);
        close();
      });
      card.querySelector('.sf-btn-update')?.addEventListener('click', async () => {
        if (!confirm(`¿Sobrescribir "${f.nombre}" con los filtros actuales del sidebar?`)) return;
        try { await SavedFilters.updateFilter(id, { filters: _getState() }); } catch (err) { alert(err.message); }
      });
      card.querySelector('.sf-btn-delete')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el filtro "${f.nombre}"?`)) return;
        try { await SavedFilters.deleteFilter(id); } catch (err) { alert(err.message); }
      });
    });
  }

  SavedFilters.onChange(() => {
    if (overlay && !overlay.classList.contains('hidden')) _render();
  });

  document.getElementById('sfCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function open({ projectId, visorId, getState, applyState }) {
    _projectId  = projectId;
    _visorId    = visorId;
    _getState   = getState;
    _applyState = applyState;
    overlay.classList.remove('hidden');
    _render();
  }

  function close() {
    overlay.classList.add('hidden');
  }

  _instance = { open, close };
  return _instance;
}
