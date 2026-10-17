# Viento Sur · Nota de la propuesta (datos al 15/03/2026)

## El problema y la propuesta
Hay 5.006 u en stock y 35 de 48 productos venden menos del 90 % de lo esperado; el 57 % del stock (2.851 u) ya pasó su fecha límite. No es un solo problema: cada producto cae en uno de 9 grupos (reglas en orden, la primera que se cumple), contados en 5 causas con su solución.

| causa | productos | stock | la prueba | qué hacemos | cómo se mide |
|---|---|---|---|---|---|
| **No es un problema** | 13 | 783 u (16 %) | venden 133 % o más de lo esperado; stock para 13 a 25 días | Dejar el precio, reponer y mover stock | días de stock (mínimo 15); sobrante proyectado |
| **Ejecución** | 11 | 1.394 u (28 %) | 8 de 21 descuentos aprobados se cobraron; campañas: 0 u con rebaja | Cobrar lo aprobado, con fechas | precio cobrado contra lista; después, unidades por semana |
| **Producto o ubicación** | 12 | 1.180 u (24 %) | 3 nunca vendieron; 5 se cortaron sin cambiar el precio; 4 venden solo en otro local | Contar, exhibir, mover o investigar | primera venta en 15 días |
| **Compra** | 4 | 581 u (12 %) | margen 17 % a 20 % contra 41 % a 42 % de sus pares | Negociar con Cumbre | unidades devueltas o bonificadas (meta 503) |
| **Puede ser precio** | 8 | 1.068 u (21 %) | botas +50 % y mochilas +42 % con descuento; el resto casi no respondió | Probar descuento 4 semanas en 3 | unidades por semana (3,7 → 5,7) contra una sucursal sin descuento |

**El mensaje central:** solo el 21 % del stock (1.068 u) está en productos donde el precio puede ser la causa, y aun ahí el descuento pasa los criterios en 3 de 8. Descontar 39 de 48, como la consultora, cede margen sin atacar la causa.

- **Descuento ya, a prueba (4):** Pelota del rio 36 (10 %, el ya aceptado), Bota de la niebla 18 (20 %), Zapatilla del rio 12 (10 %), Mochila de la costa 14 (20 %).
- **Descuento si se cumple una condición (6):** Bota del cerro 27, Mochila del valle 37, Mochila de la quebrada 35, Zapatilla de la costa 38, Bota de la laguna 40, Zapatilla del cerro 39.
- **Criterios:** su tipo respondió (botas, mochilas con suba clara; zapatillas débil: solo se prueba) y queda al menos 15 % de margen. Todo descuento va con fechas, 4 semanas, y se mide también el mes siguiente.
- **Stock vencido:** primero la solución de su causa; si no funcionó, liquidar con fechas (20 % y después 35 %, 14 días cada uno; después devolución u outlet), nunca debajo del costo. Última salida: 29/05/2026.

Cada causa en cuatro pasos (qué pasa, la prueba, qué hacemos, cómo lo medimos): [`causas.md`](causas.md) y la primera pantalla del tablero. Los 48 con acción, motivo, indicadores, meta y fecha de revisión: hoja **Propuesta** y la ficha de cada producto.

## Qué miré
- **Ritmo del lote** (la cuenta de la consigna), lote por lote.
- **Por qué no vende cada uno**: el mismo producto en otras sucursales, los de su tipo, la última venta, campañas, cambios de precio y sugerencias anteriores.
- **Los 8 descuentos aplicados**: cuánto cambió la venta durante, con su margen de error, contra un control sin cambios, y qué pasó el mes siguiente.

## Qué interpreté
- La decisión de precio es una por producto; las sucursales sirven para entender por qué no vende.
- Una sugerencia aceptada sin fechas de vigencia no se aplicó: no se ve en el precio cobrado.
- Un producto lento responde al descuento como el de su tipo que se descontó (con los límites de abajo).
- La fecha límite marca la urgencia, no el diagnóstico: un producto vencido que nunca se exhibió, primero se exhibe.
- El stock de cada día se reconstruye desde el del 15/03: supone que no hubo reposiciones ni transferencias.

## Qué dejé afuera y qué limita la evidencia
- Las 22 sugerencias aceptadas sin fechas, y las diferencias por sucursal en la respuesta al precio (con 2 locales y pocas ventas no salen del margen de error).
- **La respuesta al descuento se midió en productos que venden bien**: para los lentos, el efecto esperado es un techo. Es un producto por tipo, en 2 sucursales y las mismas 4 semanas, con un control de 2 productos. Por eso todo descuento es una prueba; cuando haya uno medido en un producto lento, el proceso usa ese.
- **La temporada de cada tipo**: no hay datos de otros años. El control solo descuenta el movimiento general de esas semanas; la temporada de cada producto se va a ver con la sucursal de comparación de cada prueba.
- Talles (no hay datos), el costo de tener el stock quieto y el efecto de reponer, mover u outlet (no se pueden medir).

## Cómo estimo el efecto en 30 días
Con lo que pasó antes con el mismo descuento (mismo tipo y mismo %), descontado el movimiento general de esas semanas, en tres escenarios: la peor sucursal, todas juntas y la mejor. Donde no se toca el precio, el efecto de precio es cero.

| producto | descuento | medido en | para empatar tiene que vender | margen en 30 días: peor / todas / mejor |
|---|---|---|---|---|
| Pelota del rio 36 | 10 % | Pelota del muelle 7 | +32 % | −$ 23.761 / −$ 8.843 / +$ 14.681 |
| Bota de la niebla 18 | 20 % | Bota de la costa 2 | +81 % | −$ 37.073 / −$ 26.008 / −$ 16.845 |
| Zapatilla del rio 12 | 10 % | Zapatilla del valle 1 | +28 % | +$ 9.263 / +$ 46.977 / +$ 94.977 |
| Mochila de la costa 14 | 20 % | Mochila de la estepa 8 | +111 % | −$ 28.248 / −$ 23.863 / −$ 18.808 |

**En 30 días**: 23 → 32,0 u (entre 27,0 y 38,7) y −$ 11.736 de margen (entre −$ 79.819 y +$ 74.006); sumando el mes siguiente, entre −$ 77.707 y +$ 50.055. El descuento mueve poco: el stock quieto sale sobre todo por las otras acciones. La escalera no tiene efecto estimado (arriba de 20 % no hay evidencia): cada escalón se mide.

## Juicio sobre la consultora
**Tomaría solo una parte.** Descuenta en 39 de 48 productos; esta propuesta, en 4 ya y 6 con condición. Coinciden en 19 de 48.
- **Tomo** su "no descontar" donde la venta acompaña al stock, y descontar productos lentos de los tipos que respondieron (botas, mochilas), con el porcentaje probado en cada tipo.
- **Reemplazo el resto**: usa el precio para problemas que no son de precio, los de las otras 4 causas de la tabla.
- **Errores que se comprueban con las hojas**: en 12 productos proyecta vender más de lo que hay en stock y en 4 vende bajo costo.

## Dos hallazgos
- **Lo aprobado no llega a caja**: de las 21 sugerencias aceptadas que se pueden verificar en las ventas, solo 8 se ven en el precio cobrado. Antes que un mejor algoritmo, hace falta que lo aprobado se aplique.
- **Los objetivos no buscan vender todo el stock**: los 3 recién llegados venden al ritmo de su objetivo y aun así les sobraría entre el 58 % y el 76 % a la fecha límite. Parte del stock quieto empieza en cuánto se compra.

## Herramientas de IA
Claude (Claude Code) como asistente de programación y análisis: leer los datos, escribir y revisar el código, armar el Excel y el tablero, y redactar. Los criterios los discutí y elegí yo. Las cifras salen del script y se verificaron contra un cálculo independiente hecho directo del Excel original.