"""Herramienta de prueba: recorta el Excel a una fecha anterior, para ver cómo se veían los datos ese día.

Sirve para probar el seguimiento (cargar el recorte y después el Excel completo) sin inventar datos. No es parte de la entrega:
  - ventas: solo hasta la fecha;
  - stock: el del Excel más lo que se vendió después de la fecha (supone que no hubo reposiciones ni transferencias);
    los lotes que entraron después de la fecha se sacan;
  - sugerencias, campañas y cambios de precio: solo los que ya existían ese día.

Uso:  python herramientas/recortar_excel.py 2026-03-08                 -> datos/viento_sur_al_2026-03-08.xlsx
      python herramientas/recortar_excel.py 2026-03-08 --datos X.xlsx --salida Y.xlsx
"""
import argparse
from pathlib import Path

import pandas as pd

ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
ap.add_argument("fecha", help="fecha del recorte (AAAA-MM-DD)")
ap.add_argument("--datos", default="datos/viento_sur.xlsx")
ap.add_argument("--salida", default=None)
args = ap.parse_args()
corte = pd.Timestamp(args.fecha)
salida = Path(args.salida or f"datos/viento_sur_al_{corte:%Y-%m-%d}.xlsx")

h = pd.read_excel(args.datos, sheet_name=None)
v = h["ventas"].copy()
v["fecha"] = pd.to_datetime(v.fecha)
despues = v[v.fecha > corte].groupby(["sku", "sucursal_id"]).unidades.sum()
h["ventas"] = h["ventas"][v.fecha <= corte]

st = h["stock_sucursal"].copy()
st = st[pd.to_datetime(st.fecha_ingreso) <= corte]
st["unidades"] = st.unidades + [int(despues.get((r.sku, r.sucursal_id), 0)) for r in st.itertuples()]
if "antiguedad_dias" in st.columns:
    st["antiguedad_dias"] = (corte - pd.to_datetime(st.fecha_ingreso)).dt.days
h["stock_sucursal"] = st

for hoja, col in [("historial_sugerencias", "fecha_sugerencia"), ("cambios_precio", "fecha"), ("campanas_activas", "fecha_desde")]:
    h[hoja] = h[hoja][pd.to_datetime(h[hoja][col]) <= corte]

with pd.ExcelWriter(salida) as w:
    for hoja, df in h.items():
        df.to_excel(w, sheet_name=hoja, index=False)
print(f"Datos al {corte:%d/%m/%Y}: {salida} ({len(h['ventas'])} ventas, {int(st.unidades.sum())} u en stock)")
