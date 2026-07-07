"""
Genera un GeoJSON con los chunks de una comuna y lo imprime para pegar en geojson.io.

Uso:
  python scripts/preview_chunks.py "Las Condes"
  python scripts/preview_chunks.py "Providencia"

Luego copia el output y pégalo en https://geojson.io para visualizarlo.
"""

import json
import math
import sys
from pathlib import Path

ROOT         = Path(__file__).parent.parent
COMUNAS_FILE = ROOT / "data" / "comunas_santiago.json"

TILE_KM = 4.95


def _to_xy(pts):
    return [(p["lng"], p["lat"]) for p in pts]

def _bbox(polygon):
    lats = [p["lat"] for p in polygon]
    lngs = [p["lng"] for p in polygon]
    return min(lats), max(lats), min(lngs), max(lngs)

def _poly_area(pts):
    n = len(pts)
    a = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0

def _clip_polygon_by_halfplane(poly, x1, y1, x2, y2):
    if not poly:
        return []
    def inside(p):
        return (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1) >= 0
    def intersect(a, b):
        dx1, dy1 = b[0] - a[0], b[1] - a[1]
        dx2, dy2 = x2 - x1, y2 - y1
        denom = dx1 * dy2 - dy1 * dx2
        if abs(denom) < 1e-12:
            return a
        t = ((x1 - a[0]) * dy2 - (y1 - a[1]) * dx2) / denom
        return (a[0] + t * dx1, a[1] + t * dy1)
    output = []
    for i, curr in enumerate(poly):
        prev = poly[i - 1]
        if inside(curr):
            if not inside(prev):
                output.append(intersect(prev, curr))
            output.append(curr)
        elif inside(prev):
            output.append(intersect(prev, curr))
    return output

def _clip_polygon_by_rect(poly, lng_min, lat_min, lng_max, lat_max):
    edges = [
        (lng_min, lat_min, lng_max, lat_min),
        (lng_max, lat_min, lng_max, lat_max),
        (lng_max, lat_max, lng_min, lat_max),
        (lng_min, lat_max, lng_min, lat_min),
    ]
    result = list(poly)
    for x1, y1, x2, y2 in edges:
        result = _clip_polygon_by_halfplane(result, x1, y1, x2, y2)
        if not result:
            return []
    return result

def _commune_chunks(polygon):
    lat_min, lat_max, lng_min, lng_max = _bbox(polygon)
    lat_mid = (lat_min + lat_max) / 2
    dlat    = TILE_KM / 111.0
    dlng    = TILE_KM / (111.0 * math.cos(math.radians(lat_mid)))

    commune_xy = _to_xy(polygon)
    if commune_xy[0] != commune_xy[-1]:
        commune_xy.append(commune_xy[0])

    chunks = []
    lat = lat_min
    while lat < lat_max:
        lng = lng_min
        while lng < lng_max:
            clipped = _clip_polygon_by_rect(commune_xy, lng, lat, lng + dlng, lat + dlat)
            if clipped and _poly_area(clipped) > 1e-10:
                if clipped[0] != clipped[-1]:
                    clipped.append(clipped[0])
                chunks.append(clipped)
            lng += dlng
        lat += dlat
    return chunks


def main():
    comuna_name = sys.argv[1] if len(sys.argv) > 1 else "Las Condes"

    with open(COMUNAS_FILE, encoding="utf-8") as f:
        comunas = json.load(f)

    if comuna_name not in comunas:
        sys.exit(f"Comuna '{comuna_name}' no encontrada.")

    polygon = comunas[comuna_name][0]
    chunks  = _commune_chunks(polygon)

    features = []

    # Polígono comunal completo (azul)
    features.append({
        "type": "Feature",
        "properties": {"name": comuna_name, "fill": "#0000ff", "fill-opacity": 0.1, "stroke": "#0000ff"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[p["lng"], p["lat"]] for p in polygon]]
        }
    })

    # Chunks clipeados (rojo semitransparente)
    for i, chunk in enumerate(chunks):
        features.append({
            "type": "Feature",
            "properties": {"chunk": i + 1, "fill": "#ff0000", "fill-opacity": 0.15, "stroke": "#ff0000"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[x, y] for x, y in chunk]]
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}

    print(f"Comuna: {comuna_name}  |  {len(chunks)} chunks\n")
    print(json.dumps(geojson, ensure_ascii=False))


if __name__ == "__main__":
    main()
