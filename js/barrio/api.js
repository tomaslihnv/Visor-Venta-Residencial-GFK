import { INCITI_PROXY_URL } from '../config.local.js';

// ── Inciti API — POIs del Barrio ───────────────────────────────────────────
//
// El request pasa por el Cloudflare Worker (workers/inciti-proxy.js) que
// inyecta la X-API-Key server-side. El frontend nunca maneja la key.
//
// Para desarrollo local: levantar scripts/proxy.py y apuntar INCITI_PROXY_URL
// a http://localhost:5050 en js/config.local.js.

const ENDPOINT_PATH = 'get_insights_pro';

export async function fetchPois(polygon, { onProgress } = {}) {
  if (!INCITI_PROXY_URL) {
    throw new Error(
      'Falta configurar INCITI_PROXY_URL en js/config.local.js.\n' +
      'Desarrollo: http://localhost:5050 (requiere python scripts/proxy.py)\n' +
      'Producción: URL del Cloudflare Worker desplegado.'
    );
  }

  const url = `${INCITI_PROXY_URL.replace(/\/$/, '')}/${ENDPOINT_PATH}`;

  onProgress?.('Consultando POIs del barrio…');

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market:   'residencial',
      polygons: [polygon],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }

  return res.json();
}
