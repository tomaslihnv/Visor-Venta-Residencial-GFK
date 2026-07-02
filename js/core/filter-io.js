// ── Filter Import / Export ────────────────────────────────────────────────
// Shared module: popup naming dialog, JSON download, and drag-&-drop import.
//
// Usage:
//   initFilterIO({
//     visorId:         'venta' | 'renta' | 'multifamily',
//     getState:        () => serializableObject,
//     applyState:      (data) => void,
//     panelEl:         HTMLElement,   // the filtros panel body for drop zone
//   });

const FILTER_FILE_MAGIC = 'visor-filtros-v1';

// ── Dialog ────────────────────────────────────────────────────────────────

function _ensureDialog() {
  let dlg = document.getElementById('filterExportDialog');
  if (dlg) return dlg;

  dlg = document.createElement('dialog');
  dlg.id = 'filterExportDialog';
  dlg.className = 'filter-export-dialog';
  dlg.innerHTML = `
    <div class="fed-title">Exportar filtros</div>
    <label class="fed-label">Nombre del archivo</label>
    <input type="text" id="filterExportName" class="fed-input" placeholder="ej: Santiago Centro Mayo 2026" maxlength="80" />
    <div class="fed-actions">
      <button id="filterExportConfirm" class="primary-btn">Descargar</button>
      <button id="filterExportCancel"  class="ghost-btn">Cancelar</button>
    </div>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

function _showExportDialog(visorId, getState) {
  const dlg   = _ensureDialog();
  const input = document.getElementById('filterExportName');
  const now   = new Date();
  const ymd   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  input.value = `${visorId}-filtros-${ymd}`;

  dlg.showModal();

  const confirm = document.getElementById('filterExportConfirm');
  const cancel  = document.getElementById('filterExportCancel');

  const doExport = () => {
    const name = (input.value.trim() || `${visorId}-filtros`).replace(/[^\w\s\-]/g, '').trim();
    const payload = {
      _magic:    FILTER_FILE_MAGIC,
      visor:     visorId,
      name,
      timestamp: new Date().toISOString(),
      filters:   getState(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dlg.close();
  };

  const cleanup = () => {
    confirm.removeEventListener('click', doExport);
    cancel.removeEventListener('click', close);
    input.removeEventListener('keydown', onKey);
  };
  const close = () => { cleanup(); dlg.close(); };
  const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); doExport(); } };

  confirm.addEventListener('click', doExport,  { once: true });
  cancel .addEventListener('click', close,     { once: true });
  input  .addEventListener('keydown', onKey);
  dlg    .addEventListener('close', cleanup,   { once: true });

  setTimeout(() => { input.select(); }, 50);
}

// ── Import ────────────────────────────────────────────────────────────────

function _readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch { reject(new Error('El archivo no es un JSON válido.')); }
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo.'));
    reader.readAsText(file);
  });
}

function _isFilterFile(data) {
  return data && data._magic === FILTER_FILE_MAGIC;
}

async function _handleDrop(file, visorId, applyState, feedbackEl) {
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    _showFeedback(feedbackEl, 'El archivo debe ser .json', 'error');
    return;
  }
  try {
    const data = await _readJsonFile(file);
    if (!_isFilterFile(data)) {
      _showFeedback(feedbackEl, 'No es un archivo de filtros válido.', 'error');
      return;
    }
    if (data.visor && data.visor !== visorId) {
      _showFeedback(feedbackEl, `Filtros de "${data.visor}" — aplicando los compatibles…`, 'warn');
    }
    applyState(data.filters);
    const label = data.name ? `"${data.name}" cargado` : 'Filtros aplicados';
    _showFeedback(feedbackEl, `✓ ${label}`, 'ok');
  } catch (err) {
    _showFeedback(feedbackEl, err.message, 'error');
  }
}

function _showFeedback(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.className   = `filter-io-feedback filter-io-fb-${type}`;
  el.style.display = '';
  clearTimeout(el._fbTimer);
  el._fbTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Global drag prevention ─────────────────────────────────────────────────
// Without this, dragging a JSON file outside the filter panel causes the
// browser to navigate to the file URL, resetting the entire visor.

let _globalDragReady = false;
function _ensureGlobalDragPrevention() {
  if (_globalDragReady) return;
  _globalDragReady = true;
  document.addEventListener('dragover', e => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    // Prevent browser navigation when a file is dropped outside a handled target.
    // Specific targets (Excel dropzone, filter panel) handle their own files.
    e.preventDefault();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initFilterIO({ visorId, getState, applyState, panelEl }) {
  _ensureGlobalDragPrevention();
  const btn      = document.getElementById('exportFiltersBtn');
  const feedback = document.getElementById('filterIOFeedback');

  if (btn) {
    btn.addEventListener('click', () => _showExportDialog(visorId, getState));
  }

  // Drag & drop on the panel element
  const dropTarget = panelEl ?? document.getElementById('filtrosPanelBody');
  if (!dropTarget) return;

  dropTarget.addEventListener('dragover', e => {
    const hasJson = [...(e.dataTransfer?.items ?? [])].some(
      it => it.kind === 'file' && (it.type === 'application/json' || it.type === '')
    );
    if (!hasJson) return;
    e.preventDefault();
    dropTarget.classList.add('filter-drop-active');
  });

  dropTarget.addEventListener('dragleave', e => {
    if (!dropTarget.contains(e.relatedTarget)) {
      dropTarget.classList.remove('filter-drop-active');
    }
  });

  dropTarget.addEventListener('drop', async e => {
    dropTarget.classList.remove('filter-drop-active');
    const file = [...e.dataTransfer.files].find(
      f => f.name.endsWith('.json') || f.type === 'application/json'
    );
    if (!file) return;
    e.preventDefault();
    await _handleDrop(file, visorId, applyState, feedback);
  });
}
