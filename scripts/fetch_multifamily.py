"""
Descarga datos de Multifamily desde la API de Inciti y los guarda como JSON
en data/multifamily/ para que el visor los cargue como dataset guardado.

Uso:
  python scripts/fetch_multifamily.py

Requiere:
  pip install requests python-dotenv

Las credenciales se leen desde .env en la raíz del proyecto:
  INCITI_API_KEY=...
  INCITI_API_URL=https://api.inciti.com/api/
"""

import json
import os
import sys
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

# ── Config ─────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

# En .env: INCITI_API_KEY tiene la URL y INCITI_API_URL tiene el UUID (key)
API_KEY = os.getenv("INCITI_API_URL", "").strip()
API_URL = os.getenv("INCITI_API_KEY", "").strip()

if not API_KEY or not API_URL:
    sys.exit("Faltan credenciales. Completa INCITI_API_KEY e INCITI_API_URL en .env")

ENDPOINT = API_URL.rstrip("/") + "/get_insights_pro"
OUTPUT_DIR = ROOT / "data" / "multifamily"

# Polígono(s) a consultar. Editar según el área de interés.
DEFAULT_POLYGONS = [
    [
        {"lat": -33.3489, "lng": -70.7432},
        {"lat": -33.3489, "lng": -70.5098},
        {"lat": -33.6489, "lng": -70.5098},
        {"lat": -33.6489, "lng": -70.7432},
    ]
]

# ── Normalización ──────────────────────────────────────────────────────────

TIPOLOGIA_MAP = {
    "ESTUDIO": "Estudio",
    "1D1B": "1D1B",
    "2D1B": "2D1B",
    "2D2B": "2D2B",
    "3D2B": "3D2B",
}


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _last_period(series):
    if not isinstance(series, list) or not series:
        return None
    return series[-1]


def flatten_project(entity):
    """
    Estructura real de la API (producción):
      entity.owner, entity.administrator
      entity.periods[-1].programs[]
        .program, .stock, .available, .vacancy
        .usefulM2, .rentUF, .rentUfPerM2, .status
    """
    rows = []
    loc    = entity.get("location") or {}
    lat    = loc.get("lat")
    lng    = loc.get("lng")
    period = (entity.get("periods") or [None])[-1]
    if not period:
        return rows

    base = {
        "Proyecto":      entity.get("name") or entity.get("id") or "",
        "Propietario":   entity.get("owner") or "",
        "Administrador": entity.get("administrator") or "",
        "Comuna":        loc.get("commune") or loc.get("comuna") or "",
        "Período":       period.get("label") or period.get("key") or "",
    }
    if lat is not None and lng is not None:
        base["__lat"] = float(lat)
        base["__lng"] = float(lng)

    for prog in (period.get("programs") or []):
        stock   = _num(prog.get("stock"))
        avail   = _num(prog.get("available"))
        vac_raw = _num(prog.get("vacancy"))
        vac_pct = round(vac_raw * 100, 1) if vac_raw is not None else None

        rows.append({
            **base,
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

def fetch(polygons=None):
    body = {
        "market": "multifamily",
        "polygons": polygons or DEFAULT_POLYGONS,
    }

    print(f"POST {ENDPOINT}")
    r = requests.post(
        ENDPOINT,
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        json=body,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def main():
    payload = fetch()

    entities = (payload.get("projects") or {}).get("entities") or []
    print(f"Proyectos recibidos: {len(entities)}")

    if not entities:
        print("Sin proyectos. Revisa el poligono y la respuesta:")
        print(json.dumps(payload, indent=2, ensure_ascii=True)[:2000])
        sys.exit(1)

    rows = []
    for p in entities:
        rows.extend(flatten_project(p))

    rows_validos = [r for r in rows if r.get("Arriendo UF") and r["Arriendo UF"] > 0]
    print(f"Filas con precio valido: {len(rows_validos)} / {len(rows)} totales")

    if not rows_validos:
        print("Sin filas con precio valido. Revisa flatten_project y los nombres de campo.")
        print("Primera fila cruda:", json.dumps(rows[0] if rows else {}, indent=2, ensure_ascii=True))
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fecha = datetime.now().strftime("%Y%m%d")
    out_path = OUTPUT_DIR / f"multifamily_api_{fecha}.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows_validos, f, ensure_ascii=False, indent=2, default=str)

    print(f"OK Guardado en: {out_path}")
    print(f"  {len(rows_validos)} filas listas para el visor")


if __name__ == "__main__":
    main()
