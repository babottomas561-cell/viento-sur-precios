# Auditoría de filtros del tablero

1. `esperado.py` calcula, directo de `datos/viento_sur.xlsx` (sin pasar por `armar_excel.py`), qué tendría que mostrar el tablero
   en 13 combinaciones de filtros: productos, lotes, stock, unidades y pesos vendidos, filas de ventas.
2. `auditar_filtros.js` abre cada combinación en las 9 vistas del tablero (7 pestañas + Datos › lotes y Datos › ventas)
   y compara cada número con `esperado.json`. También anota cualquier error de JavaScript.

```
.venv/bin/python salidas/auditoria/esperado.py
```
Después, con el tablero abierto en http://localhost:8765/web/index.html, en la consola del navegador:
`(await import('/salidas/auditoria/auditar_filtros.js')).default()`

Último resultado (17/10/2026): 13 combinaciones × 9 vistas, sin diferencias.
