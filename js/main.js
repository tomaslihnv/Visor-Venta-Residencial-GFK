import { $, $$ } from './utils.js';
import { resetFilters } from './filters.js';
import { renderChart } from './chart.js';

// ============== Reset ==============
$('#resetBtn').addEventListener('click', resetFilters);

// ============== Tabs ==============
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    if (tab.dataset.tab === 'grafico') renderChart();
    if (tab.dataset.tab === 'mapa') {
      import('./map.js').then(({ renderMap }) => renderMap());
    }
  });
});

// ============== Exportar ==============
$('#exportCsvBtn').addEventListener('click', () => {
  import('./data.js').then(({ state }) => {
    if (state.filtered.length === 0) return;
    const cols = state.columns.map(c => c.name);
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const lines = [cols.join(',')];
    for (const r of state.filtered) {
      lines.push(cols.map(c => escape(r[c])).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `datos_filtrados_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

$('#exportPngBtn').addEventListener('click', () => {
  import('./data.js').then(({ state }) => {
    if (!state.chart) return;
    const a = document.createElement('a');
    a.href = state.chart.toBase64Image('image/png', 1);
    a.download = `grafico_${Date.now()}.png`;
    a.click();
  });
});