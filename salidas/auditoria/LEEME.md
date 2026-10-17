# Auditoría

Todo se verifica contra un cálculo hecho **directo del Excel original** (`datos/viento_sur.xlsx`), sin usar el código del proceso.

| Qué | Cómo se corre | Último resultado (17/10/2026) |
|---|---|---|
| **Las decisiones**: las 9 reglas, los criterios del descuento, la escalera del stock vencido, el sobrante del grupo 2, la consultora, la causa de cada producto, los indicadores de su ficha (ventas con rebaja) y las cifras de la nota (tabla de causas, Cumbre, lotes vencidos), reimplementados por otro camino | `python salidas/auditoria/auditar_decisiones.py` | Coinciden los 48 productos |
| **La planilla**: los 100 lotes indicador por indicador, cada sucursal del Resumen y los productos de la Propuesta | `python salidas/auditoria/auditar_excel.py` | 1.031 chequeos, sin diferencias |
| **Descuentos**: los 16 casos (antes, durante, después, pesos y margen), el control, el índice semanal y los netos | `python salidas/auditoria/auditar_descuentos.py` | 318 chequeos, sin diferencias |
| **El tablero**: 17 combinaciones de filtros (fechas incluidas) en todas las pestañas | `esperado.py` + `auditar_filtros.js` en el navegador | 779 chequeos en el sitio, sin diferencias |
| **Los gráficos de Ventas**: cada punto de cada serie (día, semana, mes × 6 aperturas × unidades y pesos), la participación y el ranking | `esperado_ventas.py` + `auditar_ventas.js` en el navegador | 252 gráficos, 29.244 puntos, sin diferencias |

Los dos del navegador se corren con el tablero abierto, en la consola:
- en la computadora (http://localhost:8765/web/index.html): `(await import('/salidas/auditoria/auditar_filtros.js')).default()` y lo mismo con `auditar_ventas.js`
- en el sitio publicado: `(await import('/auditoria/auditar_filtros.js')).default(await (await fetch('/auditoria/esperado.json')).json())`, y lo mismo con `auditar_ventas.js` y `esperado_ventas.json`

**Lo que no se puede reproducir número por número** es el margen de error (bootstrap): se contrasta su conclusión con un intervalo exacto de Poisson.
Coinciden en 15 de 16 casos sobre si la suba es firme; el bootstrap es el más prudente.

**Qué encontró la auditoría y se corrigió:** las cifras de Stock y Sucursales no seguían el filtro de fechas; el proceso se rompía con
productos sin stock; las fechas en texto daban un error genérico; los empates en el corte de los gráficos dependían del orden de los datos;
"8 de 30 aceptadas llegaron a caja" pasó a "8 de las 21 que se pueden verificar".
