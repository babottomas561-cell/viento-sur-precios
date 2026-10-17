# Viento Sur · Precios para stock que no rota

Resolución de la prueba técnica. Con los datos al 15/03/2026, propone qué hacer con el precio de cada uno de los 48 productos y por qué, juzga el algoritmo de la consultora y arma un tablero para seguir la decisión.

**Tablero online: [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app)**. Muestra los datos del Excel de la consigna (al 15/03/2026). Tiene una base detrás para cuando lleguen más: con **Subir Excel** se carga el de la semana siguiente, el proceso corre en el servidor y el tablero pasa a medir si se cumple lo que se recomendó.

## Dónde está cada respuesta

| La consigna pide | Está en |
|---|---|
| **El proceso** (pregunta 1) | [`armar_excel.py`](armar_excel.py): lee `datos/viento_sur.xlsx` y genera todo lo de `salidas/` |
| **El archivo con la propuesta** | [`salidas/ventas_y_stock.xlsx`](salidas/ventas_y_stock.xlsx), hoja **Propuesta**: acción, motivo, meta y fecha de revisión de los 48 productos |
| **La nota** (qué miré, qué dejé afuera, efecto a 30 días) | [`salidas/nota.md`](salidas/nota.md) (también como hoja **Nota** del Excel) |
| **Las 5 causas, en cuatro pasos** (qué pasa, la prueba, qué hacemos, cómo lo medimos) | [`salidas/causas.md`](salidas/causas.md) y la primera pantalla del tablero |
| **El juicio sobre la consultora** | En la nota, sección "Juicio sobre la consultora" |
| **El tablero** (pregunta 2) | [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app), o [`web/index.html`](web/index.html) con doble clic |
| **El proceso alrededor del modelo** (pregunta 3) | [`proceso.md`](proceso.md) |
| **Herramientas de IA** | En la nota, sección "Herramientas de IA" |

## La respuesta en corto

**El problema:** hay 5.006 u en stock, 35 de 48 productos venden menos de lo esperado y el 57 % del stock ya pasó su fecha límite. Pero no es un solo problema, y el precio explica una parte chica.

| Por qué no se vende | Productos | Stock | Qué proponemos | ¿Toca el precio? |
|---|---|---|---|---|
| **No es un problema**: vende bien o recién llegó | 13 | 783 u | Dejar el precio; reponer, mover stock y medir cuánto sobraría | No por ahora |
| **Ejecución**: lo aprobado no llegó a caja, o hay un cambio en curso | 11 | 1.394 u | Que lo aprobado se cobre en caja, con fechas, y medirlo | Lo ya aprobado |
| **Producto o ubicación**: nunca vendió, se cortó o está en el local equivocado | 12 | 1.180 u | Contar el stock, exhibir, mover o investigar en el local | No |
| **Compra**: tan caro que no hay margen para descontar (Cumbre) | 4 | 581 u | Negociar devolución o bonificación con el proveedor | No |
| **Puede ser precio**: vende poco pero parejo, sin otra explicación | 8 | 1.068 u | Descuento a prueba solo si su tipo respondió y queda margen | Sí, a prueba |

Cada causa está contada en cuatro pasos, con sus datos (**qué pasa, la prueba, qué hacemos y por qué, y cómo lo medimos**) en [`salidas/causas.md`](salidas/causas.md) y en la primera pantalla del tablero; la nota lo resume en una tabla. La ficha de cada producto repite los mismos cuatro pasos con sus propios indicadores.

- **El mensaje central:** solo el 21 % del stock está en productos donde el precio puede ser la causa, y aun ahí el descuento pasa los criterios en 3 de 8. En total: 4 descuentos ahora (a prueba, con fechas y medidos) y 6 si se cumple una condición; los otros 38 se resuelven sin tocar el precio.
- **Cada decisión se puede revisar**: la ficha de cada producto (y la hoja Propuesta) muestra su causa, el problema en una frase y los indicadores que lo deciden, con su valor, su regla y si se cumple.
- **El stock vencido tiene fecha de salida**: cada producto arranca por la acción de su causa, pero si no cumple se liquida con fechas (20 %, después 35 %, después devolución u outlet), siempre con piso en el costo. Última salida: 29/05/2026.
- **La consultora: tomaría solo una parte.** Descuenta 39 de 48 productos, en 12 proyecta vender más de lo que hay en stock y en 4 vende bajo costo.
- **Hallazgo de proceso:** de las 21 sugerencias aceptadas que se pueden verificar en las ventas, solo 8 llegaron al precio cobrado.

## Cómo correrlo

Necesita Python 3.11 o más nuevo (probado con 3.14).

```bash
python -m venv .venv
source .venv/bin/activate        # en Windows: .venv\Scripts\activate
pip install -r requirements.txt
python armar_excel.py
```

Genera en `salidas/`: `ventas_y_stock.xlsx` (la propuesta y todo el análisis), `nota.md`, `causas.md` y `tablero_datos.json`. Corre en pocos segundos y da siempre el mismo resultado: los márgenes de error usan una semilla fija.

Opciones: `python armar_excel.py --datos otro.xlsx --salidas otra_carpeta`. Ninguna cifra está escrita a mano: si cambian los datos, cambian la propuesta, la nota y el tablero.

### Para seguir la decisión semana a semana

```bash
python actualizar.py --datos datos/viento_sur.xlsx
```

Corre el proceso, guarda los datos de ese Excel (con su fecha) en una base SQLite (`datos/viento_sur.db`) y arma el tablero en `web/`. Con el primer Excel, la pestaña *Seguimiento* muestra la agenda de revisión de cada recomendación; cuando llega el de la semana siguiente, empieza a medir si se cumple.

Para probar el seguimiento sin esperar una semana, `recortar_foto.py` arma, a partir del mismo Excel, cómo se veían los datos en una fecha anterior (las ventas hasta ese día y el stock de entonces). Es solo una herramienta de prueba: el tablero entregado usa únicamente el Excel de la consigna.

```bash
python recortar_foto.py 2026-03-08          # → datos/viento_sur_al_2026-03-08.xlsx
```

## El tablero online y su base

En [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app), **Subir Excel** (arriba a la derecha) hace lo mismo que `actualizar.py`, pero en el servidor:

1. Valida que el Excel tenga las hojas y columnas de la consigna.
2. Corre `armar_excel.py`, el mismo proceso, sin cambios.
3. Lo guarda en la base con la fecha de sus datos (el último día con ventas). Si ya había un Excel de esa fecha, lo reemplaza; si es de una fecha anterior, los posteriores recalculan su seguimiento.
4. El tablero abre siempre los datos más nuevos. Los anteriores se eligen en el selector "Datos al".

**Seguimiento:** cada recomendación se sigue desde el Excel en que se propuso, mientras se siga proponiendo lo mismo. Cada una tiene una regla simple que se comprueba con las ventas (por ejemplo, un descuento: que se cobre en caja y llegue a su meta; un producto que nunca vendió: que tenga una primera venta), y el resumen separa las que ya llegaron a su fecha de revisión de las que siguen en curso. La base tiene solo el Excel de la consigna: el seguimiento empieza con el siguiente.

Es una demo: no tiene login, y lo que se sube queda público.

| Archivo | Qué hace |
|---|---|
| `foto.py` | La lógica compartida: validar el Excel, correr el proceso, medir el seguimiento y armar el paquete que lee el tablero |
| `servidor.py` | La base online (Vercel Blob): un Excel por fecha de datos, versiones que nunca se pisan, recálculo de los posteriores |
| `blob.py` | Cliente mínimo del almacenamiento de Vercel, sin dependencias |
| `api/subir.py`, `api/fotos.py`, `api/abrir.py` | Las funciones del servidor: subir un Excel, listar los cargados, abrir uno |
| `vercel.json`, `.vercelignore` | Qué se publica y cómo corren las funciones (región San Pablo, hasta 60 s) |

`foto.py` es el mismo para la base local y la online: probado, las dos dan el mismo seguimiento.

## El Excel

| Hoja | Qué tiene |
|---|---|
| **Propuesta** | Los 48 productos: grupo, acción, motivo, meta, fecha de revisión y si coincide con la consultora. Al final, la evidencia por tipo y los escenarios de los descuentos |
| **Nota** | La nota de supuestos |
| **Resumen** | Las sucursales comparadas: ventas en unidades y pesos, stock, rotación, productos compartidos |
| **Descuentos** | Los 8 descuentos aplicados: antes, durante y después, por sucursal, contra un control, y lo que dejó cada uno |
| **S01 … F01** | Cada sucursal: ventas en el tiempo por rubro y producto, stock, rotación |
| **Datos por lote** | Los indicadores de cada producto en cada sucursal (ritmo del lote, % vendido, días de stock…) |
| **Cómo se calcula** | Cada cuenta y cada regla, explicadas |

## El tablero

`web/index.html` tiene 8 pestañas: Decisión (abre con el problema y la solución en un minuto: el stock repartido por causa y una tarjeta por causa), Ventas, Stock y rotación, Sucursales, Descuentos, Productos (con una ficha por producto: qué le pasa, los indicadores que lo deciden, qué hacemos y cómo lo medimos, más el ritmo del lote, el seguimiento de su recomendación y el historial de precio), Seguimiento y Datos. Abierto con doble clic muestra la foto con la que se armó; publicado, la más nueva de la base. Los filtros (fechas, sucursal, rubro, tipo, causa, grupo, producto) aplican a todas y quedan en el link. Cada gráfico tiene "Ver y auditar los datos" con las filas exactas que lo arman.

Los gráficos usan Chart.js desde un CDN, así que necesita conexión a internet.

`salidas/auditoria/` tiene la verificación, hecha con un cálculo independiente directo del Excel original (sin pasar por `armar_excel.py`): la planilla, con 1.031 chequeos (los 100 lotes indicador por indicador, cada sucursal y los productos de la Propuesta), y el tablero, con 17 combinaciones de filtros en todas las pestañas (763 chequeos, en la computadora y en el sitio publicado). Las dos dan sin diferencias. Ver [`salidas/auditoria/LEEME.md`](salidas/auditoria/LEEME.md).

## Estructura

```
armar_excel.py        el proceso: datos → propuesta, nota, Excel y datos del tablero
actualizar.py         base local (SQLite) con historia + tablero (para correr con cada Excel nuevo)
foto.py               lo común a la base local y a la online: validar, correr, seguimiento, paquete
servidor.py, blob.py  la base online (Vercel Blob)
api/                  las funciones del servidor (subir, listar y abrir los Excel cargados)
recortar_foto.py      herramienta de prueba: recorta el Excel a una fecha anterior
proceso.md            pregunta 3
datos/viento_sur.xlsx los datos de la consigna
salidas/              lo que genera armar_excel.py
tablero/              el código del tablero (HTML, CSS, JS)
web/                  el tablero armado, listo para abrir
```
