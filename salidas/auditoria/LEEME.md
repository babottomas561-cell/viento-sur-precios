# Auditoría del tablero

1. `esperado.py` calcula, directo de `datos/viento_sur.xlsx` (sin pasar por `armar_excel.py`), qué tendría que mostrar cada pestaña
   en 17 combinaciones de filtros (fechas incluidas): ventas, stock al corte de la fecha "hasta", % vendido, vencido, % de lo esperado,
   lotes sin ventas y frenados, cada sucursal, descuentos, sugerencias aceptadas y las filas de cada tabla de Datos.
2. `auditar_filtros.js` abre cada combinación en todas las pestañas del tablero (y el gráfico de stock con cada apertura) y compara
   cada cifra con `esperado.json`. También anota cualquier error de JavaScript.

```
.venv/bin/python salidas/auditoria/esperado.py
```

Después, con el tablero abierto, en la consola del navegador:
- en la computadora (http://localhost:8765/web/index.html): `(await import('/salidas/auditoria/auditar_filtros.js')).default()`
- en el sitio publicado: `(await import('/auditoria/auditar_filtros.js')).default(await (await fetch('/auditoria/esperado.json')).json())`

Último resultado (17/10/2026): 17 combinaciones, 763 chequeos, sin diferencias. La misma auditoría sobre la versión anterior
del tablero encontró 69 diferencias: en Stock y Sucursales las cifras no seguían el filtro de fechas (corregido).
