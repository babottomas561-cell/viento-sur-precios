"""Auditoría de los gráficos de Ventas: cada punto de cada serie, la participación y el ranking, calculados directo del Excel original.

Para cada combinación de filtros, granularidad (día, semana, mes), apertura (sucursal, rubro, tipo, grupo, producto, total)
y medida (unidades, pesos), arma lo que tendría que dibujar el tablero:
  serie         los 12 principales (8 si se abre por producto) por la medida elegida, más "Resto", en cada período
  participacion % de las unidades y % de los pesos de los 15 principales
  ranking       los 15 productos que más venden por la medida elegida
Las semanas arrancan en la fecha "desde" (como en el tablero).
Uso: python salidas/auditoria/esperado_ventas.py [datos.xlsx] [tablero_datos.json] [salida.json]  (por defecto, la consigna)
"""
import json
import sys

import pandas as pd

x = pd.read_excel(sys.argv[1] if len(sys.argv) > 1 else "datos/viento_sur.xlsx", sheet_name=None)
T = json.load(open(sys.argv[2] if len(sys.argv) > 2 else "salidas/tablero_datos.json"))
prod = x["productos"].set_index("sku")
suc = x["sucursales"].set_index("sucursal_id").nombre
st = x["stock_sucursal"]
ve = x["ventas"].copy()
ve["fecha"] = pd.to_datetime(ve.fecha).dt.strftime("%Y-%m-%d")
ve["pesos"] = ve.unidades * ve.precio_unitario
grupo = {p["sku"]: p["n"] for p in T["productos"]}
nombre_grupo = {g["n"]: g["nombre"] for g in T["grupos"]}
F_MIN, F_MAX = ve.fecha.min(), ve.fecha.max()

ESC = {
    "sin filtros": {},
    "S04": {"suc": "S04"},
    "calzado": {"rubro": "calzado"},
    "grupo 9": {"grupo": "9"},
    "vigencia del descuento": {"desde": "2026-01-16", "hasta": "2026-02-12"},
    "S02 + deportes + desde feb": {"suc": "S02", "rubro": "deportes", "desde": "2026-02-01"},
    "hogar en febrero": {"rubro": "hogar", "desde": "2026-02-01", "hasta": "2026-02-28"},
}
APERTURA = {
    "suc": lambda v: v.sucursal_id, "rubro": lambda v: prod.rubro[v.sku], "tipo": lambda v: prod.tipo[v.sku],
    "grupo": lambda v: str(grupo[v.sku]), "producto": lambda v: v.sku, "total": lambda v: "Total",
}
ETIQUETA = {
    "suc": lambda k: f"{k} · {suc.get(k, '')}", "rubro": lambda k: k, "tipo": lambda k: k,
    "grupo": lambda k: f"{k} · {nombre_grupo[int(k)]}", "producto": lambda k: prod.nombre[k], "total": lambda k: "Total",
}


def periodos(desde, hasta, gran):
    dias = pd.date_range(desde, hasta)
    if gran == "dia":
        clave = [f"{d:%Y-%m-%d}" for d in dias]
    elif gran == "sem":
        clave = [f"{pd.Timestamp(desde) + pd.Timedelta(days=7 * ((d - pd.Timestamp(desde)).days // 7)):%Y-%m-%d}" for d in dias]
    else:
        clave = [f"{d:%Y-%m}" for d in dias]
    return dict(zip([f"{d:%Y-%m-%d}" for d in dias], clave)), list(dict.fromkeys(clave))


out = {}
for nombre, f in ESC.items():
    P = prod[(prod.rubro == f.get("rubro", prod.rubro))]
    if "grupo" in f:
        P = P[P.index.map(grupo).astype(str) == f["grupo"]]
    if "suc" in f:
        P = P[P.index.isin(st[st.sucursal_id == f["suc"]].sku)]
    D, H = f.get("desde", F_MIN), f.get("hasta", F_MAX)
    V = ve[ve.sku.isin(P.index) & (ve.fecha >= D) & (ve.fecha <= H)]
    if "suc" in f:
        V = V[V.sucursal_id == f["suc"]]
    res = {}
    for gran in ["dia", "sem", "mes"]:
        de_dia, ejes = periodos(D, H, gran)
        per = V.fecha.map(de_dia)
        for por, clave in APERTURA.items():
            k = V.apply(clave, axis=1) if len(V) else pd.Series(dtype=str)
            for med, col in [("u", "unidades"), ("p", "pesos")]:
                tot = V.groupby(k)[col].sum() if len(V) else pd.Series(dtype=float)
                orden = tot.sort_index().sort_values(ascending=False, kind="stable")      # a igual venta, por clave (como el tablero)
                n = 8 if por == "producto" else 12
                top = list(orden.index[:n])
                serie = {}
                for kk in top:
                    s_ = V[k == kk].groupby(per[k == kk])[col].sum()
                    serie[ETIQUETA[por](kk)] = [float(s_.get(e, 0)) for e in ejes]
                if len(orden) > n:
                    s_ = V[~k.isin(top)].groupby(per[~k.isin(top)])[col].sum()
                    serie["Resto"] = [float(s_.get(e, 0)) for e in ejes]
                res[f"{gran}|{por}|{med}"] = dict(periodos=len(ejes), serie=serie, empate_en_el_corte=bool(len(orden) > n and orden.iloc[n - 1] == orden.iloc[n]))
    for por, clave in APERTURA.items():
        k = V.apply(clave, axis=1) if len(V) else pd.Series(dtype=str)
        g_ = V.groupby(k)[["unidades", "pesos"]].sum()
        for med, col in [("u", "unidades"), ("p", "pesos")]:
            top = g_.sort_values(col, ascending=False, kind="stable").head(15)
            res[f"part|{por}|{med}"] = {ETIQUETA[por](kk): [round(100 * r.unidades / V.unidades.sum(), 9), round(100 * r.pesos / V.pesos.sum(), 9)] for kk, r in top.iterrows()}
    for med, col in [("u", "unidades"), ("p", "pesos")]:
        rk = V.groupby("sku")[col].sum().sort_index().sort_values(ascending=False, kind="stable").head(15)
        res[f"rank|{med}"] = {prod.nombre[s]: float(v) for s, v in rk.items()}
    out[nombre] = dict(filtros=f, **res)
json.dump(out, open(sys.argv[3] if len(sys.argv) > 3 else "salidas/auditoria/esperado_ventas.json", "w"), ensure_ascii=False)
print(f"{len(out)} combinaciones · {sum(len(v) - 1 for v in out.values())} gráficos esperados")
