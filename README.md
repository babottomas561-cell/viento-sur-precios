# Viento Sur · Precios para stock que no rota

Resolución de la prueba técnica. Con los datos al 15/03/2026, propone qué hacer con el precio de cada uno de los 48 productos y por qué, juzga el algoritmo de la consultora y arma un tablero para seguir la decisión.

## Dónde está cada respuesta

| La consigna pide | Está en |
|---|---|
| **El proceso** (pregunta 1) | [`armar_excel.py`](armar_excel.py): lee `datos/viento_sur.xlsx` y genera todo lo de `salidas/` |
| **El archivo con la propuesta** | [`salidas/ventas_y_stock.xlsx`](salidas/ventas_y_stock.xlsx), hoja **Propuesta**: acción, motivo, meta y fecha de revisión de los 48 productos |
| **La nota** (qué miré, qué dejé afuera, efecto a 30 días) | [`salidas/nota.md`](salidas/nota.md) (también como hoja **Nota** del Excel) |
| **El juicio sobre la consultora** | En la nota, sección "Juicio sobre la consultora" |
| **El tablero** (pregunta 2) | [`web/index.html`](web/index.html): se abre con doble clic, no necesita servidor |
| **El proceso alrededor del modelo** (pregunta 3) | [`proceso.md`](proceso.md) |
| **Herramientas de IA** | En la nota, sección "Herramientas de IA" |

## La respuesta en corto

- **El problema no es solo de precio.** 35 de 48 productos venden menos de lo esperado, pero por motivos distintos: se cortaron, están mal ubicados, nunca se exhibieron, tienen margen bajo de origen. Cada producto cae en uno de 9 grupos, y el grupo define la acción.
- **Descuento solo donde hay evidencia de que funciona**: 3 ahora (a prueba, con fechas y medidos) y 5 si se cumple una condición. Los otros 40 se resuelven sin tocar el precio: reponer, mover stock entre sucursales, revisar exhibición, devolver o negociar con el proveedor.
- **La consultora: tomaría solo una parte.** Descuenta 39 de 48 productos, en 12 proyecta vender más de lo que hay en stock y en 4 vende bajo costo.
- **Hallazgo de proceso:** de 30 descuentos aceptados, solo 8 llegaron al precio cobrado.

## Cómo correrlo

Necesita Python 3.11 o más nuevo (probado con 3.14).

```bash
python -m venv .venv
source .venv/bin/activate        # en Windows: .venv\Scripts\activate
pip install -r requirements.txt
python armar_excel.py
```

Genera en `salidas/`: `ventas_y_stock.xlsx` (la propuesta y todo el análisis), `nota.md` y `tablero_datos.json`. Corre en pocos segundos y da siempre el mismo resultado: los rangos por azar usan una semilla fija.

Opciones: `python armar_excel.py --datos otro.xlsx --salidas otra_carpeta`. Ninguna cifra está escrita a mano: si cambian los datos, cambian la propuesta, la nota y el tablero.

### Para seguir la decisión semana a semana

```bash
python actualizar.py --datos datos/viento_sur.xlsx
```

Corre el proceso, guarda la foto en una base SQLite (`datos/viento_sur.db`) con su historia, y arma el tablero en `web/`. Con la segunda foto, la pestaña *Seguimiento* compara cada decisión con lo que pasó: si se aplicó, si llegó a la meta y si se sostuvo.

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

`web/index.html` tiene 8 pestañas: Decisión, Ventas, Stock y rotación, Sucursales, Descuentos, Productos (con una ficha por producto), Seguimiento y Datos. Los filtros (fechas, sucursal, rubro, tipo, grupo, producto) aplican a todas y quedan en el link. Cada gráfico tiene "Ver y auditar los datos" con las filas exactas que lo arman.

Los gráficos usan Chart.js desde un CDN, así que necesita conexión a internet.

`salidas/auditoria/` tiene la verificación de los filtros: compara lo que muestra el tablero en 13 combinaciones con un cálculo independiente hecho directo del Excel original.

## Estructura

```
armar_excel.py        el proceso: datos → propuesta, nota, Excel y datos del tablero
actualizar.py         base con historia + tablero (para correr con cada Excel nuevo)
proceso.md            pregunta 3
datos/viento_sur.xlsx los datos de la consigna
salidas/              lo que genera armar_excel.py
tablero/              el código del tablero (HTML, CSS, JS)
web/                  el tablero armado, listo para abrir
```
