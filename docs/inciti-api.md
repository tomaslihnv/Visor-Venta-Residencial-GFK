# API de Inciti — Referencia de datos

## Endpoint

```
POST /get_insights_pro
Header: X-API-Key: <tu_api_key>
Header: Content-Type: application/json
```

Límites:
- **100 requests/día** (`X-Ratelimit-Limit` header)
- **25 km² máximo** por polígono consultado
- Solo acepta Origins en whitelist (actualmente solo `app.inciti.com`)

---

## Request

```json
{
  "market": "multifamily",
  "polygons": [
    [
      { "lat": -33.390, "lng": -70.620 },
      { "lat": -33.390, "lng": -70.575 },
      { "lat": -33.415, "lng": -70.575 },
      { "lat": -33.415, "lng": -70.620 },
      { "lat": -33.390, "lng": -70.620 }
    ]
  ]
}
```

- `market`: tipo de mercado. Actualmente usamos `"multifamily"`. Otros posibles: `"residencial"`, `"oficinas"`, etc.
- `polygons`: arreglo de polígonos (lat/lng). Cada polígono debe cerrar (primer punto = último punto) y cubrir menos de 25 km².

---

## Response — estructura general

```
{
  "projects": {
    "entities": [ <proyecto>, <proyecto>, ... ]
  }
}
```

Cada `entity` (proyecto) tiene esta forma:

```json
{
  "id":            "abc123",
  "name":          "Torre Alameda",
  "owner":         "Inmobiliaria XYZ",
  "administrator": "Administradora ABC",
  "location": {
    "lat":     -33.4045,
    "lng":     -70.6062,
    "commune": "Santiago"
  },
  "periods": [ <período>, <período>, ... ]
}
```

---

## Proyecto (`entity`)

| Campo           | Tipo   | Descripción                                |
|-----------------|--------|--------------------------------------------|
| `id`            | string | Identificador único del proyecto           |
| `name`          | string | Nombre del edificio/proyecto               |
| `owner`         | string | Propietario (empresa dueña del activo)     |
| `administrator` | string | Empresa que lo administra                  |
| `location.lat`  | number | Latitud                                    |
| `location.lng`  | number | Longitud                                   |
| `location.commune` | string | Comuna                                  |
| `periods`       | array  | Historial de períodos trimestrales         |

---

## Período (`period`)

Cada proyecto puede tener varios períodos. El más reciente es `periods[-1]`.

```json
{
  "key":   "2024-Q1",
  "label": "Q1 2024",
  "year":  2024,
  "n":     1,
  "programs": [ <programa>, <programa>, ... ]
}
```

| Campo      | Tipo   | Descripción                              |
|------------|--------|------------------------------------------|
| `key`      | string | Período en formato `"YYYY-Qn"`           |
| `label`    | string | Etiqueta legible, ej: `"Q1 2024"`        |
| `year`     | number | Año                                      |
| `n`        | number | Número de trimestre (1–4)                |
| `programs` | array  | Unidades agrupadas por tipología         |

---

## Programa (`program`) — el dato real de mercado

Un programa es una tipología dentro del edificio (ej: 1D1B, 2D2B, Estudio).

```json
{
  "program":    "2D2B",
  "status":     "Arrendado",
  "stock":      80,
  "available":  6,
  "vacancy":    0.075,
  "usefulM2":   58.3,
  "rentUF":     18.5,
  "rentUfPerM2": 0.317
}
```

| Campo          | Tipo   | Descripción                                          |
|----------------|--------|------------------------------------------------------|
| `program`      | string | Tipología: `"ESTUDIO"`, `"1D1B"`, `"2D1B"`, `"2D2B"`, etc. |
| `status`       | string | Estado del programa en ese período                   |
| `stock`        | number | Total de unidades de esa tipología en el edificio    |
| `available`    | number | Unidades disponibles (vacantes)                      |
| `vacancy`      | number | Tasa de vacancia **en fracción** (ej: 0.075 = 7.5%) |
| `usefulM2`     | number | Superficie útil promedio en m²                       |
| `rentUF`       | number | Arriendo promedio en UF                              |
| `rentUfPerM2`  | number | Arriendo promedio en UF/m²                           |

> **Ojo con `vacancy`**: la API entrega un número entre 0 y 1. Para mostrar como porcentaje hay que multiplicar × 100. En nuestros JSONs ya está convertido como `"Vacancia (%)"`.

---

## Cómo consultamos nosotros

Como la API solo acepta polígonos de <25 km², dividimos cada comuna en **tiles de 4.95 km × 4.95 km ≈ 24.5 km²**, clipados contra el polígono real de la comuna (no el bounding box). Esto evita traer proyectos de comunas vecinas.

El proceso completo está en `scripts/fetch_comuna.py`. Para correr las 6 comunas de una vez:

```bash
python scripts/fetch_all_comunas.py
```

Esto genera dos archivos JSON por comuna en `data/multifamily/`:

| Archivo | Contenido |
|---------|-----------|
| `multifamily_{comuna}_{fecha}.json` | Solo el **último período** disponible por proyecto. Es lo que carga el visor principal. |
| `multifamily_{comuna}_historico_{fecha}.json` | **Todos los períodos** históricos. Es lo que carga la pestaña Histórico. |

---

## Campos en nuestros JSONs (tras normalización)

Cuando `fetch_comuna.py` descarga y aplana los datos, cada fila tiene:

| Campo          | Fuente API          | Descripción                          |
|----------------|---------------------|--------------------------------------|
| `Proyecto`     | `entity.name`       | Nombre del edificio                  |
| `Propietario`  | `entity.owner`      | Empresa propietaria                  |
| `Administrador`| `entity.administrator` | Empresa administradora            |
| `Comuna`       | `location.commune`  | Comuna                               |
| `__lat`        | `location.lat`      | Latitud (para el mapa)               |
| `__lng`        | `location.lng`      | Longitud (para el mapa)              |
| `Período`      | `period.label`      | Ej: `"Q1 2024"` (solo en histórico)  |
| `Período Key`  | `period.key`        | Ej: `"2024-Q1"` (para ordenar)       |
| `Año`          | `period.year`       | (solo en histórico)                  |
| `Trimestre`    | `period.n`          | 1–4 (solo en histórico)              |
| `Programa`     | `program.program`   | Tipología: 1D1B, 2D2B, etc.          |
| `Stock`        | `program.stock`     | Total unidades de esa tipología      |
| `Disponibilidad`| `program.available`| Unidades vacantes                    |
| `Vacancia (%)`  | `program.vacancy × 100` | % de vacancia                  |
| `Ocupación (%)` | `100 - Vacancia (%)` | % de ocupación                  |
| `Útil (m²)`    | `program.usefulM2`  | Superficie útil promedio             |
| `Arriendo UF`  | `program.rentUF`    | Arriendo promedio en UF              |
| `UF/m²`        | `program.rentUfPerM2` | Arriendo por m²                   |
| `Estado Prog.` | `program.status`    | Estado del programa en ese período   |
