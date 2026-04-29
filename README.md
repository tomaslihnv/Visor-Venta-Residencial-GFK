# Visor Venta Residencial GFK

Aplicación web para visualizar y analizar datos de ventas residenciales desde archivos Excel.

## Estructura del Proyecto

```
Visor-Venta-Residencial-GFK/
├── index.html          # Estructura principal
├── styles/
│   ├── base.css        # Reset, tipografía, colores base
│   ├── layout.css      # Grid, sidebar, header
│   ├── components.css  # Componentes UI (tabs, table, chart, etc.)
│   └── styles.css      # Archivo principal que importa los demás
├── js/
│   ├── utils.js        # Funciones auxiliares
│   ├── data.js         # Carga y procesamiento de datos Excel
│   ├── filters.js      # Construcción y aplicación de filtros
│   ├── table.js        # Renderizado de tabla, paginación, búsqueda
│   ├── chart.js        # Controles y renderizado de gráficos
│   ├── map.js          # Funcionalidad del mapa (placeholder)
│   └── main.js         # Inicialización y eventos globales
├── prueba.py           # Script Python (vacío, para backend futuro)
└── README.md           # Esta documentación
```

## Funcionalidades

- **Carga de Datos**: Arrastrar o seleccionar archivos Excel (.xlsx, .xls) con hoja "Datos".
- **Filtros Dinámicos**: Filtros automáticos por columna (rangos numéricos, selección múltiple, búsqueda de texto).
- **Tabla Interactiva**: Vista tabular con ordenamiento, paginación y búsqueda global.
- **Gráficos**: Barras, líneas, dispersión, torta con controles de agregación y agrupamiento.
- **Mapa**: Visualización geográfica automática usando direcciones (geocodificación con OpenStreetMap).
- **Exportación**: CSV de datos filtrados y PNG de gráficos.

## Cómo Ejecutar

1. Clona o descarga el proyecto.
2. Abre una terminal en la carpeta del proyecto.
3. Ejecuta un servidor HTTP:
   ```bash
   python -m http.server 8000
   ```
4. Abre http://localhost:8000 en tu navegador.

## Tecnologías

- **Frontend**: HTML5, CSS3, JavaScript (ES6 Modules)
- **Librerías**: Chart.js, XLSX, Leaflet
- **Estilo**: Diseño responsive con CSS Grid y Flexbox

## Desarrollo

El código está modularizado para facilitar el mantenimiento:
- `utils.js`: Utilidades compartidas.
- `data.js`: Gestión del estado y carga de archivos.
- `filters.js`: Lógica de filtros.
- `table.js`: Renderizado de tabla.
- `chart.js`: Gráficos y KPIs.
- `main.js`: Eventos principales.

Para agregar nuevas funcionalidades, edita los módulos correspondientes.