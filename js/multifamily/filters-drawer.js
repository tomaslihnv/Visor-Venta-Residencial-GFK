// ── Filtros en drawer para pantallas angostas (Multifamily) ────────────────
// En vez de duplicar el panel de filtros, reparenta el mismo nodo #filtrosPanel
// entre el sidebar (desktop) y el <sl-drawer> (mobile) según el ancho de
// pantalla — una sola fuente de verdad del DOM, sin romper listeners.

const BREAKPOINT = 880;

export function initFiltersDrawer() {
  const panel   = document.getElementById('filtrosPanel');
  const sidebar = document.getElementById('sidebar');
  const drawer  = document.getElementById('filtrosDrawer');
  const btn     = document.getElementById('mobileFiltersBtn');
  const savedDatasets = document.getElementById('savedDatasetsPanel');
  if (!panel || !sidebar || !drawer || !btn) return;

  let inDrawer = false;

  function sync() {
    const narrow = window.innerWidth <= BREAKPOINT;
    if (narrow && !inDrawer) {
      drawer.appendChild(panel);
      inDrawer = true;
    } else if (!narrow && inDrawer) {
      if (savedDatasets) sidebar.insertBefore(panel, savedDatasets);
      else sidebar.appendChild(panel);
      drawer.hide?.();
      inDrawer = false;
    }
  }

  btn.addEventListener('click', () => drawer.show?.());
  window.addEventListener('resize', sync);
  sync();
}
