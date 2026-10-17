# Viento Sur · Nota de la propuesta (datos al 15/03/2026)

## Qué propongo
Primero entender por qué no vende cada producto; el precio se toca solo si ese es el problema. Cada producto cae en uno de 9 grupos (reglas en orden, la primera que se cumple) y el grupo define la acción. El descuento se evalúa solo donde el grupo lo admite, con los mismos criterios para todos: que su tipo haya respondido a un descuento (botas, mochilas de forma firme; zapatillas débil, entonces como mucho se prueba) y que quede al menos 15 % de margen.

- **Descuento ya, a prueba y medido: 3** — Pelota del rio 36 (aplicar el 10 % aceptado, con fechas), Zapatilla del rio 12 (probar 10 % por 4 semanas), Mochila de la costa 14 (probar 20 % por 4 semanas).
- **Descuento si se cumple una condición: 5** — Bota del cerro 27, Mochila del valle 37, Zapatilla de la costa 38, Bota de la laguna 40, Zapatilla del cerro 39.
- **Sin descuento: 40**. Venden bien, recién llegaron, nunca vendieron, se cortaron, están mal ubicados o no tienen margen: la acción es reponer, mover stock entre sucursales, revisar exhibición y stock físico, o devolver y negociar con el proveedor.
- Todo descuento va con fechas (para que se vea en caja), dura 4 semanas y se mide también el mes siguiente. La acción, el motivo, la meta y la fecha de revisión de los 48 están en la hoja **Propuesta**.

## Qué miré
- **Ritmo del lote** (la cuenta de la consigna): 35 de 48 productos venden menos del 90 % de lo esperado y el 57 % del stock ya pasó su fecha límite.
- **Por qué no vende cada uno**: el mismo producto en otras sucursales, los de su mismo tipo, la última venta, campañas, cambios de precio y sugerencias anteriores.
- **Los 8 descuentos aplicados** (uno por tipo): cuánto cambió la venta durante, con un rango por azar, corregido por un grupo de control sin cambios, y qué pasó el mes siguiente. En botas, sabanas, pelotas, mochilas la venta cayó después (se adelantaron compras).

## Qué interpreté
- La decisión de precio es una por producto (la consigna la pide por producto); las sucursales se usan para entender por qué no vende.
- Una sugerencia aceptada sin fechas de vigencia no se aplicó: no se ve en el precio cobrado.
- Un producto lento responde al descuento como respondió el producto de su mismo tipo que se descontó.
- El stock de cada día se reconstruye desde la foto sumando lo vendido después: supone que no hubo reposiciones ni transferencias.

## Qué dejé afuera
- Las 22 sugerencias aceptadas sin fechas (de 30): no sirven para medir el efecto.
- Diferencias por sucursal en la respuesta al precio: con 2 locales por producto y pocas ventas por día no se distinguen del azar.
- Temporada y talles: no hay años anteriores ni talles. El costo de tener el stock quieto y el valor de reponer, mover u outlet: no hay datos para medirlos.

## Cómo estimo el efecto en 30 días
Con lo que pasó antes con el mismo descuento (mismo tipo y mismo %), corregido por temporada con el control, en tres escenarios: como la peor sucursal, como todas juntas y como la mejor. Donde no se toca el precio, el efecto de precio es cero.

| producto | descuento | medido en | para empatar tiene que vender | margen en 30 días: peor / todas / mejor |
|---|---|---|---|---|
| Pelota del rio 36 | 10 % | Pelota del muelle 7 | +32 % | −$ 23.761 / −$ 8.843 / +$ 14.681 |
| Zapatilla del rio 12 | 10 % | Zapatilla del valle 1 | +28 % | +$ 9.263 / +$ 46.977 / +$ 94.977 |
| Mochila de la costa 14 | 20 % | Mochila de la estepa 8 | +111 % | −$ 28.248 / −$ 23.863 / −$ 18.808 |

**En 30 días**: 16 → 21,5 u (entre 17,4 y 27,4) y +$ 14.271 de margen (entre −$ 42.746 y +$ 90.851). Sumando el mes siguiente, entre −$ 37.784 y +$ 121.186. El descuento mueve poco: el stock quieto sale sobre todo por las otras acciones.

## Juicio sobre la consultora
**Tomaría solo una parte.** Descuenta en 39 de 48 productos; esta propuesta, en 3 ya y 5 con condición. Coinciden en 17 de 48.
- **Tomo**: su "no descontar" donde la venta acompaña al stock, y descontar productos lentos de los tipos que respondieron (botas, mochilas), con el porcentaje que se probó en cada tipo.
- **Reemplazo el resto**: usa el precio para problemas que no son de precio. Descuenta productos que venden al día, se superpone con campañas y subas recientes, y descuenta productos que se cortaron, que nunca se exhibieron o cuyos descuentos aceptados nunca llegaron a caja.
- **Errores que se comprueban con las hojas**: en 12 productos proyecta vender más de lo que hay en stock y en 4 vende bajo costo (Juego de sábanas del faro 45, Juego de sábanas del alto 46, Toalla del rio 48, Toalla de la quebrada 47).
- **Hallazgo de proceso**: de 30 sugerencias aceptadas, solo 8 llegaron al precio cobrado. Antes que un mejor algoritmo, hace falta que lo aprobado se aplique.

## Herramientas de IA
Usé Claude (Claude Code) como asistente de programación y análisis: leer la consigna y los datos, escribir y revisar el código, armar el Excel y el tablero, y redactar textos. Los criterios de decisión los discutí y elegí yo, grupo por grupo. Todas las cifras salen del script, ninguna está escrita a mano, y las del tablero se verificaron contra un cálculo independiente hecho directo del Excel original.