// ── Unidades Tipo Import / Export ───────────────────────────────────────────
// Shared module: exporta/importa las "unidades tipo" de Mi Proyecto como JSON,
// arrastrando el archivo sobre el panel Mi Proyecto para recargarlas.
//
// Nombre de archivo: [Visor]_[Proyecto]_unidadestipo_[yyyymmdd].json
//
// Usage:
//   initTiposIO({
//     visorId:      'venta' | 'renta' | 'multifamily' | ...,
//     visorLabel:   'Venta' | 'Renta' | 'Multifamily' | ...,
//     getState:     () => ({ proyecto, tipologias }),
//     applyState:   (tipologias) => void,
//     panelEl:      HTMLElement,   // el panel Mi Proyecto (drop zone)
//   });

const TIPOS_FILE_MAGIC = 'visor-unidadestipo-v1';

function _ymd() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function _sanitize(s) {
  return String(s ?? '').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'SinNombre';
}

function _doExport(visorId, visorLabel, getState) {
  const { proyecto, tipologias } = getState();
  const filename = `${_sanitize(visorLabel)}_${_sanitize(proyecto)}_unidadestipo_${_ymd()}`;
  const payload = {
    _magic:    TIPOS_FILE_MAGIC,
    visor:     visorId,
    proyecto:  proyecto ?? '',
    timestamp: new Date().toISOString(),
    tipologias,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${filename}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

function _isTiposFile(data) {
  return data && data._magic === TIPOS_FILE_MAGIC;
}

async function _handleDrop(file, visorId, applyState, feedbackEl) {
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    _showFeedback(feedbackEl, 'El archivo debe ser .json', 'error');
    return;
  }
  try {
    const data = await _readJsonFile(file);
    if (!_isTiposFile(data)) {
      _showFeedback(feedbackEl, 'No es un archivo de unidades tipo válido.', 'error');
      return;
    }
    if (data.visor && data.visor !== visorId) {
      _showFeedback(feedbackEl, `Unidades tipo de "${data.visor}" — cargando igual…`, 'warn');
    }
    applyState(data.tipologias ?? []);
    const label = data.proyecto ? `"${data.proyecto}" cargado` : 'Unidades tipo cargadas';
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

// ── Init ──────────────────────────────────────────────────────────────────

export function initTiposIO({ visorId, visorLabel, getState, applyState, panelEl }) {
  const btn      = document.getElementById('exportTiposBtn');
  const feedback = document.getElementById('tiposIOFeedback');

  if (btn) {
    btn.addEventListener('click', () => _doExport(visorId, visorLabel, getState));
  }

  const dropTarget = panelEl ?? document.getElementById('mpPanelBody');
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
