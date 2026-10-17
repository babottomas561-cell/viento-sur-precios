# Viento Sur · Precios para stock que no rota

Resolución de la prueba técnica. Con los datos al 15/03/2026, propone qué hacer con el precio de cada uno de los 48 productos y por qué, juzga el algoritmo de la consultora y arma un tablero para seguir la decisión.

**Tablero online: [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app)**. Tiene una base detrás: con **Subir Excel** cualquiera carga una foto nueva, el proceso corre en el servidor y el tablero pasa a mostrar la más nueva, con el seguimiento de lo que se viene recomendando.

## Dónde está cada respuesta

| La consigna pide | Está en |
|---|---|
| **El proceso** (pregunta 1) | [`armar_excel.py`](armar_excel.py): lee `datos/viento_sur.xlsx` y genera todo lo de `salidas/` |
| **El archivo con la propuesta** | [`salidas/ventas_y_stock.xlsx`](salidas/ventas_y_stock.xlsx), hoja **Propuesta**: acción, motivo, meta y fecha de revisión de los 48 productos |
| **La nota** (qué miré, qué dejé afuera, efecto a 30 días) | [`salidas/nota.md`](salidas/nota.md) (también como hoja **Nota** del Excel) |
| **El juicio sobre la consultora** | En la nota, sección "Juicio sobre la consultora" |
| **El tablero** (pregunta 2) | [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app), o [`web/index.html`](web/index.html) con doble clic |
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

Corre el proceso, guarda la foto en una base SQLite (`datos/viento_sur.db`) con su historia, y arma el tablero en `web/`. Con la segunda foto, la pestaña *Seguimiento* muestra si se está cumpliendo lo recomendado.

Para probarlo sin esperar una semana, `recortar_foto.py` arma cómo se veían los datos en una fecha anterior (las ventas hasta ese día y el stock de entonces):

```bash
python recortar_foto.py 2026-03-08          # → datos/viento_sur_al_2026-03-08.xlsx
```

## El tablero online y su base

En [viento-sur-tablero.vercel.app](https://viento-sur-tablero.vercel.app), **Subir Excel** (arriba a la derecha) hace lo mismo que `actualizar.py`, pero en el servidor:

1. Valida que el Excel tenga las hojas y columnas de la consigna.
2. Corre `armar_excel.py`, el mismo proceso, sin cambios.
3. Lo guarda en la base como la foto de esa fecha (el último día con ventas). Si ya había una de esa fecha, la reemplaza; si es de una fecha anterior, las fotos posteriores recalculan su seguimiento.
4. El tablero abre siempre la foto más nueva. Las anteriores se eligen en el selector "Foto".

**Seguimiento:** cada recomendación se sigue desde la primera foto en que se propuso, mientras se haya seguido proponiendo lo mismo. Muestra semana a semana si se aplicó (precio cobrado), si llega a su meta, cómo baja el stock y si ya pasó su fecha de revisión. La base arranca con tres fotos: la del 15/03 (la de la consigna) y dos recortes de los mismos datos, al 01/03 y al 08/03.

Es una demo: no tiene login, y lo que se sube queda público.

| Archivo | Qué hace |
|---|---|
| `foto.py` | La lógica compartida: validar el Excel, correr el proceso, medir el seguimiento y armar el paquete que lee el tablero |
| `servidor.py` | La base online (Vercel Blob): una foto por fecha, versiones que nunca se pisan, recálculo de las posteriores |
| `blob.py` | Cliente mínimo del almacenamiento de Vercel, sin dependencias |
| `api/subir.py`, `api/fotos.py`, `api/abrir.py` | Las funciones del servidor: subir un Excel, listar las fotos, abrir una |
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

`web/index.html` tiene 8 pestañas: Decisión, Ventas, Stock y rotación, Sucursales, Descuentos, Productos (con una ficha por producto: ritmo del lote, seguimiento de su recomendación, historial de precio), Seguimiento y Datos. Abierto con doble clic muestra la foto con la que se armó; publicado, la más nueva de la base. Los filtros (fechas, sucursal, rubro, tipo, grupo, producto) aplican a todas y quedan en el link. Cada gráfico tiene "Ver y auditar los datos" con las filas exactas que lo arman.

Los gráficos usan Chart.js desde un CDN, así que necesita conexión a internet.

`salidas/auditoria/` tiene la verificación, hecha con un cálculo independiente directo del Excel original (sin pasar por `armar_excel.py`): la planilla, con 1.031 chequeos (los 100 lotes indicador por indicador, cada sucursal y los productos de la Propuesta), y el tablero, con 17 combinaciones de filtros en todas las pestañas (779 chequeos en el sitio publicado). Las dos dan sin diferencias. Ver [`salidas/auditoria/LEEME.md`](salidas/auditoria/LEEME.md).

## Estructura

```
armar_excel.py        el proceso: datos → propuesta, nota, Excel y datos del tablero
actualizar.py         base local (SQLite) con historia + tablero (para correr con cada Excel nuevo)
foto.py               lo común a la base local y a la online: validar, correr, seguimiento, paquete
servidor.py, blob.py  la base online (Vercel Blob)
api/                  las funciones del servidor (subir, listar y abrir fotos)
recortar_foto.py      arma una foto anterior recortando el Excel a una fecha
proceso.md            pregunta 3
datos/viento_sur.xlsx los datos de la consigna
salidas/              lo que genera armar_excel.py
tablero/              el código del tablero (HTML, CSS, JS)
web/                  el tablero armado, listo para abrir
```
