# Auditoría

Todo se verifica contra un cálculo hecho **directo del Excel original** (`datos/viento_sur.xlsx`), sin usar el código del proceso.

| Qué | Cómo se corre | Último resultado (17/10/2026) |
|---|---|---|
| **Las decisiones**: las 9 reglas, los criterios del descuento, la escalera del stock vencido, el sobrante del grupo 2, la consultora, la causa de cada producto, los indicadores de su ficha (ventas con rebaja) y las cifras de la nota (tabla de causas, Cumbre, lotes vencidos, aceptadas que llegaron a caja, proyecciones de la consultora, reparto del stock vencido), reimplementados por otro camino | `python salidas/auditoria/auditar_decisiones.py` | Coinciden los 48 productos |
| **La planilla**: los 100 lotes indicador por indicador, cada sucursal del Resumen y los productos de la Propuesta | `python salidas/auditoria/auditar_excel.py` | 1.031 chequeos, sin diferencias |
| **Descuentos**: los 16 casos (antes, durante, después, pesos y margen), el control, el índice semanal y los netos | `python salidas/auditoria/auditar_descuentos.py` | 318 chequeos, sin diferencias |
| **El seguimiento**: cada recomendación medida otra vez desde el Excel (unidades por semana, precio cobrado, si se ve en caja y si cumple su regla, que es la misma meta de la ficha), y que "ya llegaron a su revisión" y "en curso" no se pisen | `python salidas/auditoria/auditar_seguimiento.py` (con más de un Excel cargado) | Con un solo Excel no hay nada que medir; probado con tres cortes del mismo Excel: 241 chequeos, sin diferencias |
| **El tablero**: 17 combinaciones de filtros (fechas incluidas) en todas las pestañas | `esperado.py` + `auditar_filtros.js` en el navegador | 763 chequeos en la computadora y en el sitio publicado, sin diferencias |
| **Los gráficos de Ventas**: cada punto de cada serie (día, semana, mes × 6 aperturas × unidades y pesos), la participación y el ranking | `esperado_ventas.py` + `auditar_ventas.js` en el navegador | 252 gráficos, 29.244 puntos, sin diferencias |

Los dos del navegador se corren con el tablero abierto, en la consola:
- en la computadora (http://localhost:8765/web/index.html): `(await import('/salidas/auditoria/auditar_filtros.js')).default()` y lo mismo con `auditar_ventas.js`
- en el sitio publicado: `(await import('/auditoria/auditar_filtros.js')).default(await (await fetch('/auditoria/esperado.json')).json())`, y lo mismo con `auditar_ventas.js` y `esperado_ventas.json`

**Lo que no se puede reproducir número por número** es el margen de error (bootstrap): se contrasta su conclusión con un intervalo exacto de Poisson.
Coinciden en 15 de 16 casos sobre si la suba es firme; el bootstrap es el más prudente.

**Qué encontró la auditoría y se corrigió:** las cifras de Stock y Sucursales no seguían el filtro de fechas; el proceso se rompía con
productos sin stock; las fechas en texto daban un error genérico; los empates en el corte de los gráficos dependían del orden de los datos;
"8 de 30 aceptadas llegaron a caja" pasó a "8 de las 21 que se pueden verificar".

**En la auditoría contra la consigna (17/10/2026):**
- "8 de 21" pasó a **8 de 20**: Pelota del rio 36 no vendió nada desde que se aceptó su descuento (11/03), así que no hay precio cobrado que mirar. La auditoría ahora lo comprueba venta por venta, con la lista vigente de cada día.
- **El plan B del stock vencido** liquidaba con 20 % y 35 % también productos cuyo tipo no respondió al descuento, y en los descuentos condicionales las fechas de la prueba y de la escalera se pisaban. Ahora la rebaja solo va donde el tipo respondió (8 productos); los otros 24 van directo a devolución u outlet, y la prueba de la condición es el primer escalón.
- **La nota** decía que los 13 de "No es un problema" tenían stock para 13 a 25 días: eso vale para los 10 que venden bien, no para los 3 recién llegados. Ahora explica también por qué se prueban dos descuentos que pierden margen en 30 días (stock vencido que no se vende ni en un año) y respalda con datos el juicio sobre las proyecciones de la consultora.
- **El seguimiento** medía otra cosa que la ficha en tres casos (recién llegados, cortes y mal ubicados). Ahora cada regla es la meta de su ficha.
- **El gráfico por sucursal de Descuentos** era difícil de leer, no seguía el filtro de sucursal y en celular el texto quedaba ilegible. Se rehízo con barras en unidades por día (sin y con descuento) y el veredicto en palabras.
