"""
Proxy local para la API de Inciti — resuelve el error de CORS en desarrollo.
El visor llama a http://localhost:5050/get_insights_pro y este script
lo reenvía a https://api.inciti.com/api/get_insights_pro.

Uso:
  pip install flask requests python-dotenv
  python scripts/proxy.py

Dejar corriendo en una terminal aparte mientras usas el visor.
"""

import os
from pathlib import Path
from dotenv import load_dotenv
import requests
from flask import Flask, request, jsonify

load_dotenv(Path(__file__).parent.parent / ".env")

# En .env: INCITI_API_KEY tiene la URL y INCITI_API_URL tiene el UUID (key)
API_KEY     = os.getenv("INCITI_API_URL", "").strip()
INCITI_BASE = os.getenv("INCITI_API_KEY", "").strip().rstrip("/")
PORT        = 5050

app = Flask(__name__)


def _cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@app.after_request
def after(response):
    return _cors(response)


@app.route("/<path:path>", methods=["OPTIONS"])
def preflight(path):
    return _cors(jsonify({}))


@app.route("/<path:path>", methods=["POST"])
def proxy(path):
    url = f"{INCITI_BASE}/{path}"
    try:
        r = requests.post(
            url,
            json=request.get_json(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            timeout=60,
        )
        return (r.content, r.status_code, {"Content-Type": "application/json"})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    print(f"Proxy corriendo en http://localhost:{PORT}")
    print(f"Reenviando a: {INCITI_BASE}")
    app.run(port=PORT, debug=False)
