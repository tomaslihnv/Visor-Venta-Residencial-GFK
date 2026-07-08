import { INCITI_API_KEY, INCITI_API_URL, INCITI_PROXY_URL } from '../config.local.js';

// ── Inciti API — POIs del Barrio ───────────────────────────────────────────
//
// Endpoint: POST /get_insights_pro
//
// Ejemplo de request:
//
//   curl --location --request POST 'https://api.inciti.com/api/get_insights_pro' \
//       --header 'Content-Type: application/json' \
//       --header 'X-API-Key: {{YOUR_API_KEY}}' \
//       --data '{
//           "market": "residencial",
//           "polygons": [
//               [
//                   {"lat": -33.435578546992005, "lng": -70.68080131225588},
//                   {"lat": -33.45033229249539,  "lng": -70.67856971435549},
//                   {"lat": -33.44732445093568,  "lng": -70.66758338623049},
//                   {"lat": -33.43514878864547,  "lng": -70.66895667724601}
//               ]
//           ]
//       }'
//
// Notas:
//   - El polígono se dibuja en el mapa (Leaflet) y se envía al confirmar.
//   - Usar INCITI_PROXY_URL en desarrollo para resolver CORS.
//   - La estructura de la respuesta (categorías de POIs, campos por POI)
//     debe documentarse aquí una vez que se explore la respuesta real.

const ENDPOINT_PATH = 'get_insights_pro';

export async function fetchPois(polygon, { onProgress } = {}) {
  if (!INCITI_API_KEY || !INCITI_API_URL) {
    throw new Error(
      'Faltan credenciales. Completa js/config.local.js con INCITI_API_KEY e INCITI_API_URL.'
    );
  }

  const base = INCITI_PROXY_URL ? INCITI_PROXY_URL : INCITI_API_URL.replace(/\/$/, '');
  const url  = `${base}/${ENDPOINT_PATH}`;

  onProgress?.('Consultando POIs del barrio…');

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    INCITI_API_KEY,
    },
    body: JSON.stringify({
      market:   'residencial',
      polygons: [polygon],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }

  const payload = await res.json();

  // TODO: explorar estructura real de payload y documentarla aquí.
  // Descomentar para inspeccionar en consola:
  // console.log('[barrio/api] payload crudo:', JSON.stringify(payload, null, 2));

  return payload;
}
