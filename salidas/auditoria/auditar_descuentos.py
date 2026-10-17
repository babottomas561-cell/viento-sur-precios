"""Auditoría de la pestaña y la hoja Descuentos: cada caso, el control, el índice semanal y los netos, recalculados directo del
Excel original y comparados con lo que exporta el proceso (salidas/tablero_datos.json → descuentos).

El margen de error (bootstrap) no se puede reproducir por otro camino número por número; se contrasta su conclusión
("firme" o no) con un intervalo exacto de Poisson.
Uso: python salidas/auditoria/auditar_descuentos.py
"""
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "salidas/auditoria")
from auditar_decisiones import ic_poisson_ratio  # noqa: E402  (el mismo intervalo exacto)

x = pd.read_excel("datos/viento_sur.xlsx", sheet_name=None)
T = json.load(open("salidas/tablero_datos.json"))["descuentos"]
prod = x["productos"].set_index("sku")
st, ve, hist = x["stock_sucursal"].copy(), x["ventas"].copy(), x["historial_sugerencias"].copy()
camb, camp = x["cambios_precio"], x["campanas_activas"]
ve["fecha"] = pd.to_datetime(ve.fecha)
for c in ["fecha_ingreso", "fecha_limite"]:
    st[c] = pd.to_datetime(st[c])
for c in ["fecha_sugerencia", "fecha_vigencia_desde", "fecha_vigencia_hasta"]:
    hist[c] = pd.to_datetime(hist[c])
INI, FOTO = ve.fecha.min(), ve.fecha.max()
DIAS = pd.date_range(INI, FOTO)
ap = hist.dropna(subset=["fecha_vigencia_desde"])
D0, D1 = ap.fecha_vigencia_desde.min(), ap.fecha_vigencia_hasta.max()
per = np.where(DIAS < D0, "antes", np.where(DIAS <= D1, "durante", "después"))
fallas, chequeos = [], 0


def chk(que, vio, esp, tol=1e-9):
    global chequeos
    chequeos += 1
    if isinstance(esp, (float, np.floating)) and not (pd.isna(vio) and pd.isna(esp)):
        ok = abs(float(vio) - float(esp)) <= tol * max(1, abs(float(esp)))
    else:
        ok = vio == esp
    if not ok:
        fallas.append(f"{que}: el proceso dice {vio}, recalculado da {esp}")


def diario(sku, suc=None):
    v = ve[(ve.sku == sku) & ((ve.sucursal_id == suc) if suc else True)]
    u = v.groupby("fecha").unidades.sum().reindex(DIAS, fill_value=0).values
    p = (v.unidades * v.precio_unitario).groupby(v.fecha).sum().reindex(DIAS, fill_value=0).values
    return u, p


# ---- 1 · cada caso: un producto con descuento en cada sucursal donde tiene stock
casos = {(c["sku"], c["sid"]): c for c in T["casos"]}
esperados = [(a.sku, s) for a in ap.sort_values("descuento_pct").itertuples() for s in st[st.sku == a.sku].sucursal_id]
chk("cantidad de casos", len(casos), len(esperados))
firme_igual = []
for sku, s in esperados:
    c = casos.get((sku, s))
    if c is None:
        fallas.append(f"falta el caso {prod.nombre[sku]} en {s}")
        continue
    lote = st[(st.sku == sku) & (st.sucursal_id == s)].iloc[0]
    esta = np.asarray(DIAS >= max(lote.fecha_ingreso, INI))
    u, p = diario(sku, s)
    marg = p - u * prod.costo_unitario[sku]
    m = {k: u[(per == k) & esta].mean() for k in ["antes", "durante", "después"]}
    nom = f"{prod.nombre[sku]} en {s}"
    for k in m:
        chk(f"{nom} · u/día {k}", c[f"u_{k}"], m[k])
        chk(f"{nom} · $/día {k}", c[f"p_{k}"], p[(per == k) & esta].mean())
        chk(f"{nom} · margen/día {k}", c[f"m_{k}"], marg[(per == k) & esta].mean())
    chk(f"{nom} · durante vs antes", c["dur"], m["durante"] / m["antes"] - 1)
    chk(f"{nom} · después vs antes", c["desp"], m["después"] / m["antes"] - 1)
    chk(f"{nom} · margen durante vs antes", c["mdur"], marg[(per == "durante") & esta].mean() / marg[(per == "antes") & esta].mean() - 1)
    a_, b_ = u[(per == "antes") & esta], u[per == "durante"]
    lo, _ = ic_poisson_ratio(b_.sum(), len(b_), a_.sum(), len(a_))
    firme_igual.append((nom, c["lo"] > 0, lo > 1))

# ---- 2 · control: productos que venden bien y no tuvieron ningún cambio
tocados = set(hist.sku) | set(camp.sku) | set(camb.sku)
ctrl = []
for r in st.itertuples():
    if r.sku in tocados or r.fecha_ingreso > INI:
        continue
    u, _ = diario(r.sku, r.sucursal_id)
    cuenta = max(r.fecha_ingreso, INI)
    ritmo = u[DIAS >= cuenta].sum() / ((FOTO - cuenta).days + 1)
    if ritmo / (r.unidades_objetivo / (r.fecha_limite - r.fecha_ingreso).days) >= 0.90:
        ctrl.append((r.sku, r.sucursal_id, u))
uc = sum(u for _, _, u in ctrl)
chk("control · cantidad de lotes", len(T["control"]) - 1, len(ctrl))
ctot = T["control"][-1]
chk("control · durante vs antes", ctot["dur"], uc[per == "durante"].mean() / uc[per == "antes"].mean() - 1)
chk("control · después vs antes", ctot["desp"], uc[per == "después"].mean() / uc[per == "antes"].mean() - 1)

# ---- 3 · índice semanal (corregido por el control) y netos de cada descuento
rel = np.asarray((DIAS - D0).days)
sem = np.floor(rel / 7).astype(int)
semanas = sorted(k for k in set(sem) if k >= 0)
c_idx = {k: uc[sem == k].mean() / uc[rel < 0].mean() for k in semanas}
chk("cantidad de semanas", len(T["semanas"]), len(semanas))
for i, k in enumerate(semanas):
    chk(f"control · índice semana {i + 1}", T["ctrl_idx"][i], c_idx[k])
netos = {n["sku"]: n for n in T["netos"]}
dur_m, desp_m = np.asarray((DIAS >= D0) & (DIAS <= D1)), np.asarray(DIAS > D1)
for a in ap.sort_values("descuento_pct").itertuples():
    n = netos[a.sku]
    u, _ = diario(a.sku)
    presente = np.asarray(DIAS >= max(st[st.sku == a.sku].fecha_ingreso.min(), INI))
    base = u[(rel < 0) & presente].mean()
    nom = prod.nombre[a.sku]
    chk(f"{nom} · u/día antes (todas sus sucursales)", n["base"], base)
    for i, k in enumerate(semanas):
        chk(f"{nom} · índice semana {i + 1}", n["idx"][i], u[sem == k].mean() / base / c_idx[k])
    esperado = np.array([base * c_idx.get(k, 1) if k >= 0 else base for k in sem])
    precio, costo, d = prod.precio_lista[a.sku], prod.costo_unitario[a.sku], a.descuento_pct / 100
    chk(f"{nom} · unidades extra durante", n["extra_dur"], (u - esperado)[dur_m].sum())
    chk(f"{nom} · unidades extra después", n["extra_desp"], (u - esperado)[desp_m].sum())
    chk(f"{nom} · margen durante", n["m_dur"], (u[dur_m] * (precio * (1 - d) - costo) - esperado[dur_m] * (precio - costo)).sum())
    chk(f"{nom} · margen después", n["m_desp"], ((u[desp_m] - esperado[desp_m]) * (precio - costo)).sum())

print(f"Descuentos: {chequeos} chequeos · {len(fallas) or 'sin'} diferencias")
for f in fallas[:30]:
    print("  ✗", f)
dif = [x for x in firme_igual if x[1] != x[2]]
print(f"Margen de error: el bootstrap y el intervalo exacto de Poisson coinciden en {len(firme_igual) - len(dif)} de {len(firme_igual)} casos sobre si la suba es firme"
      + ("" if not dif else "; difieren en " + ", ".join(f"{n} (bootstrap {'firme' if b else 'no'}, Poisson {'firme' if p else 'no'})" for n, b, p in dif)))
total_m = sum(netos[s]["m_dur"] + netos[s]["m_desp"] for s in netos)
print(f"Margen neto de los 8 descuentos: $ {total_m:,.0f}")
