"""
Consulta la API de Inciti para una comuna completa.
Subdivide el polígono real de la comuna (no el bounding box) en chunks de <25 km²
usando Sutherland-Hodgman para clipear cada tile contra el polígono comunal.
Solo se mandan a la API los chunks que realmente intersectan la comuna.

Uso:
  python scripts/fetch_comuna.py "Las Condes" multifamily
  python scripts/fetch_comuna.py "Providencia" multifamily

Requiere:
  pip install requests python-dotenv
"""

import json
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Instala requests: pip install requests")

try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("Instala python-dotenv: pip install python-dotenv")

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

API_KEY      = os.getenv("INCITI_API_URL", "").strip()
API_URL      = os.getenv("INCITI_API_KEY", "").strip()

if not API_KEY or not API_URL:
    sys.exit("Faltan credenciales en .env")

ENDPOINT     = API_URL.rstrip("/") + "/get_insights_pro"
COMUNAS_FILE = ROOT / "data" / "comunas_santiago.json"
OUTPUT_DIR   = ROOT / "data" / "multifamily"

TILE_KM  = 4.95   # lado del tile → ~24.5 km² (límite API: 25 km²)
DELAY_S  = 1.5


# ── Geometría ──────────────────────────────────────────────────────────────

def _to_xy(pts):
    """Convierte lista de {lat,lng} a lista de (lng, lat) para operaciones 2D."""
    return [(p["lng"], p["lat"]) for p in pts]

def _to_latlng(pts):
    return [{"lat": y, "lng": x} for x, y in pts]

def _bbox(polygon):
    lats = [p["lat"] for p in polygon]
    lngs = [p["lng"] for p in polygon]
    return min(lats), max(lats), min(lngs), max(lngs)

def _poly_area(pts):
    """Área con fórmula de Shoelace (en unidades de coordenadas)."""
    n = len(pts)
    a = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _clip_polygon_by_halfplane(poly, x1, y1, x2, y2):
    """
    Sutherland-Hodgman: clipea poly contra el semiplano a la izquierda
    de la arista dirigida (x1,y1)→(x2,y2).
    """
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
    """Clipea poly (lista de (lng,lat)) contra el rectángulo dado."""
    edges = [
        (lng_min, lat_min, lng_max, lat_min),  # bottom
        (lng_max, lat_min, lng_max, lat_max),  # right
        (lng_max, lat_max, lng_min, lat_max),  # top
        (lng_min, lat_max, lng_min, lat_min),  # left
    ]
    result = list(poly)
    for x1, y1, x2, y2 in edges:
        result = _clip_polygon_by_halfplane(result, x1, y1, x2, y2)
        if not result:
            return []
    return result


def _commune_chunks(polygon, tile_km=TILE_KM):
    """
    Genera chunks que son la intersección del polígono comunal con cada tile
    del grid. Solo devuelve chunks con área > 0.
    """
    lat_min, lat_max, lng_min, lng_max = _bbox(polygon)
    lat_mid = (lat_min + lat_max) / 2
    dlat    = tile_km / 111.0
    dlng    = tile_km / (111.0 * math.cos(math.radians(lat_mid)))

    # Polígono comunal en (lng, lat)
    commune_xy = _to_xy(polygon)
    # Cerrar si no está cerrado
    if commune_xy[0] != commune_xy[-1]:
        commune_xy.append(commune_xy[0])

    chunks = []
    lat = lat_min
    while lat < lat_max:
        lng = lng_min
        while lng < lng_max:
            clipped = _clip_polygon_by_rect(
                commune_xy,
                lng, lat, lng + dlng, lat + dlat
            )
            if clipped and _poly_area(clipped) > 1e-10:
                # Cerrar el polígono clipeado
                if clipped[0] != clipped[-1]:
                    clipped.append(clipped[0])
                chunks.append(_to_latlng(clipped))
            lng += dlng
        lat += dlat

    return chunks


# ── Normalización ──────────────────────────────────────────────────────────

def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _flatten(entity, historico=False):
    """
    historico=False → solo el último período (para el visor principal)
    historico=True  → todos los períodos (para el visor histórico)
    """
    rows   = []
    loc    = entity.get("location") or {}
    periods = entity.get("periods") or []
    if not periods:
        return rows

    selected = periods if historico else [periods[-1]]

    base = {
        "Proyecto":      entity.get("name") or entity.get("id") or "",
        "Propietario":   entity.get("owner") or "",
        "Administrador": entity.get("administrator") or "",
        "Comuna":        loc.get("commune") or loc.get("comuna") or "",
    }
    lat, lng = loc.get("lat"), loc.get("lng")
    if lat is not None and lng is not None:
        base["__lat"] = float(lat)
        base["__lng"] = float(lng)

    for period in selected:
        periodo_key   = period.get("key") or ""    # "2024-Q1"
        periodo_label = period.get("label") or ""  # "Q1 2024"
        periodo_year  = period.get("year")
        periodo_n     = period.get("n")            # número de trimestre

        for prog in (period.get("programs") or []):
            stock   = _num(prog.get("stock"))
            avail   = _num(prog.get("available"))
            vac_raw = _num(prog.get("vacancy"))
            vac_pct = round(vac_raw * 100, 1) if vac_raw is not None else None
            rows.append({
                **base,
                "Período":        periodo_label,
                "Período Key":    periodo_key,
                "Año":            periodo_year,
                "Trimestre":      periodo_n,
                "Programa":       prog.get("program") or "",
                "Stock":          stock,
                "Disponibilidad": avail,
                "Vacancia (%)":   vac_pct,
                "Ocupación (%)":  round(100 - vac_pct, 1) if vac_pct is not None else None,
                "Útil (m²)":      _num(prog.get("usefulM2")),
                "Arriendo UF":    _num(prog.get("rentUF")),
                "UF/m²":          _num(prog.get("rentUfPerM2")),
                "Estado Prog.":   prog.get("status") or "",
            })
    return rows


# ── Fetch ──────────────────────────────────────────────────────────────────

def _fetch_chunk(chunk, market, idx, total):
    try:
        r = requests.post(
            ENDPOINT,
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            json={"market": market, "polygons": [chunk]},
            timeout=60,
        )
        r.raise_for_status()
        entities = (r.json().get("projects") or {}).get("entities") or []
        print(f"  Chunk {idx+1}/{total}: {len(entities)} proyectos")
        return entities
    except Exception as e:
        print(f"  Chunk {idx+1}/{total}: ERROR - {e}")
        return []


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    comuna_name = sys.argv[1] if len(sys.argv) > 1 else "Las Condes"
    market      = sys.argv[2] if len(sys.argv) > 2 else "multifamily"

    if not COMUNAS_FILE.exists():
        sys.exit(f"No existe {COMUNAS_FILE}. Corre: python scripts/build_commune_polygons.py")

    with open(COMUNAS_FILE, encoding="utf-8") as f:
        comunas = json.load(f)

    if comuna_name not in comunas:
        sys.exit(f"Comuna '{comuna_name}' no encontrada.\nDisponibles: {', '.join(sorted(comunas))}")

    polygon = comunas[comuna_name][0]
    chunks  = _commune_chunks(polygon)

    print(f"Comuna  : {comuna_name}")
    print(f"Mercado : {market}")
    print(f"Chunks  : {len(chunks)} (polígono real, no bounding box)")
    print()

    all_entities = {}
    for i, chunk in enumerate(chunks):
        entities = _fetch_chunk(chunk, market, i, len(chunks))
        for e in entities:
            key = e.get("id") or e.get("name") or str(i)
            if key not in all_entities:
                all_entities[key] = e
        if i < len(chunks) - 1:
            time.sleep(DELAY_S)

    print(f"\nTotal proyectos únicos: {len(all_entities)}")

    import unicodedata
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fecha = datetime.now().strftime("%Y%m%d")
    safe  = unicodedata.normalize("NFD", comuna_name.lower()).encode("ascii", "ignore").decode().replace(" ", "_")

    # ── Archivo actual (solo último período) ───────────────────────────────
    rows_actual = []
    for entity in all_entities.values():
        rows_actual.extend(_flatten(entity, historico=False))
    validos_actual = [r for r in rows_actual if r.get("Arriendo UF") and r["Arriendo UF"] > 0]
    print(f"Filas actuales con precio válido: {len(validos_actual)} / {len(rows_actual)} totales")

    if validos_actual:
        out_actual = OUTPUT_DIR / f"{market}_{safe}_{fecha}.json"
        with open(out_actual, "w", encoding="utf-8") as f:
            json.dump(validos_actual, f, ensure_ascii=False, indent=2, default=str)
        print(f"Actual    -> {out_actual}")

    # ── Archivo histórico (todos los períodos) ─────────────────────────────
    rows_hist = []
    for entity in all_entities.values():
        rows_hist.extend(_flatten(entity, historico=True))
    validos_hist = [r for r in rows_hist if r.get("Arriendo UF") and r["Arriendo UF"] > 0]
    print(f"Filas históricas con precio válido: {len(validos_hist)} / {len(rows_hist)} totales")

    if validos_hist:
        out_hist = OUTPUT_DIR / f"{market}_{safe}_historico_{fecha}.json"
        with open(out_hist, "w", encoding="utf-8") as f:
            json.dump(validos_hist, f, ensure_ascii=False, indent=2, default=str)
        print(f"Historico -> {out_hist}")

    if not validos_actual and not validos_hist:
        print("Sin filas con precio. Revisa la respuesta de la API.")
        sys.exit(1)


if __name__ == "__main__":
    main()
