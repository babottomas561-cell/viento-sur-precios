"""Auditoría del tablero: lo que tendría que mostrar cada pestaña, calculado directo del Excel original (sin pasar por armar_excel.py).

Para cada combinación de filtros calcula, por su cuenta:
  Ventas      unidades, pesos, productos con venta, unidades por día, % de unidades vendidas con descuento
  Stock       stock al corte de la fecha "hasta" (y a costo), % vendido, % vencido, % de lo esperado, lotes sin ventas y frenados
  Sucursales  stock, unidades y pesos de cada sucursal
  Descuentos  casos (producto × sucursal con descuento aplicado) y sugerencias aceptadas
  Datos       filas de cada tabla
Las mismas reglas que el tablero: un tipo que no existe en el rubro se descarta y las fechas invertidas se dan vuelta.
Uso: python salidas/auditoria/esperado.py [datos.xlsx] [tablero_datos.json] [salida.json]  →  por defecto, la consigna en salidas/auditoria/esperado.json
"""
import json
import sys

import pandas as pd

x = pd.read_excel(sys.argv[1] if len(sys.argv) > 1 else "datos/viento_sur.xlsx", sheet_name=None)
prod, st, ve, hist = x["productos"], x["stock_sucursal"].copy(), x["ventas"].copy(), x["historial_sugerencias"]
camb, camp, cons = x["cambios_precio"].copy(), x["campanas_activas"], x["propuesta_consultora"]
grupo = {p["sku"]: p["n"] for p in json.load(open(sys.argv[2] if len(sys.argv) > 2 else "salidas/tablero_datos.json"))["productos"]}   # el grupo es nuestro, no del dato crudo
d10 = lambda s: pd.to_datetime(s).dt.strftime("%Y-%m-%d")
ve["fecha"] = d10(ve.fecha)
st["ingreso"], st["limite"] = d10(st.fecha_ingreso), d10(st.fecha_limite)
camb["fecha"] = d10(camb.fecha)
F_MIN, F_MAX = ve.fecha.min(), ve.fecha.max()
lista = prod.set_index("sku").precio_lista
costo = prod.set_index("sku").costo_unitario
mas = lambda f, n: (pd.Timestamp(f) + pd.Timedelta(days=n)).strftime("%Y-%m-%d")
dias = lambda a, b: (pd.Timestamp(b) - pd.Timestamp(a)).days


def lista_vigente(sku, fecha):
    """El precio de lista de ese día: antes de un cambio, el anterior; el catálogo tiene el de después."""
    c = camb[(camb.sku == sku) & (camb.fecha > fecha)].sort_values("fecha")
    return float(c.precio_anterior.iloc[0]) if len(c) else float(lista[sku])


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
    "hasta fin de enero": {"hasta": "2026-01-31"},
    "S03 hasta el 15/02": {"suc": "S03", "hasta": "2026-02-15"},
    "hogar en febrero": {"rubro": "hogar", "desde": "2026-02-01", "hasta": "2026-02-28"},
    "grupo 1 desde marzo": {"grupo": "1", "desde": "2026-03-01"},
    "rubro y tipo incompatibles": {"rubro": "hogar", "tipo": "botas"},
    "desde > hasta": {"desde": "2026-03-01", "hasta": "2026-02-01"},
    "grupo 1 en F01": {"grupo": "1", "suc": "F01"},
}


def productos(f, ignorar_suc=False):
    P = prod[(prod.rubro == f.get("rubro", prod.rubro)) & (prod.tipo == f.get("tipo", prod.tipo)) & (prod.sku == f.get("sku", prod.sku))]
    if "grupo" in f:
        P = P[P.sku.map(grupo).astype(str) == f["grupo"]]
    if "suc" in f and not ignorar_suc:
        P = P[P.sku.isin(st[st.sucursal_id == f["suc"]].sku)]
    return P


def lotes_al_corte(skus, f, D, H):
    """Los lotes que ya estaban a la fecha H, con stock y ventas a esa fecha (mismas definiciones que el Excel)."""
    L = st[st.sku.isin(skus) & (st.ingreso <= H)]
    if "suc" in f:
        L = L[L.sucursal_id == f["suc"]]
    ini = F_MIN
    out = []
    for r in L.itertuples():
        v = ve[(ve.sku == r.sku) & (ve.sucursal_id == r.sucursal_id)]
        cuenta, desde_p = max(r.ingreso, ini), max(r.ingreso, D)
        stock = int(r.unidades + v[v.fecha > H].unidades.sum())
        vend = int(v[(v.fecha >= desde_p) & (v.fecha <= H)].unidades.sum())
        en_periodo = int(v[(v.fecha >= D) & (v.fecha <= H)].unidades.sum())
        v30 = int(v[(v.fecha >= mas(H, -29)) & (v.fecha <= H)].unidades.sum())
        d_obs = dias(cuenta, H) + 1
        ritmo_real = v[(v.fecha >= cuenta) & (v.fecha <= H)].unidades.sum() / d_obs
        ritmo_obj = r.unidades_objetivo / dias(r.ingreso, r.limite)
        out.append(dict(sku=r.sku, suc=r.sucursal_id, stock=stock, vend=vend, en_periodo=en_periodo, v30=v30,
                        ritmo_real=ritmo_real, ritmo_obj=ritmo_obj, vencido=r.limite < H))
    return pd.DataFrame(out, columns=["sku", "suc", "stock", "vend", "en_periodo", "v30", "ritmo_real", "ritmo_obj", "vencido"])


out = {}
for nombre, f0 in ESC.items():
    f = dict(f0)
    if "tipo" in f and not ((prod.tipo == f["tipo"]) & (prod.rubro == f.get("rubro", prod.rubro))).any():
        del f["tipo"]
    D, H = f.get("desde", F_MIN), f.get("hasta", F_MAX)
    if D > H:
        D, H = H, D
    P = productos(f)
    V = ve[ve.sku.isin(P.sku) & (ve.fecha >= D) & (ve.fecha <= H)]
    if "suc" in f:
        V = V[V.sucursal_id == f["suc"]]
    rebajadas = int(sum(r.unidades for r in V.itertuples() if r.precio_unitario < lista_vigente(r.sku, r.fecha) * 0.99))
    L = lotes_al_corte(P.sku, f, D, H)
    stock = int(L.stock.sum())

    # Sucursales: la comparación muestra todas las sucursales (no aplica el filtro de sucursal)
    P_all = productos(f, ignorar_suc=True)
    f_sin_suc = {k: v for k, v in f.items() if k != "suc"}
    L_all = lotes_al_corte(P_all.sku, f_sin_suc, D, H)
    V_all = ve[ve.sku.isin(P_all.sku) & (ve.fecha >= D) & (ve.fecha <= H)]
    sucursales = {}
    for s in sorted(L_all.suc.unique()):
        vs = V_all[V_all.sucursal_id == s]
        sucursales[s] = dict(stock=int(L_all[L_all.suc == s].stock.sum()), u=int(vs.unidades.sum()), pesos=int(round((vs.unidades * vs.precio_unitario).sum())))

    # Descuentos: casos = producto × sucursal (con stock en la foto) de los descuentos aplicados
    aplicados = hist[hist.fecha_vigencia_desde.notna() & hist.sku.isin(P.sku)]
    lotes_foto = st[st.sku.isin(aplicados.sku)]
    if "suc" in f:
        lotes_foto = lotes_foto[lotes_foto.sucursal_id == f["suc"]]
    aceptadas = hist[(hist.aceptacion == 1) & hist.sku.isin(P.sku)]

    out[nombre] = dict(
        filtros=f0, productos=len(P),
        ventas=dict(u=int(V.unidades.sum()), pesos=int(round((V.unidades * V.precio_unitario).sum())), filas=len(V), productos_con_venta=int(V.sku.nunique()),
                    u_dia=round(V.unidades.sum() / (dias(D, H) + 1), 1), pct_descuento=round(rebajadas / (V.unidades.sum() or 1), 4)),
        stock=dict(lotes=len(L), stock=stock, costo=int(round(sum(r.stock * costo[r.sku] for r in L.itertuples()))),
                   pct_vendido=round(L.vend.sum() / ((L.vend.sum() + stock) or 1), 4), pct_vencido=round(L.loc[L.vencido.astype(bool), "stock"].sum() / (stock or 1), 4),
                   pct_esperado=round(L.ritmo_real.sum() / (L.ritmo_obj.sum() or 1), 4), sin_ventas=int((L.en_periodo == 0).sum()),
                   frenados=int(((L.en_periodo > 0) & (L.v30 == 0)).sum())),
        sucursales=sucursales,
        descuentos=dict(casos=len(lotes_foto), productos=int(lotes_foto.sku.nunique()), aceptadas=len(aceptadas)),
        datos=dict(lotes=len(L), ventas=len(V), historial=int(hist.sku.isin(P.sku).sum()), campanas=int(camp.sku.isin(P.sku).sum()),
                   cambios=int(camb.sku.isin(P.sku).sum()), catalogo=len(P), consultora=int(cons.sku.isin(P.sku).sum()), sucursales=len(x["sucursales"])),
    )
json.dump(out, open(sys.argv[3] if len(sys.argv) > 3 else "salidas/auditoria/esperado.json", "w"), ensure_ascii=False, indent=1)
print(pd.DataFrame({k: dict(productos=v["productos"], ventas_u=v["ventas"]["u"], stock=v["stock"]["stock"], lotes=v["stock"]["lotes"],
                            sin_ventas=v["stock"]["sin_ventas"], casos=v["descuentos"]["casos"]) for k, v in out.items()}).T.to_string())
