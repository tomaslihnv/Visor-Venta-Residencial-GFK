# Visor de Mercado Inmobiliario

Aplicación web estática para visualizar y analizar datos de mercado inmobiliario desde archivos Excel. Sin servidor, sin build step — se abre directo en el navegador.

## Visores disponibles

| Visor | Archivo | Fuente de datos |
|---|---|---|
| Venta Residencial | `index.html` | Inciti / GFK |
| Renta Residencial | `renta.html` | Inciti / GFK |
| Multifamily | `multifamily.html` | Inciti |

## Funcionalidades

- **Carga de datos**: drag & drop o botón, soporta `.xlsx` / `.xls`
- **Filtros dinámicos**: multi-selección y sliders duales por columna
- **KPIs**: métricas clave calculadas sobre los datos filtrados
- **Mapa**: marcadores + modo de calor con métricas seleccionables (Leaflet + OpenStreetMap)
- **Tabla comparativa**: matriz proyecto × tipología (o flat para multifamily), copiable a Excel
- **Sup. vs Precio/Renta**: scatter con regresión lineal, línea de promedio, marcadores de m²
- **Distribución acumulada**: curva CDF con marcadores de percentil y precio
- **Proyectos**: gráfico de barras comparativo entre proyectos
- **Tabla**: paginada con sort y búsqueda global, exportable a CSV
- **Mi Proyecto**: agrega tu propio proyecto al análisis comparativo
- **Export PNG**: copiar gráficos al portapapeles en alta resolución (4×), con control de proporción

## Cómo ejecutar

```bash
# Opción 1 — Python (recomendado)
python -m http.server 8000

# Opción 2 — Node.js
npx serve .
```

Luego abrir `http://localhost:8000` en el navegador.

> Los módulos JS (`type="module"`) requieren servidor HTTP. No funcionan abriendo el HTML directamente como archivo local.

## Estructura del proyecto

```
├── index.html              ← Venta Residencial
├── renta.html              ← Renta Residencial
├── multifamily.html        ← Multifamily
├── styles.css              ← Importa los tres archivos de styles/
├── CLAUDE.md               ← Guía para crear nuevos visores (leer antes de cambiar)
├── styles/
│   ├── base.css
│   ├── layout.css
│   └── components.css
└── js/
    ├── core/               ← Módulos compartidos (usados por visores nuevos)
    │   ├── utils.js
    │   ├── export.js
    │   ├── filters.js
    │   ├── table.js
    │   ├── kpis.js
    │   ├── chart-proyectos.js
    │   ├── chart-svp.js
    │   ├── chart-distrib.js
    │   ├── map.js
    │   └── comparativa.js
    ├── multifamily/        ← Visor Multifamily (usa core/)
    │   ├── config.js       ← ★ Todo lo específico del visor en un archivo
    │   ├── data.js
    │   ├── miProyecto.js
    │   └── main.js
    ├── renta/              ← Visor Renta Residencial (módulos propios)
    │   └── ...
    └── (raíz)              ← Visor Venta Residencial (módulos propios)
        └── ...
```

## Agregar un nuevo visor

Los visores creados sobre `js/core/` se agregan en 6 pasos:

1. `js/[visor]/config.js` — columnas, filtros, KPIs, métricas (~120 líneas)
2. `js/[visor]/data.js` — carga Excel + normalización (copiar de multifamily)
3. `js/[visor]/miProyecto.js` — panel sidebar (copiar de multifamily, adaptar métricas)
4. `js/[visor]/main.js` — tabs y exports (copiar de multifamily sin cambios)
5. `[visor].html` — copiar `multifamily.html`, cambiar título y métricas del HTML
6. Agregar el link en el `<nav>` de todos los HTMLs

Ver `CLAUDE.md` para instrucciones detalladas con ejemplos de código.

## Tecnologías

| Librería | Versión | Uso |
|---|---|---|
| [Chart.js](https://www.chartjs.org/) | 4.4.1 | Gráficos |
| [chartjs-plugin-annotation](https://www.chartjs.org/chartjs-plugin-annotation/) | 3.0.1 | Líneas de referencia en gráficos |
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Mapas |
| [SheetJS (XLSX)](https://sheetjs.com/) | 0.18.5 | Lectura de Excel |

Todas las dependencias se cargan desde CDN. No hay `package.json` ni proceso de build.
