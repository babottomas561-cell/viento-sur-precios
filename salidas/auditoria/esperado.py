"""Auditoría de filtros: lo que el tablero tendría que mostrar, calculado directo del Excel original (sin pasar por armar_excel.py)."""
import json, pandas as pd
x = pd.read_excel("datos/viento_sur.xlsx", sheet_name=None)
prod, st, ve = x["productos"], x["stock_sucursal"], x["ventas"]
grupo = {p["sku"]: p["n"] for p in json.load(open("salidas/tablero_datos.json"))["productos"]}   # el grupo es nuestro, no del dato crudo
ve["fecha"] = pd.to_datetime(ve.fecha).dt.strftime("%Y-%m-%d")
F_MIN, F_MAX = ve.fecha.min(), ve.fecha.max()
ESC = {
    "sin filtros": {},
    "S04": {"suc": "S04"},
    "F01": {"suc": "F01"},
    "calzado": {"rubro": "calzado"},
    "calzado + botas": {"rubro": "calzado", "tipo": "botas"},
    "grupo 9": {"grupo": "9"},
    "un producto": {"sku": "VS-1012"},
    "un producto en S02": {"sku": "VS-1012", "suc": "S02"},
    "vigencia del descuento": {"desde": "2026-01-16", "hasta": "2026-02-12"},
    "S02 + deportes + desde feb": {"suc": "S02", "rubro": "deportes", "desde": "2026-02-01"},
    "rubro y tipo incompatibles": {"rubro": "hogar", "tipo": "botas"},
    "desde > hasta": {"desde": "2026-03-01", "hasta": "2026-02-01"},
    "grupo 1 en F01": {"grupo": "1", "suc": "F01"},
}
out = {}
for nombre, f in ESC.items():
    f = dict(f)
    # mismas reglas que el tablero: un tipo que no existe en el rubro se descarta; fechas invertidas se dan vuelta
    if "tipo" in f and not ((prod.tipo == f["tipo"]) & (prod.rubro == f.get("rubro", prod.rubro))).any(): del f["tipo"]
    if f.get("desde", F_MIN) > f.get("hasta", F_MAX): f["desde"], f["hasta"] = f["hasta"], f["desde"]
    P = prod[(prod.rubro == f.get("rubro", prod.rubro)) & (prod.tipo == f.get("tipo", prod.tipo)) & (prod.sku == f.get("sku", prod.sku))]
    if "grupo" in f: P = P[P.sku.map(grupo).astype(str) == f["grupo"]]
    L = st[st.sku.isin(P.sku)]
    if "suc" in f: L = L[L.sucursal_id == f["suc"]]; P = P[P.sku.isin(L.sku)]
    V = ve[ve.sku.isin(P.sku) & (ve.fecha >= f.get("desde", F_MIN)) & (ve.fecha <= f.get("hasta", F_MAX))]
    if "suc" in f: V = V[V.sucursal_id == f["suc"]]
    out[nombre] = dict(filtros=ESC[nombre], productos=len(P), lotes=len(L), stock=int(L.unidades.sum()),
                       ventas_u=int(V.unidades.sum()), ventas_p=int(round((V.unidades * V.precio_unitario).sum())), filas_ventas=len(V),
                       productos_con_venta=int(V.sku.nunique()))
json.dump(out, open("salidas/auditoria/esperado.json", "w"), ensure_ascii=False, indent=1)
huerfanas = ve.merge(st[["sku", "sucursal_id"]], how="left", indicator=True).query("_merge == 'left_only'")
print(pd.DataFrame(out).T.drop(columns="filtros").to_string()); print("ventas sin lote en esa sucursal:", len(huerfanas))
