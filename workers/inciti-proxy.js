/**
 * Cloudflare Worker — Proxy para API de Inciti
 *
 * Deploy:
 *   cd workers
 *   npm install                              ← trae 'jose' (verificación de token)
 *   npx wrangler secret put INCITI_API_KEY   ← pegar el UUID cuando lo pida
 *   npx wrangler deploy
 *
 * Variables de entorno (wrangler.toml → [vars]):
 *   ALLOWED_ORIGIN       — origin permitido, ej: https://tomaslihnv.github.io
 *   FIREBASE_PROJECT_ID  — projectId del proyecto Firebase del login
 *   ALLOWED_EMAIL_DOMAIN — dominio de correo permitido, ej: situ.cl
 *
 * Secrets (NO en wrangler.toml, usar el comando de arriba):
 *   INCITI_API_KEY — UUID de autenticación de Inciti
 *
 * Auth: cada request debe traer "Authorization: Bearer <Firebase ID token>".
 * Esto es la barrera REAL de seguridad — el login en el frontend (shared/auth.js)
 * es solo UX; sin esta verificación acá, cualquiera con la URL del Worker
 * podría seguir consumiendo la cuota de Inciti sin pasar por ningún login.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const INCITI_ENDPOINT = 'https://api.inciti.com/api/get_insights_pro';
const MAX_VERTICES    = 100;

// Endpoint JWKS de Google para las claves públicas de Firebase Auth (formato
// JWK directo, a diferencia del endpoint de certificados X.509 que también
// publican — este es el que 'jose' puede consumir sin parseo adicional).
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwks = null;
function _getJwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return _jwks;
}

async function verifyRequestAuth(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return { ok: false, status: 401, error: 'Falta el header Authorization.' };

  if (!env.FIREBASE_PROJECT_ID) {
    return { ok: false, status: 500, error: 'Worker mal configurado: falta FIREBASE_PROJECT_ID.' };
  }

  let payload;
  try {
    const result = await jwtVerify(token, _getJwks(), {
      issuer:   `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    payload = result.payload;
  } catch (err) {
    return { ok: false, status: 401, error: `Token inválido o expirado: ${err.message}` };
  }

  const email = String(payload.email ?? '').toLowerCase();
  const domain = (env.ALLOWED_EMAIL_DOMAIN ?? '').toLowerCase();
  if (!payload.email_verified || !domain || !email.endsWith('@' + domain)) {
    return { ok: false, status: 403, error: 'Cuenta no autorizada para esta herramienta.' };
  }

  return { ok: true, email };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN || '*';

    const cors = {
      'Access-Control-Allow-Origin':  allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    const auth = await verifyRequestAuth(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status, cors);
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
