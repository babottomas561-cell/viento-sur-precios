# Pregunta 3 · El proceso alrededor del modelo

El modelo no mueve el negocio solo: mueve el negocio si lo que propone se aprueba, se aplica en el local y se mide. Con los datos al 15/03, de las 20 sugerencias aceptadas que se pueden verificar en las ventas, solo 8 llegaron al precio cobrado. El proceso tiene que cerrar ese circuito.

## Cada cuánto corre

| Qué | Cada cuánto | Cómo |
|---|---|---|
| Correr el modelo con el Excel nuevo | **Semanal** (lunes) | El analista sube el Excel de la semana con **Subir Excel** en el tablero: el servidor lo valida, corre el proceso, lo guarda en la base con su fecha y el tablero pasa a mostrarlo para todos. Paso a paso en el [README](README.md#cómo-es-el-proceso-paso-a-paso) |
| Revisar las decisiones vencidas | **Semanal** | Pestaña *Seguimiento*: cada decisión tiene una regla que se comprueba con las ventas, su línea base, su meta y su fecha de revisión. Se deciden las que ya llegaron a esa fecha |
| Cerrar un descuento a prueba | **A las 4 semanas**, y de nuevo al mes siguiente | Se compara contra el control, igual que en la hoja *Descuentos* |
| Revisar las reglas y los umbrales | **Trimestral** | Con los descuentos nuevos medidos, cada tipo suma evidencia: se recalcula qué tipos responden |

Semanal y no diario porque con 1 a 3 unidades por día un producto no muestra nada en menos de una semana. Tampoco mensual: un lote vencido no puede esperar un mes.

## Quién aprueba

- **Analista de precios**: sube el Excel el lunes. Si la validación falla, el tablero dice qué hoja o columna corregir y no guarda nada; si se subió uno equivocado, uno de la misma fecha lo reemplaza.
- **Gerente comercial**: aprueba la propuesta semanal completa. El tablero muestra para cada producto la acción, el motivo y las reglas que la decidieron, para aprobar o rechazar en minutos.
- **Gerencia general**: cualquier descuento que deje menos del 15 % de margen o que supere el 20 %. El modelo no los propone, pero si comercial quiere hacerlo a mano, tiene que pasar por acá.
- **Compras**: devoluciones, bonificaciones y renegociación con proveedores (hoy, sobre todo Cumbre).
- **Encargado de cada local**: confirma que el precio está cargado en caja el primer día de vigencia. Sin esa confirmación, el descuento no cuenta como aplicado.

Si se rechaza una propuesta, se anota por qué. Ese motivo es información para ajustar las reglas.

## Reglas para que la medición sirva

1. **Todo descuento lleva fechas de vigencia.** Sin fechas no se ve en caja y no se puede medir. Hoy es el problema principal.
2. **4 semanas y se mide también el mes siguiente.** Así se ve si se vendió más o solo se adelantaron compras.
3. **Una sucursal sin descuento como comparación** cuando el producto está en más de una. Es la forma más barata de separar el efecto del descuento de la temporada del producto, que hoy no se puede medir porque no hay datos de otros años.
4. **No superponer** un descuento con campañas, cambios de precio de lista o sugerencias recientes. Si no, no se sabe qué funcionó.

## Cómo se sabe si funcionó

**Por decisión** (en la pestaña *Seguimiento*, con cada Excel nuevo): cada recomendación se sigue desde el Excel en que se hizo, con una regla según lo que se propuso:

| Se recomendó | Se cumple si |
|---|---|
| Un descuento | Se cobra en caja (precio cobrado por debajo del de lista) y vende al menos su meta por semana |
| Cobrar una rebaja ya aprobada o confirmar una campaña | La rebaja se ve en el precio cobrado |
| Dejar el precio | Sigue vendiendo al menos el 90 % de antes, sin quedarse sin stock |
| Recién llegado: mover stock | Vende más rápido que antes (así baja lo que sobraría a la fecha límite) |
| Esperar una suba de precio en curso | No vende menos del 90 % de antes |
| Exhibir un producto que nunca vendió | Tiene al menos una venta |
| Investigar un corte | Vuelve a vender lo de antes (sus unidades por semana) |
| Revisar la exhibición en los locales donde no vende | Primeras ventas en esos locales |
| Devolución, outlet, negociar con el proveedor | Lo confirma quien lo gestiona: no se ve en las ventas |

Las que ya pasaron su fecha de revisión se deciden (seguir, ajustar o pasar al paso siguiente de su causa); las demás siguen en curso, porque juzgarlas antes sería apurarse.

**Para el negocio** (una vez por mes, contra el mes anterior):

| Métrica | Qué tiene que pasar |
|---|---|
| Stock que pasó su fecha límite (u y $ a costo) | Bajar |
| % de lotes al día con su ritmo objetivo | Subir |
| Margen de los productos descontados contra seguir igual (corregido por el control) | No ser negativo en el neto de 2 meses |
| % de lo aprobado que llegó a caja | Cerca del 100 % |
| Stock devuelto o bonificado por proveedores | Subir mientras haya excedente |

Si en dos ciclos seguidos el stock vencido no baja, el problema no es el precio: hay que mirar la compra, es decir cuánto y a quién se compra, y eso va a Compras.
