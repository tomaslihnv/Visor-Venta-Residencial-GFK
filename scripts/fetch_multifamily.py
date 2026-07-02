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

API_KEY = os.getenv("INCITI_API_KEY", "").strip()
API_URL = os.getenv("INCITI_API_URL", "").strip()

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


def _build_row(project, tipo_key, periodo):
    loc = project.get("location") or {}
    lat = loc.get("lat") or project.get("lat") or project.get("latitud")
    lng = loc.get("lng") or project.get("lng") or project.get("longitud")

    row = {
        "Proyecto":      project.get("nombre") or project.get("name") or project.get("id") or "",
        "Propietario":   project.get("owner") or project.get("propietario") or "",
        "Administrador": project.get("administrador") or project.get("operator") or project.get("admin") or "",
        "Comuna":        loc.get("comuna") or project.get("comuna") or "",
        "Estado":        project.get("estado") or project.get("status") or "",
        "Reporta":       project.get("reporta") or project.get("reports") or "",
    }

    if lat is not None and lng is not None:
        row["__lat"] = float(lat)
        row["__lng"] = float(lng)

    if tipo_key:
        row["Programa"] = TIPOLOGIA_MAP.get(tipo_key, tipo_key)

    if periodo:
        vacancia = _num(periodo.get("vacancia") or periodo.get("vacancy") or periodo.get("vacancyRate"))
        row["Período"]       = periodo.get("period") or periodo.get("periodo") or periodo.get("quarter") or ""
        row["Stock"]         = _num(periodo.get("stock"))
        row["Disponibilidad"]= _num(periodo.get("disponibilidad") or periodo.get("available") or periodo.get("availability"))
        row["Vacancia (%)"]  = vacancia
        row["Útil (m²)"]     = _num(periodo.get("sup") or periodo.get("area") or periodo.get("m2util") or periodo.get("usableArea"))
        row["Arriendo UF"]   = _num(periodo.get("arriendo") or periodo.get("rentUF") or periodo.get("renta"))
        row["UF/m²"]         = _num(periodo.get("ufm2") or periodo.get("rentUFm2") or periodo.get("rentPerM2"))
        row["Ocupación (%)"] = (
            round((1 - vacancia / 100) * 100, 1) if vacancia is not None
            else _num(periodo.get("ocupacion") or periodo.get("occupancy"))
        )

    return row


def flatten_project(project):
    rows = []
    tipo_series = project.get("tipologias") or project.get("series") or project.get("units") or {}

    if not tipo_series:
        rows.append(_build_row(project, None, None))
        return rows

    for tipo_key, tipo_data in tipo_series.items():
        series = tipo_data.get("series") if isinstance(tipo_data, dict) else tipo_data
        periodo = _last_period(series)
        if not periodo:
            continue
        rows.append(_build_row(project, tipo_key, periodo))

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

    projects = payload.get("projects") or []
    print(f"Proyectos recibidos: {len(projects)}")

    if not projects:
        print("⚠ Sin proyectos. Revisa el polígono y la respuesta:")
        print(json.dumps(payload, indent=2, ensure_ascii=False)[:2000])
        sys.exit(1)

    # Imprimir estructura del primer proyecto para validar mapeo
    print("\n── Primer proyecto (estructura cruda) ──")
    print(json.dumps(projects[0], indent=2, ensure_ascii=False)[:3000])
    print("────────────────────────────────────────\n")

    rows = []
    for p in projects:
        rows.extend(flatten_project(p))

    rows_validos = [r for r in rows if r.get("Arriendo UF") and r["Arriendo UF"] > 0]
    print(f"Filas con arriendo válido: {len(rows_validos)} / {len(rows)} totales")

    if not rows_validos:
        print("⚠ Ninguna fila con arriendo válido. Revisa _build_row y los nombres de campo.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fecha = datetime.now().strftime("%Y%m%d")
    out_path = OUTPUT_DIR / f"multifamily_api_{fecha}.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows_validos, f, ensure_ascii=False, indent=2, default=str)

    print(f"✓ Guardado en: {out_path}")
    print(f"  {len(rows_validos)} filas listas para el visor")


if __name__ == "__main__":
    main()
