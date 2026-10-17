# Pregunta 3 · El proceso alrededor del modelo

El modelo no mueve el negocio solo: mueve el negocio si lo que propone se aprueba, se aplica en el local y se mide. En esta foto, de las 21 sugerencias aceptadas que se pueden verificar en las ventas, solo 8 llegaron al precio cobrado. El proceso tiene que cerrar ese circuito.

## Cada cuánto corre

| Qué | Cada cuánto | Cómo |
|---|---|---|
| Correr el modelo con la foto nueva | **Semanal** (lunes) | Se sube el Excel de la semana con **Subir Excel** en el tablero (o `python actualizar.py --datos <excel>`): regenera la propuesta, la guarda en la base con su fecha y el tablero pasa a mostrarla |
| Revisar las decisiones vencidas | **Semanal** | Pestaña *Seguimiento*: cada decisión tiene indicador, línea base, meta y fecha de revisión |
| Cerrar un descuento a prueba | **A las 4 semanas**, y de nuevo al mes siguiente | Se compara contra el control, igual que en la hoja *Descuentos* |
| Revisar las reglas y los umbrales | **Trimestral** | Con los descuentos nuevos medidos, cada tipo suma evidencia: se recalcula qué tipos responden |

Semanal y no diario porque con 1 a 3 unidades por día un producto no muestra nada en menos de una semana. Tampoco mensual: un lote vencido no puede esperar un mes.

## Quién aprueba

- **Gerente comercial**: aprueba la propuesta semanal completa. El tablero muestra para cada producto la acción, el motivo y las reglas que la decidieron, para aprobar o rechazar en minutos.
- **Gerencia general**: cualquier descuento que deje menos del 15 % de margen o que supere el 20 %. El modelo no los propone, pero si comercial quiere hacerlo a mano, tiene que pasar por acá.
- **Compras**: devoluciones, bonificaciones y renegociación con proveedores (hoy, sobre todo Cumbre).
- **Encargado de cada local**: confirma que el precio está cargado en caja el primer día de vigencia. Sin esa confirmación, el descuento no cuenta como aplicado.

Si se rechaza una propuesta, se anota por qué. Ese motivo es información para ajustar las reglas.

## Reglas para que la medición sirva

1. **Todo descuento lleva fechas de vigencia.** Sin fechas no se ve en caja y no se puede medir. Hoy es el problema principal.
2. **4 semanas y se mide también el mes siguiente.** Así se ve si se vendió más o solo se adelantaron compras.
3. **Una sucursal sin descuento como comparación** cuando el producto está en más de una. Es la forma más barata de saber cuánto es efecto del descuento y cuánto es temporada.
4. **No superponer** un descuento con campañas, cambios de precio de lista o sugerencias recientes. Si no, no se sabe qué funcionó.

## Cómo se sabe si funcionó

**Por decisión** (en la pestaña *Seguimiento*, con cada foto): cada recomendación se sigue desde que se hizo. ¿Se aplicó? (precio cobrado contra precio de lista); ¿llega a la meta de unidades por semana?; ¿se movió el stock?; ¿ya pasó su fecha de revisión o sigue en curso?

**Para el negocio** (una vez por mes, contra el mes anterior):

| Métrica | Qué tiene que pasar |
|---|---|
| Stock que pasó su fecha límite (u y $ a costo) | Bajar |
| % de lotes al día con su ritmo objetivo | Subir |
| Margen de los productos descontados contra seguir igual (corregido por el control) | No ser negativo en el neto de 2 meses |
| % de lo aprobado que llegó a caja | Cerca del 100 % |
| Stock devuelto o bonificado por proveedores | Subir mientras haya excedente |

Si en dos ciclos seguidos el stock vencido no baja, el problema no es el precio: hay que mirar la compra, es decir cuánto y a quién se compra, y eso va a Compras.
