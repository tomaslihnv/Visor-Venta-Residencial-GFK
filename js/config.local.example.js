// Copiar este archivo como js/config.local.js y completar.
// js/config.local.js está en .gitignore — nunca se sube al repo.
//
// Desarrollo local:
//   1. Correr: python scripts/proxy.py  (lee la key desde .env)
//   2. Dejar INCITI_PROXY_URL = 'http://localhost:5050'
//
// Producción (Cloudflare Worker desplegado):
//   1. cd workers && npx wrangler secret put INCITI_API_KEY
//   2. npx wrangler deploy
//   3. Cambiar INCITI_PROXY_URL a la URL del Worker

export const INCITI_PROXY_URL = 'http://localhost:5050';
