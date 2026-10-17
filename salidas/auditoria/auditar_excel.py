"""Auditoría de la planilla que genera el proceso (salidas/ventas_y_stock.xlsx) contra un cálculo hecho directo del Excel original.

Revisa:
  Datos por lote  los 100 lotes, indicador por indicador (stock, vendidas, pesos, últimos 30 días, % vendido, días de stock, ritmo y % de lo esperado)
  Resumen         cada sucursal: productos, stock al inicio, vendidas, stock hoy y % vendido
  Propuesta       que estén todos los productos del catálogo una sola vez (los sin stock, al final) y que el resumen por grupo sume el total
Uso: python salidas/auditoria/auditar_excel.py [datos.xlsx] [planilla.xlsx]
"""
import sys

import numpy as np
import pandas as pd

datos = sys.argv[1] if len(sys.argv) > 1 else "datos/viento_sur.xlsx"
planilla = sys.argv[2] if len(sys.argv) > 2 else "salidas/ventas_y_stock.xlsx"
x = pd.read_excel(datos, sheet_name=None)
st, ve, prod = x["stock_sucursal"].copy(), x["ventas"].copy(), x["productos"]
ve["fecha"] = pd.to_datetime(ve.fecha)
st["fecha_ingreso"], st["fecha_limite"] = pd.to_datetime(st.fecha_ingreso), pd.to_datetime(st.fecha_limite)
INI, FOTO = ve.fecha.min(), ve.fecha.max()
fallas, chequeos = [], 0


def chk(que, vio, esp, tol=1e-6):
    global chequeos
    chequeos += 1
    if isinstance(esp, float) or isinstance(vio, float):
        ok = (pd.isna(vio) and pd.isna(esp)) or (not pd.isna(vio) and not pd.isna(esp) and abs(float(vio) - float(esp)) <= tol * max(1, abs(float(esp))))
    else:
        ok = vio == esp
    if not ok:
        fallas.append(f"{que}: la planilla dice {vio}, debería {esp}")


# ---- Datos por lote: cada lote, recalculado
esperado = {}
for r in st.itertuples():
    v = ve[(ve.sku == r.sku) & (ve.sucursal_id == r.sucursal_id)]
    cuenta = max(r.fecha_ingreso, INI)
    vend = int(v[v.fecha >= cuenta].unidades.sum())
    v30 = int(v[v.fecha > FOTO - pd.Timedelta(days=30)].unidades.sum())
    ritmo_obj = r.unidades_objetivo / (r.fecha_limite - r.fecha_ingreso).days
    ritmo_real = vend / ((FOTO - cuenta).days + 1)
    esperado[(r.sucursal_id, r.sku)] = dict(stock_hoy=int(r.unidades), vendidas=vend, stock_inicial=int(r.unidades) + vend,
                                            venta_pesos=float((v.unidades * v.precio_unitario).sum()), venta_ultimos_30=v30,
                                            pct_vendido=vend / (r.unidades + vend), dias_de_stock=(r.unidades / (v30 / 30)) if v30 else np.nan,
                                            ritmo_objetivo=ritmo_obj, ritmo_real=ritmo_real, pct_esperado=ritmo_real / ritmo_obj)
lotes = pd.read_excel(planilla, sheet_name="Datos por lote")
chk("Datos por lote · cantidad de lotes", len(lotes), len(esperado))
for r in lotes.to_dict("records"):
    e = esperado.get((r["sucursal_id"], r["sku"]))
    if e is None:
        fallas.append(f"Datos por lote · {r['sku']} en {r['sucursal_id']} no está en los datos")
        continue
    for k, ve_ in e.items():
        if k in r:
            chk(f"Datos por lote · {r['sku']} en {r['sucursal_id']} · {k}", r[k], ve_)

# ---- Resumen: cada sucursal
res = pd.read_excel(planilla, sheet_name="Resumen", header=None)
fila = next(i for i, v in res[0].items() if isinstance(v, str) and v.strip() == "sucursal")
col = {str(v).strip(): j for j, v in res.iloc[fila].items() if pd.notna(v)}      # columnas por su encabezado (hay celdas combinadas)
for _, r in res.iloc[fila + 1:].iterrows():
    s = str(r[0])[:3]
    if s not in set(st.sucursal_id):
        break
    lt = [e for (suc, _), e in esperado.items() if suc == s]
    chk(f"Resumen · {s} productos", int(r[col["productos"]]), len(lt))
    chk(f"Resumen · {s} stock al inicio", int(r[col["stock al inicio"]]), sum(e["stock_inicial"] for e in lt))
    chk(f"Resumen · {s} vendidas", int(r[col["vendidas"]]), sum(e["vendidas"] for e in lt))
    chk(f"Resumen · {s} stock hoy", int(r[col["stock hoy"]]), sum(e["stock_hoy"] for e in lt))
    chk(f"Resumen · {s} % vendido", float(r[col["% vendido"]]), sum(e["vendidas"] for e in lt) / sum(e["stock_inicial"] for e in lt))

# ---- Propuesta: los 48 productos y el resumen por grupo
pro = pd.read_excel(planilla, sheet_name="Propuesta", header=None)
skus_planilla = [c for c in pro[1] if isinstance(c, str) and c.startswith("VS-")]
chk("Propuesta · productos listados", len(skus_planilla), len(prod))
chk("Propuesta · cada producto una sola vez", len(set(skus_planilla)), len(prod))
chk("Propuesta · los productos son los del catálogo", sorted(set(skus_planilla)), sorted(prod.sku))
g0 = next(i for i, v in pro[0].items() if isinstance(v, str) and v.strip() == "grupo")
grupos = pro.iloc[g0 + 1:g0 + 10]
chk("Propuesta · resumen por grupo suma los productos con stock", int(grupos[1].sum()), int(prod.sku.isin(st.sku).sum()))
chk("Propuesta · resumen por grupo suma el stock", int(grupos[2].sum()), int(st.unidades.sum()))

print(f"Planilla: {chequeos} chequeos · {len(fallas) or 'sin'} diferencias")
for f in fallas[:40]:
    print("  ✗", f)
sys.exit(1 if fallas else 0)
