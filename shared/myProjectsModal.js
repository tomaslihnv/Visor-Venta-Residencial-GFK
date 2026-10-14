// ── Modal compartido "Mis Proyectos" ────────────────────────────────────────
// CRUD puro sobre la colección Firestore 'myProjects' (ver shared/myProjects.js).
// A diferencia de Consultas Recurrentes (cuya UI vive duplicada en el main.js
// de cada visor porque cada uno tiene su propia lógica de dibujo de mapa),
// este modal no tiene nada visor-específico — se construye UNA sola vez acá
// y se inyecta en document.body, así que cualquier visor lo usa con:
//
//   import { initMyProjectsModal } from '../shared/myProjectsModal.js';
//   const MyProjectsModal = initMyProjectsModal();
//   MyProjectsModal.open({ onSelect: (project) => { ... } });
//
// Reutiliza las clases visuales que ya existen para Consultas Recurrentes
// (.rq-grid/.rq-card/...) y para las tarjetas de tipología de Mi Proyecto
// (.mp-tipo-card/.mp-metric-row/...) — mismo lenguaje visual, sin CSS nuevo
// para eso.

import { initMyProjects } from './myProjects.js';
import { getUser } from './auth.js';

const MyProjects = initMyProjects();

const TIPO_OPTIONS = [
  'Venta Residencial', 'Renta Residencial', 'Multifamily', 'Oficinas',
  'Bodegas', 'Parques Industriales', 'Strip Centers', 'Suelos',
];
// Dormitorios y baños se eligen por separado — Estudio no tiene baños
// independientes, así que ese selector se bloquea cuando dormitorios = Estudio.
// Cada visor traduce (dormitorios, banos) a su propia convención de nombre
// (Venta: 'S'/'1D'/'2D'..., Multifamily: 'ESTUDIO'/'1D1B'/'2D2B'...) en su
// propio miProyecto.js — este modal no conoce esas convenciones.
const DORMITORIOS_OPTIONS = ['Estudio', '1', '2', '3', '4', '5'];
const BANOS_OPTIONS = ['1', '2', '3', '4'];

// Migración best-effort de tipologías guardadas ANTES de este cambio (que
// solo tenían un campo 'nombre' de texto libre) — al abrir para editar, se
// intenta inferir dormitorios/baños desde el nombre viejo en vez de dejarlo
// vacío. Si no matchea ningún patrón conocido, queda sin seleccionar.
function _inferDormitoriosBanos(t) {
  if (t.dormitorios !== undefined) return t; // ya está en formato nuevo
  const nombre = String(t.nombre ?? '').trim().toUpperCase();
  if (nombre === 'S' || nombre === 'ESTUDIO') return { ...t, dormitorios: 'Estudio', banos: null };
  const m = /^(\d+)D(\d+)B$/.exec(nombre); // ej: '2D2B'
  if (m) return { ...t, dormitorios: m[1], banos: m[2] };
  const m2 = /^(\d+)D$/.exec(nombre); // ej: '2D' (convención Venta, sin baños)
  if (m2) return { ...t, dormitorios: m2[1], banos: null };
  return { ...t, dormitorios: '', banos: null };
}

let _idCounter = 0;
const _nextId = () => `${Date.now()}_${_idCounter++}`;

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtTicket(t) {
  if (t.sup == null || t.ufm2 == null) return '—';
  const ticket = t.sup * t.ufm2;
  return `${ticket.toLocaleString('es-CL', { maximumFractionDigits: 0 })} UF`;
}

function _fmtRentaTotal(t) {
  if (t.sup == null || t.arriendoUfM2Mes == null) return '—';
  const total = t.sup * t.arriendoUfM2Mes;
  return `${total.toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF/mes`;
}

let _instance = null;

export function initMyProjectsModal() {
  if (_instance) return _instance;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="mypModalOverlay" class="hidden" style="position:fixed; inset:0; z-index:2100; background:rgba(15,23,42,0.45); display:flex; align-items:center; justify-content:center;">
      <div style="width:min(760px,94%); max-height:88vh; display:flex; flex-direction:column; background:#fff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); overflow:hidden;">

        <!-- VISTA LISTA -->
        <div id="mypListView">
          <div class="rq-header" style="padding:16px 20px; border-bottom:1px solid #e5e7eb;">
            <h2>Mis Proyectos</h2>
            <div class="rq-header-actions">
              <button type="button" id="mypAddBtn" class="area-btn primary">+ Nuevo proyecto</button>
              <button type="button" id="mypCloseBtn" class="area-btn cancel">Cerrar</button>
            </div>
          </div>
          <div style="padding:16px 20px; overflow-y:auto; max-height:calc(88vh - 66px);">
            <div id="mypUserFilter" class="rq-user-filter"></div>
            <div id="mypGrid" class="rq-grid"></div>
          </div>
        </div>

        <!-- VISTA FORMULARIO (alta/edición) -->
        <div id="mypFormView" class="hidden">
          <div class="rq-header" style="padding:16px 20px; border-bottom:1px solid #e5e7eb;">
            <h2 id="mypFormTitle">Nuevo proyecto</h2>
            <div class="rq-header-actions">
              <button type="button" id="mypFormSaveBtn" class="area-btn primary">Guardar</button>
              <button type="button" id="mypFormBackBtn" class="area-btn cancel">Volver</button>
            </div>
          </div>
          <div style="padding:16px 20px; overflow-y:auto; max-height:calc(88vh - 66px); display:flex; flex-direction:column; gap:14px;">
            <div class="mp-field">
              <label class="mp-label">Nombre</label>
              <input type="text" id="mypFormNombre" class="mp-input" placeholder="Ej: SITÛ Los Laureles" />
            </div>
            <div class="mp-field">
              <label class="mp-label">Dirección</label>
              <input type="text" id="mypFormDireccion" class="mp-input" placeholder="Calle 123, Comuna, Chile" />
            </div>
            <div class="mp-field">
              <label class="mp-label">Tipo</label>
              <select id="mypFormTipo" class="mp-input">
                <option value="">—</option>
                ${TIPO_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>

            <div class="mp-tipos-header">
              <span class="mp-label">Unidades Tipo</span>
              <button type="button" id="mypAddTipoBtn" class="mp-add-btn">+ Agregar</button>
            </div>
            <div id="mypTiposContainer" class="mp-tipos-container"></div>

            <div id="mypEditorsSection">
              <label class="mp-label">Editores autorizados</label>
              <p class="muted" style="margin:2px 0 8px;">Además de ti, estas personas pueden editar este proyecto (no eliminarlo).</p>
              <div id="mypEditorsChips" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;"></div>
              <div style="display:flex; gap:6px;">
                <input type="email" id="mypEditorEmailInput" class="mp-input" placeholder="correo@situ.cl" style="flex:1;" />
                <button type="button" id="mypEditorAddBtn" class="area-btn">Agregar</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `);

  const overlay      = document.getElementById('mypModalOverlay');
  const listView      = document.getElementById('mypListView');
  const formView       = document.getElementById('mypFormView');
  const grid            = document.getElementById('mypGrid');
  const userFilterBar    = document.getElementById('mypUserFilter');
  const editorsSection     = document.getElementById('mypEditorsSection');
  const editorsChipsEl      = document.getElementById('mypEditorsChips');
  const tiposContainer       = document.getElementById('mypTiposContainer');

  let _onSelect = null;
  let _userFilter = null; // null = todos, 'mine' = solo mías, o un ownerUid
  let _editingId = null;  // null = creando
  let _editingTipologias = [];
  let _editingEmails = [];

  // ── Vista lista ──────────────────────────────────────────────────────────
  function _renderUserFilter(allProjects) {
    if (allProjects.length < 2) { userFilterBar.innerHTML = ''; return; }
    const others = new Map();
    allProjects.forEach(p => {
      if (MyProjects.isOwner(p) || others.has(p.ownerUid)) return;
      others.set(p.ownerUid, p.ownerName || p.ownerEmail || 'Usuario');
    });
    const chips = [
      { key: null,   label: 'Todos' },
      { key: 'mine', label: 'Mías' },
      ...[...others.entries()].map(([uid, name]) => ({ key: uid, label: name })),
    ];
    userFilterBar.innerHTML = chips.map(c =>
      `<button type="button" class="rq-user-filter-btn${_userFilter === c.key ? ' active' : ''}" data-key="${c.key ?? ''}">${_esc(c.label)}</button>`
    ).join('');
    userFilterBar.querySelectorAll('.rq-user-filter-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => { _userFilter = chips[i].key; _renderGrid(); });
    });
  }

  function _renderGrid() {
    const allProjects = MyProjects.getProjects();
    _renderUserFilter(allProjects);

    const projects = allProjects.filter(p => {
      if (_userFilter === null) return true;
      if (_userFilter === 'mine') return MyProjects.isOwner(p);
      return p.ownerUid === _userFilter;
    });

    const addCard = `<button type="button" class="rq-card-add" id="mypAddCard">+ Nuevo proyecto</button>`;

    if (!projects.length) {
      grid.innerHTML = `<p class="hint">${allProjects.length ? 'Sin proyectos para este filtro.' : 'Sin proyectos guardados todavía.'}</p>` + addCard;
      grid.querySelector('#mypAddCard')?.addEventListener('click', () => _openForm(null));
      return;
    }

    grid.innerHTML = projects.map(p => {
      const mine = MyProjects.isOwner(p);
      const canEdit = MyProjects.canEdit(p);
      const ownerTag = mine ? '' : ` · de ${_esc(p.ownerName || p.ownerEmail || 'otro usuario')}`;
      const nTipos = p.tipologias?.length ?? 0;
      return `
        <div class="rq-card" data-id="${p.id}">
          ${p.tipo ? `<span class="rq-card-type">${_esc(p.tipo)}</span>` : ''}
          <h3>${_esc(p.nombre) || '(sin nombre)'}</h3>
          <p class="rq-card-meta">${_esc(p.direccion) || 'Sin dirección'} · ${nTipos} tipología${nTipos === 1 ? '' : 's'}${ownerTag}</p>
          <div class="rq-card-actions">
            <button type="button" class="area-btn primary myp-btn-select">Usar este proyecto</button>
            ${canEdit ? '<button type="button" class="area-btn myp-btn-edit">Editar</button>' : ''}
            ${mine ? '<button type="button" class="area-btn cancel myp-btn-delete">Eliminar</button>' : ''}
          </div>
        </div>`;
    }).join('') + addCard;

    grid.querySelectorAll('.rq-card').forEach(card => {
      const id = card.dataset.id;
      const p = MyProjects.getProject(id);
      if (!p) return;
      card.querySelector('.myp-btn-select')?.addEventListener('click', () => {
        _onSelect?.(p);
        close();
      });
      card.querySelector('.myp-btn-edit')?.addEventListener('click', () => _openForm(p));
      card.querySelector('.myp-btn-delete')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el proyecto "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
        try { await MyProjects.deleteProject(id); } catch (err) { alert(err.message); }
      });
    });
    grid.querySelector('#mypAddCard')?.addEventListener('click', () => _openForm(null));
  }

  MyProjects.onChange(() => {
    if (overlay && !overlay.classList.contains('hidden') && !listView.classList.contains('hidden')) _renderGrid();
  });

  // ── Vista formulario ─────────────────────────────────────────────────────
  function _renderTipos() {
    tiposContainer.innerHTML = '';
    for (const t of _editingTipologias) {
      const card = document.createElement('div');
      card.className = 'mp-tipo-card';
      const banosDisabled = t.dormitorios === 'Estudio';
      card.innerHTML = `
        <button type="button" class="mp-remove-tipo" title="Eliminar">×</button>
        <div class="mp-tipo-metrics">
          <div class="mp-metric-row">
            <span>Dormitorios</span>
            <select class="mp-tipo-dormitorios mp-input">
              <option value="">—</option>
              ${DORMITORIOS_OPTIONS.map(o => `<option value="${o}"${t.dormitorios === o ? ' selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="mp-metric-row">
            <span>Baños</span>
            <select class="mp-tipo-banos mp-input" ${banosDisabled ? 'disabled' : ''}>
              <option value="">—</option>
              ${BANOS_OPTIONS.map(o => `<option value="${o}"${t.banos === o ? ' selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <label class="mp-metric-row">
            <span>Cantidad</span>
            <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—" data-metric="cantidad" value="${t.cantidad ?? ''}" />
          </label>
          <label class="mp-metric-row">
            <span>Útil m²</span>
            <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—" data-metric="sup" value="${t.sup ?? ''}" />
          </label>
          <label class="mp-metric-row">
            <span>Venta UF/m²</span>
            <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—" data-metric="ufm2" value="${t.ufm2 ?? ''}" />
          </label>
          <div class="mp-metric-row">
            <span>Ticket Venta</span>
            <span class="mp-metric-computed" data-ticket>${_fmtTicket(t)}</span>
          </div>
          <label class="mp-metric-row">
            <span>Renta UF/m²/mes</span>
            <input type="number" class="mp-metric-input mp-input" step="any" placeholder="—" data-metric="arriendoUfM2Mes" value="${t.arriendoUfM2Mes ?? ''}" />
          </label>
          <div class="mp-metric-row">
            <span>Ticket Renta</span>
            <span class="mp-metric-computed" data-renta-total>${_fmtRentaTotal(t)}</span>
          </div>
        </div>`;

      card.querySelector('.mp-tipo-dormitorios').addEventListener('change', e => {
        t.dormitorios = e.target.value;
        if (t.dormitorios === 'Estudio') t.banos = null; // Estudio no tiene baños independientes
        _renderTipos(); // re-renderiza para bloquear/desbloquear el selector de baños
      });
      card.querySelector('.mp-tipo-banos').addEventListener('change', e => { t.banos = e.target.value; });
      card.querySelector('.mp-remove-tipo').addEventListener('click', () => {
        _editingTipologias = _editingTipologias.filter(x => x.id !== t.id);
        _renderTipos();
      });
      card.querySelectorAll('.mp-metric-input').forEach(input => {
        input.addEventListener('input', e => {
          const v = e.target.value.trim();
          t[e.target.dataset.metric] = v === '' ? null : Number(v);
          const ticketEl = card.querySelector('[data-ticket]');
          if (ticketEl) ticketEl.textContent = _fmtTicket(t);
          const rentaEl = card.querySelector('[data-renta-total]');
          if (rentaEl) rentaEl.textContent = _fmtRentaTotal(t);
        });
      });
      tiposContainer.appendChild(card);
    }
  }

  function _renderEditors() {
    const user = getUser();
    const isOwnerEditing = !_editingId || (user && _editingId && MyProjects.getProject(_editingId)?.ownerUid === user.uid);
    editorsSection.style.display = isOwnerEditing ? '' : 'none';
    editorsChipsEl.innerHTML = _editingEmails.map(email => `
      <span class="rq-user-filter-btn" style="display:inline-flex; align-items:center; gap:6px;">
        ${_esc(email)}
        <button type="button" data-email="${_esc(email)}" style="border:none;background:none;cursor:pointer;color:#94a3b8;font-weight:700;">×</button>
      </span>
    `).join('') || '<span class="muted">Ninguno todavía.</span>';
    editorsChipsEl.querySelectorAll('button[data-email]').forEach(btn => {
      btn.addEventListener('click', () => {
        _editingEmails = _editingEmails.filter(e => e !== btn.dataset.email);
        _renderEditors();
      });
    });
  }

  function _openForm(project) {
    _editingId = project?.id ?? null;
    _editingTipologias = (project?.tipologias ?? []).map(t => _inferDormitoriosBanos({ ...t, id: t.id ?? _nextId() }));
    _editingEmails = [...(project?.editorEmails ?? [])];

    document.getElementById('mypFormTitle').textContent = project ? 'Editar proyecto' : 'Nuevo proyecto';
    document.getElementById('mypFormNombre').value    = project?.nombre ?? '';
    document.getElementById('mypFormDireccion').value = project?.direccion ?? '';
    document.getElementById('mypFormTipo').value       = project?.tipo ?? '';

    _renderTipos();
    _renderEditors();

    listView.classList.add('hidden');
    formView.classList.remove('hidden');
  }

  function _closeForm() {
    formView.classList.add('hidden');
    listView.classList.remove('hidden');
    _renderGrid();
  }

  document.getElementById('mypAddTipoBtn').addEventListener('click', () => {
    _editingTipologias.push({ id: _nextId(), dormitorios: '', banos: null, cantidad: null, sup: null, ufm2: null, arriendoUfM2Mes: null });
    _renderTipos();
  });

  document.getElementById('mypEditorAddBtn').addEventListener('click', () => {
    const input = document.getElementById('mypEditorEmailInput');
    const email = input.value.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Ingresa un correo válido.'); return; }
    if (!_editingEmails.includes(email)) _editingEmails.push(email);
    input.value = '';
    _renderEditors();
  });

  document.getElementById('mypFormSaveBtn').addEventListener('click', async () => {
    const nombre    = document.getElementById('mypFormNombre').value.trim();
    const direccion = document.getElementById('mypFormDireccion').value.trim();
    const tipo       = document.getElementById('mypFormTipo').value;
    if (!nombre) { alert('El proyecto necesita un nombre.'); return; }

    // Firestore no acepta objetos con propiedades 'undefined' — normalizar
    // ids/campos numéricos ausentes a null antes de guardar. 'nombre' ya no
    // se guarda acá — cada visor deriva su propio string de tipología a
    // partir de dormitorios/banos en su miProyecto.js.
    const tipologias = _editingTipologias.map(({ id, dormitorios, banos, cantidad, sup, ufm2, arriendoUfM2Mes }) => ({
      id, dormitorios: dormitorios ?? '', banos: banos ?? null,
      cantidad: cantidad ?? null, sup: sup ?? null, ufm2: ufm2 ?? null, arriendoUfM2Mes: arriendoUfM2Mes ?? null,
    }));

    try {
      if (_editingId) {
        await MyProjects.updateProject(_editingId, { nombre, direccion, tipo, tipologias, editorEmails: _editingEmails });
      } else {
        await MyProjects.addProject({ nombre, direccion, tipo, tipologias, editorEmails: _editingEmails });
      }
      _closeForm();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('mypFormBackBtn').addEventListener('click', _closeForm);

  // ── Apertura/cierre del modal ────────────────────────────────────────────
  document.getElementById('mypAddBtn').addEventListener('click', () => _openForm(null));
  document.getElementById('mypCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function open({ onSelect, editProjectId } = {}) {
    _onSelect = onSelect ?? null;
    overlay.classList.remove('hidden');

    // Atajo desde el sidebar ("Editar proyecto") — salta directo al
    // formulario del proyecto activo en vez de mostrar la lista primero.
    if (editProjectId) {
      const project = MyProjects.getProject(editProjectId);
      if (project) { _openForm(project); return; }
    }

    formView.classList.add('hidden');
    listView.classList.remove('hidden');
    _renderGrid();
  }

  function close() {
    overlay.classList.add('hidden');
  }

  _instance = { open, close };
  return _instance;
}
