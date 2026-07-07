"""
Descarga datos de todas las comunas configuradas para el visor multifamily.

Uso:
  python scripts/fetch_all_comunas.py
"""

import subprocess
import sys
from pathlib import Path

PYTHON = sys.executable
SCRIPT = Path(__file__).parent / "fetch_comuna.py"

COMUNAS = [
    "Santiago",
    "Estación Central",
    "Las Condes",
    "Lo Barnechea",
    "Providencia",
    "Ñuñoa",
]

MARKET = "multifamily"

for comuna in COMUNAS:
    print(f"\n{'='*60}")
    print(f"Procesando: {comuna}")
    print('='*60)
    result = subprocess.run([PYTHON, str(SCRIPT), comuna, MARKET])
    if result.returncode != 0:
        print(f"ERROR en {comuna} — continuando con la siguiente...")
