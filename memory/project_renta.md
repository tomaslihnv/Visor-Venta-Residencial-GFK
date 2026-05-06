---
name: Renta Residencial - Estado del desarrollo
description: Arquitectura, columnas Inciti renta, módulos creados y decisiones de diseño para la sección de renta
type: project
---

Sección de Renta Residencial creada en `renta.html` + `js/renta/` como app separada de la venta.

**Why:** El usuario quiere un visor idéntico al de venta pero adaptado para datos de arriendo.

**How to apply:** Siempre mantener paridad de features entre venta y renta; cuando se agrega algo a uno, considerar el otro.

## Archivos creados
- `renta.html` — Entrada principal, misma estructura que `index.html`
- `js/renta/data.js` — Estado global + normalización Inciti renta
- `js/renta/main.js` — Tab routing y event handlers
- `js/renta/filters.js` — Filtros: Tipología, Corredor, Tipo, Comuna, sliders
- `js/renta/chart.js` — KPIs, CDF distribución, SVP (Útil vs Renta UF), Proyectos
- `js/renta/table.js` — Tabla con columnas __lat/__lng ocultas, Link como <a>
- `js/renta/comparativa.js` — Comparativa por Proyecto/Tipología (métricas: Útil, UF/m², Renta UF, Gastos)
- `js/renta/miProyecto.js` — Mi Proyecto renta (localStorage key: visor_mp_renta_v1)
- `js/renta/map.js` — Mapa Leaflet, coordenadas directas de Inciti (__lat/__lng)

## Normalización Inciti Renta (columnas)
| Excel Inciti | Normalizado |
|---|---|
| Nombre | Proyecto |
| Precio (UF) | Renta UF |
| Precio por m² (UF) | UF/m² |
| Metros Útiles | Útil (m²) |
| Metros Totales | Total (m²) |
| Metros Terraza | Terraza (m²) |
| Gastos Comunes | Gastos Comunes (UF) |
| Link Publicación | Link |
| Tipo de Propiedad | Tipo |
| Dormitorios | → deriva Tipología (1D, 2D, 2D1B, Studio) |
| Latitud/Longitud | __lat / __lng (coordenadas directas) |

## Decisiones de diseño
- Tipología incluye baños: "2D1B", "2D2B" si la data los tiene
- Studio cuando Dormitorios=0
- Distribución siempre en modo CDF (curva acumulada), no histograma
- Anotaciones de percentiles/precios: líneas rojas punteadas cruzadas (vertical + horizontal)
- SVP chart: eje X = Útil (m²), eje Y = Renta UF/mes (no UF/m² como en venta)
- Mi Proyecto calcula Renta UF = Útil × UF/m²
- Comparativa muestra Corredor en lugar de Propietario, y Gastos Comunes
- Navegación: app-nav dark (#0f172a) con links Venta / Renta en ambos HTMLs

## Pendiente
- GFK renta: columnas a definir cuando el usuario tenga el archivo
- Adapter GFK renta en data.js (actualmente solo normaliza Inciti)
