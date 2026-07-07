"""
Descarga los polígonos de las comunas del Gran Santiago desde OpenStreetMap
y los guarda en data/comunas_santiago.json en el formato que usa la API de Inciti.

Uso:
  pip install requests
  python scripts/build_commune_polygons.py

Salida:
  data/comunas_santiago.json

Formato de salida:
  {
    "Santiago": [ [{"lat": -33.45, "lng": -70.65}, ...] ],
    "Providencia": [ [...] ],
    ...
  }

Cada entrada es una lista de polígonos (por si la comuna tiene partes separadas).
El formato del polígono es el que acepta la API de Inciti: lista de {lat, lng}.
"""

import json
import time
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Instala requests: pip install requests")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Consulta todas las comunas (admin_level=8) dentro de la Región Metropolitana
# (relation 335510). Devuelve los límites como polígonos cerrados.
OVERPASS_QUERY = """
[out:json][timeout:120];
area[~"name"~"Metropolitana de Santiago"]["admin_level"="4"]->.rm;
(
  relation["admin_level"="8"]["boundary"="administrative"](area.rm);
);
out geom;
"""

OUTPUT_PATH       = Path(__file__).parent.parent / "data" / "comunas_santiago.json"
OUTPUT_TILES_PATH = Path(__file__).parent.parent / "data" / "comunas_tiles.json"
TILE_KM = 4.95  # lado del tile → ~24.5 km² (límite API: 25 km²)


def _extract_polygons(members):
    """
    Ensambla el polígono exterior de la comuna uniendo todos los outer ways
    de la relación OSM en cadena (cada way comparte el nodo final con el inicial
    del siguiente). Devuelve una lista con un solo polígono {lat, lng}.
    """
    outers = [m for m in members if m.get("role") == "outer" and "geometry" in m]
    if not outers:
        outers = [m for m in members if "geometry" in m]
    if not outers:
        return []

    # Convertir cada way a lista de puntos (lat, lng)
    segments = []
    for way in outers:
        pts = [(pt["lat"], pt["lon"]) for pt in way["geometry"]]
        if len(pts) >= 2:
            segments.append(pts)

    if not segments:
        return []

    # Encadenar segmentos: unir por nodos compartidos (inicio/fin)
    chain = list(segments[0])
    remaining = segments[1:]
    max_iter = len(remaining) * len(remaining) + 1
    itr = 0
    while remaining and itr < max_iter:
        itr += 1
        joined = False
        for i, seg in enumerate(remaining):
            if _close(chain[-1], seg[0]):
                chain.extend(seg[1:])
                remaining.pop(i)
                joined = True
                break
            if _close(chain[-1], seg[-1]):
                chain.extend(reversed(seg[:-1]))
                remaining.pop(i)
                joined = True
                break
            if _close(chain[0], seg[-1]):
                chain = list(seg) + chain[1:]
                remaining.pop(i)
                joined = True
                break
            if _close(chain[0], seg[0]):
                chain = list(reversed(seg)) + chain[1:]
                remaining.pop(i)
                joined = True
                break
        if not joined:
            # Segmento suelto (isla interior u otro outer) — agregar de todas formas
            chain.extend(remaining.pop(0))

    # Cerrar el anillo
    if chain[0] != chain[-1]:
        chain.append(chain[0])

    return [[{"lat": p[0], "lng": p[1]} for p in chain]]


def _close(a, b, tol=1e-6):
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


def fetch_comunas():
    print("Consultando Overpass API (puede tardar 20-40 seg)...")
    r = requests.post(
        OVERPASS_URL,
        data={"data": OVERPASS_QUERY},
        headers={"User-Agent": "visor-mercado-inmobiliario/1.0"},
        timeout=180,
    )
    r.raise_for_status()
    data = r.json()

    elements = data.get("elements", [])
    print(f"  {len(elements)} comunas encontradas")

    result = {}
    skipped = []

    for el in elements:
        name = el.get("tags", {}).get("name", "").strip()
        if not name:
            continue

        members = el.get("members", [])
        polygons = _extract_polygons(members)

        if not polygons:
            skipped.append(name)
            continue

        # Si ya existe (nombre duplicado), agregar más polígonos
        if name in result:
            result[name].extend(polygons)
        else:
            result[name] = polygons

    if skipped:
        print(f"  Sin geometría ({len(skipped)}): {', '.join(skipped)}")

    return result


def _bbox(polygon):
    lats = [p["lat"] for p in polygon]
    lngs = [p["lng"] for p in polygon]
    return min(lats), max(lats), min(lngs), max(lngs)


def _tile_grid(lat_min, lat_max, lng_min, lng_max, tile_km=TILE_KM):
    import math
    lat_mid = (lat_min + lat_max) / 2
    dlat    = tile_km / 111.0
    dlng    = tile_km / (111.0 * math.cos(math.radians(lat_mid)))
    tiles   = []
    lat = lat_min
    while lat < lat_max:
        lng = lng_min
        while lng < lng_max:
            tiles.append([
                {"lat": lat,        "lng": lng},
                {"lat": lat,        "lng": lng + dlng},
                {"lat": lat + dlat, "lng": lng + dlng},
                {"lat": lat + dlat, "lng": lng},
                {"lat": lat,        "lng": lng},
            ])
            lng += dlng
        lat += dlat
    return tiles


def main():
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    comunas = fetch_comunas()
    print(f"\nComunas con polígono: {len(comunas)}")

    comunas_sorted = dict(sorted(comunas.items()))

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(comunas_sorted, f, ensure_ascii=False, indent=2)
    print(f"Guardado en: {OUTPUT_PATH}")

    # Generar tiles por comuna
    tiles_by_comuna = {}
    print("\nComunas y tiles:")
    for name, polys in comunas_sorted.items():
        poly = polys[0]
        lat_min, lat_max, lng_min, lng_max = _bbox(poly)
        tiles = _tile_grid(lat_min, lat_max, lng_min, lng_max)
        tiles_by_comuna[name] = tiles
        total_pts = len(poly)
        print(f"  {name}: {total_pts} pts, {len(tiles)} tiles de {TILE_KM}x{TILE_KM}km")

    with open(OUTPUT_TILES_PATH, "w", encoding="utf-8") as f:
        json.dump(tiles_by_comuna, f, ensure_ascii=False, indent=2)
    print(f"\nTiles guardados en: {OUTPUT_TILES_PATH}")


if __name__ == "__main__":
    main()
