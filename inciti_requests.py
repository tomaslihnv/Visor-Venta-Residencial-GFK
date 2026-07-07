import json
import time
import requests
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()

API_KEY = os.getenv("INCITI_API_URL")   # el UUID
API_URL = os.getenv("INCITI_API_KEY")   # la URL base

ENDPOINT = API_URL.rstrip("/") + "/get_insights_pro"
TILES_FILE = Path(__file__).parent / "data" / "comunas_tiles.json"


def call(market, polygon, tile_idx, total):
    body = {"market": market, "polygons": [polygon]}
    r = requests.post(
        ENDPOINT,
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        json=body,
        timeout=60,
    )
    remaining = r.headers.get("X-Ratelimit-Remaining", "?")
    if not r.ok:
        print(f"  Tile {tile_idx+1}/{total}: ERROR {r.status_code} — {r.text[:200]}")
        return []
    entities = (r.json().get("projects") or {}).get("entities") or []
    print(f"  Tile {tile_idx+1}/{total}: {len(entities)} proyectos  (rate limit restante: {remaining})")
    return entities


# ── Las Condes — todos los tiles ───────────────────────────────────────────
if not TILES_FILE.exists():
    print(f"No existe {TILES_FILE}. Corre primero: python scripts/build_commune_polygons.py")
    exit(1)

# ── Verificar headers CORS ─────────────────────────────────────────────────
print("=== HEADERS DE RESPUESTA ===")
r_test = requests.post(
    ENDPOINT,
    headers={"Content-Type": "application/json", "X-API-Key": API_KEY, "Origin": "https://app.inciti.com"},
    json={"market": "multifamily", "polygons": [json.loads(TILES_FILE.read_text(encoding="utf-8"))["Las Condes"][0]]},
    timeout=60,
)
cors = r_test.headers.get("Access-Control-Allow-Origin", "NO PRESENTE")
print(f"Access-Control-Allow-Origin: {cors}")
print(f"Todos los headers: {dict(r_test.headers)}")
print()

tiles = json.loads(TILES_FILE.read_text(encoding="utf-8"))["Las Condes"]
print(f"Las Condes: {len(tiles)} tiles a consultar (market=multifamily)\n")

all_entities = {}
for i, tile in enumerate(tiles):
    entities = call("multifamily", tile, i, len(tiles))
    for e in entities:
        key = e.get("id") or e.get("name") or f"unknown_{i}"
        all_entities[key] = e
    if i < len(tiles) - 1:
        time.sleep(1.0)

print(f"\n{'='*60}")
print(f"TOTAL proyectos unicos: {len(all_entities)}")
print(f"{'='*60}\n")

# Imprimir primer proyecto completo para ver estructura real
first = list(all_entities.values())[0]
print("=== ESTRUCTURA COMPLETA PRIMER PROYECTO ===")
print(json.dumps(first, indent=2, ensure_ascii=False))

print("\n=== RESUMEN TODOS LOS PROYECTOS ===")
for key, e in all_entities.items():
    loc    = e.get("location") or {}
    period = (e.get("periods") or [{}])[-1]
    claves_period = list(period.keys()) if period else []
    stages = period.get("stages") or []
    progs  = [p for s in stages for p in (s.get("programs") or [])]
    print(f"{e.get('name'):40}  comuna={loc.get('commune') or loc.get('comuna'):15}  "
          f"periodo_claves={claves_period}  stages={len(stages)}  progs={len(progs)}")
