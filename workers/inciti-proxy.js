/**
 * Cloudflare Worker — Proxy para API de Inciti
 *
 * Deploy:
 *   cd workers
 *   npx wrangler secret put INCITI_API_KEY   ← pegar el UUID cuando lo pida
 *   npx wrangler deploy
 *
 * Variables de entorno (wrangler.toml → [vars]):
 *   ALLOWED_ORIGIN — origin permitido, ej: https://tomaslihnv.github.io
 *
 * Secrets (NO en wrangler.toml, usar el comando de arriba):
 *   INCITI_API_KEY — UUID de autenticación de Inciti
 */

const INCITI_ENDPOINT = 'https://api.inciti.com/api/get_insights_pro';
const MAX_VERTICES    = 100;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN || '*';

    const cors = {
      'Access-Control-Allow-Origin':  allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400, cors);
    }

    // Validación — markets permitidos por los visores
    const { market, polygons } = body;
    const ALLOWED_MARKETS = new Set([
      'residencial', 'multifamily', 'oficinas',
      'bodegas', 'parquesindustriales', 'stripcenters', 'suelos',
    ]);

    if (!ALLOWED_MARKETS.has(market)) {
      return json({ error: `market inválido — valores aceptados: ${[...ALLOWED_MARKETS].join(', ')}` }, 400, cors);
    }
    if (!Array.isArray(polygons) || polygons.length !== 1) {
      return json({ error: 'Se requiere exactamente 1 polígono en "polygons"' }, 400, cors);
    }
    if (!Array.isArray(polygons[0]) || polygons[0].length < 3) {
      return json({ error: 'El polígono debe tener al menos 3 vértices' }, 400, cors);
    }
    if (polygons[0].length > MAX_VERTICES) {
      return json({ error: `El polígono no puede superar ${MAX_VERTICES} vértices` }, 400, cors);
    }

    // Forward a Inciti inyectando la key server-side
    let upstream;
    try {
      upstream = await fetch(INCITI_ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key':    env.INCITI_API_KEY,
        },
        body: JSON.stringify({ market, polygons }),
      });
    } catch (err) {
      return json({ error: `Error al contactar Inciti: ${err.message}` }, 502, cors);
    }

    const data = await upstream.text();
    return new Response(data, {
      status:  upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};

function json(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
