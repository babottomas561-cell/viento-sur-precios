"""Auditoría de las decisiones: vuelve a aplicar las reglas a los 48 productos por otro camino, directo del Excel original,
y compara con lo que propone el proceso (salidas/tablero_datos.json). También recalcula la evidencia de cada tipo,
los escenarios de los descuentos y los chequeos de la consultora, y prueba qué tan sensibles son las conclusiones.

Uso: python salidas/auditoria/auditar_decisiones.py
"""
import json
from math import comb

import numpy as np
import pandas as pd

x = pd.read_excel("datos/viento_sur.xlsx", sheet_name=None)
T = json.load(open("salidas/tablero_datos.json"))
R = T["criterios"]                                  # los umbrales que usa el proceso (también están en la nota)
prod = x["productos"].set_index("sku")
st = x["stock_sucursal"].copy()
ve = x["ventas"].copy()
hist, camb, camp, cons = x["historial_sugerencias"].copy(), x["cambios_precio"].copy(), x["campanas_activas"].copy(), x["propuesta_consultora"].set_index("sku")
for df, cols in [(st, ["fecha_ingreso", "fecha_limite"]), (ve, ["fecha"]), (hist, ["fecha_sugerencia", "fecha_vigencia_desde", "fecha_vigencia_hasta"]),
                 (camb, ["fecha"]), (camp, ["fecha_desde", "fecha_hasta"])]:
    for c in cols:
        df[c] = pd.to_datetime(df[c])
INI, FOTO = ve.fecha.min(), ve.fecha.max()
RECIENTE = FOTO - pd.Timedelta(days=R["dias_en_curso"])
dias_ventana = (FOTO - INI).days + 1
fallas, notas = [], []


def chk(que, vio, esp):
    if vio != esp:
        fallas.append(f"{que}: el proceso dice {vio!r}, recalculado da {esp!r}")


# ---------------------------------------------------------------- 1 · métricas por lote y por producto
lot = []
for r in st.itertuples():
    v = ve[(ve.sku == r.sku) & (ve.sucursal_id == r.sucursal_id)]
    cuenta = max(r.fecha_ingreso, INI)
    vend = v[v.fecha >= cuenta].unidades.sum()
    d_obs = (FOTO - cuenta).days + 1
    lot.append(dict(sku=r.sku, suc=r.sucursal_id, unidades=r.unidades, ingreso=r.fecha_ingreso, cuenta=cuenta, vend=vend,
                    v30=v[v.fecha > FOTO - pd.Timedelta(days=30)].unidades.sum(), ritmo_real=vend / d_obs,
                    ritmo_obj=r.unidades_objetivo / (r.fecha_limite - r.fecha_ingreso).days, vencido=r.fecha_limite < FOTO, limite=r.fecha_limite,
                    ventas_antes_ingreso=v[v.fecha < r.fecha_ingreso].unidades.sum()))
L = pd.DataFrame(lot)
g = L.groupby("sku")
P = pd.DataFrame({"stock": g.unidades.sum(), "vendidas": g.vend.sum(), "v30": g.v30.sum(),
                  "pct_esperado": g.ritmo_real.sum() / g.ritmo_obj.sum(), "ingreso_min": g.ingreso.min(), "cuenta_min": g.cuenta.min()})
P = P.join(prod[["nombre", "tipo", "proveedor", "precio_lista", "costo_unitario"]])
P["margen"] = 1 - P.costo_unitario / P.precio_lista
P["meses"] = P.stock / P.v30.replace(0, np.nan)
P["u_vencidas"] = L[L.vencido].groupby("sku").unidades.sum().reindex(P.index).fillna(0).astype(int)
P["share_vencido"] = P.u_vencidas / P.stock
diario = ve.groupby(["sku", "fecha"]).unidades.sum().unstack(fill_value=0).reindex(columns=pd.date_range(INI, FOTO), fill_value=0)
antes = diario.loc[:, diario.columns <= FOTO - pd.Timedelta(days=30)]
P["v_antes_mes"] = antes.mean(axis=1).reindex(P.index).fillna(0) * 30                       # como lo define el proceso
P["v_antes_mes_presente"] = [antes.loc[s, antes.columns >= P.cuenta_min[s]].mean() * 30 if s in antes.index and (antes.columns >= P.cuenta_min[s]).any() else 0
                             for s in P.index]                                              # solo los días en que el producto estaba
P["share_sin_venta"] = L[L.vend == 0].groupby("sku").unidades.sum().reindex(P.index).fillna(0) / P.stock
P["rank_tipo"] = P.groupby("tipo").precio_lista.rank(method="min").astype(int)
P["n_tipo"] = P.groupby("tipo").precio_lista.transform("size")
acep = hist[(hist.aceptacion == 1) & (hist.fecha_sugerencia <= RECIENTE)]
P["aceptados_antes"] = acep.groupby("sku").size().reindex(P.index).fillna(0).astype(int)
camp_v = set(camp[(camp.fecha_desde <= FOTO) & (camp.fecha_hasta >= FOTO)].sku)
cambio_r = set(camb[camb.fecha > RECIENTE].sku)
sug_r = hist[hist.fecha_sugerencia > RECIENTE].sort_values("fecha_sugerencia").groupby("sku").last()
P["en_curso"] = [s in camp_v or s in cambio_r or s in sug_r.index for s in P.index]

# ---------------------------------------------------------------- 2 · evidencia de cada tipo (la cuenta de la consigna)
ap = hist.dropna(subset=["fecha_vigencia_desde"])
D0, D1 = ap.fecha_vigencia_desde.min(), ap.fecha_vigencia_hasta.max()
tocados = set(hist.sku) | set(camp.sku) | set(camb.sku)
ctrl = L[~L.sku.isin(tocados) & (L.ritmo_real / L.ritmo_obj >= R["al_dia"]) & (L.ingreso <= INI)]
uc = sum(diario.loc[s].values for s in ctrl.sku.unique()) if len(ctrl) else None
# (el control suma lotes; acá se suman los productos del control en sus sucursales de control)
uc = ve[ve.set_index(["sku", "sucursal_id"]).index.isin(list(zip(ctrl.sku, ctrl.suc)))].groupby("fecha").unidades.sum().reindex(pd.date_range(INI, FOTO), fill_value=0)
ctrl_despues = uc[uc.index > D1].mean() / uc[uc.index < D0].mean()


def ic_poisson_ratio(a, ta, b, tb, conf=0.90):
    """Intervalo exacto para el cociente de dos tasas de Poisson (a ventas en ta días contra b en tb días), vía la binomial condicional."""
    n = a + b
    if n == 0:
        return np.nan, np.nan
    def cdf(k, p): return sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))
    def raiz(f):
        lo, hi = 1e-9, 1 - 1e-9
        for _ in range(80):
            m = (lo + hi) / 2
            lo, hi = (m, hi) if f(m) > 0 else (lo, m)
        return (lo + hi) / 2
    al = (1 - conf) / 2
    pl = 0 if a == 0 else raiz(lambda p: (1 - cdf(a - 1, p)) - al < 0 and 1 or -1)
    pu = 1 if a == n else raiz(lambda p: cdf(a, p) - al > 0 and 1 or -1)
    r = lambda p: (p / (1 - p)) * (tb / ta)
    return r(pl), r(pu)


ev = {}
for a_ in ap.itertuples():
    u = diario.loc[a_.sku]
    presente = u.index >= P.cuenta_min[a_.sku]
    con = (u.index >= a_.fecha_vigencia_desde) & (u.index <= a_.fecha_vigencia_hasta)
    resp = u[con].mean() / u[~con & presente].mean()
    despues = (u[u.index > D1].mean() / u[(u.index < D0) & presente].mean()) / ctrl_despues
    lo, hi = ic_poisson_ratio(u[con].sum(), con.sum(), u[~con & presente].sum(), (~con & presente).sum())
    ev[prod.tipo[a_.sku]] = dict(referencia=prod.nombre[a_.sku], descuento=a_.descuento_pct / 100, respuesta=resp, despues=despues, ic_lo=lo, ic_hi=hi)
EV = pd.DataFrame(ev).T
EVt = pd.DataFrame(T["evidencia"]).set_index("tipo")
for t in EV.index:
    chk(f"evidencia · {t} respuesta", round(EVt.respuesta[t], 4), round(EV.respuesta[t], 4))
    chk(f"evidencia · {t} después", round(EVt.despues[t], 4), round(EV.despues[t], 4))

# ---------------------------------------------------------------- 3 · las reglas, en orden
def grupo(s, f):
    al_dia = f.pct_esperado >= R["al_dia"]
    for n, cumple in [(3, f.en_curso), (1, al_dia and f.meses < R["meses_reponer"]), (2, al_dia), (4, f.vendidas == 0),
                      (5, f.v_antes_mes / 30 >= R["corte_u_dia"] and f.v30 < R["corte_ratio"] * f.v_antes_mes),
                      (6, f.share_sin_venta > R["mal_ubicado"] and f.vendidas > 0), (7, f.aceptados_antes >= R["aceptados_repetidos"]),
                      (8, (f.margen - 0.10) / 0.90 < R["margen_minimo"]), (9, True)]:
        if cumple:
            return n


def veredicto(f):
    """Criterios del descuento: obligatorios (su tipo responde y queda margen) y dos más (no es el más barato; en su tipo la venta
    no cayó después, salvo que más de la mitad del stock haya vencido). Firme: todo -> bajar, falla uno -> probar.
    Débil: solo probar y con todo. Stock mayormente vencido: como mucho probar."""
    if f.tipo not in EV.index:
        return "no"
    e = EV.loc[f.tipo]
    firme = EVt.firme[f.tipo]                         # el rango por azar del proceso (se contrasta abajo con otro método)
    d = e.descuento
    m_desp = (f.precio_lista * (1 - d) - f.costo_unitario) / (f.precio_lista * (1 - d))
    vencido = f.share_vencido > R["vencido_mayoria"]
    ok = [f.rank_tipo > 1] + ([] if vencido else [e.despues >= R["despues_minimo"]])
    debil = (not firme) and e.respuesta >= R["respuesta_debil"] and e.despues >= R["despues_minimo"]
    fallan = len(ok) - sum(ok)
    if m_desp < R["margen_minimo"] or not (firme or debil):
        return "no"
    v = ("probar" if fallan == 0 else "no") if debil else ("bajar" if fallan == 0 else "probar" if fallan == 1 else "no")
    return "probar" if vencido and v == "bajar" else v


P["grupo"] = [grupo(s, f) for s, f in P.iterrows()]
P["veredicto"] = [veredicto(f) for _, f in P.iterrows()]


def nuestro(s, f):
    G, v = f.grupo, f.veredicto
    if G == 9 and v in ("bajar", "probar"):
        return "ya"
    if G == 3 and s not in cambio_r and s not in camp_v and s in sug_r.index and sug_r.aceptacion[s] == 1:
        return "ya"
    if v in ("bajar", "probar") and (G in (2, 7) or (G == 3 and s not in cambio_r)):
        return "condicional"
    return "no"


P["nuestro"] = [nuestro(s, f) for s, f in P.iterrows()]
TP = pd.DataFrame(T["productos"]).set_index("sku")
for s in P.index:
    chk(f"{P.nombre[s]} · grupo", int(TP.n[s]), int(P.grupo[s]))
    chk(f"{P.nombre[s]} · descuento", TP.nuestro[s], P.nuestro[s])
    if TP.n[s] == P.grupo[s] == 9:
        chk(f"{P.nombre[s]} · veredicto del descuento", TP.criterios[s].get("veredicto"), P.veredicto[s])

# ---------------------------------------------------------------- 3b · la escalera del stock vencido y el sobrante del grupo 2
from datetime import datetime as _dt
for s_, f in P.iterrows():
    t = TP.loc[s_]
    chk(f"{f.nombre} · unidades vencidas", int(t.u_vencidas), int(f.u_vencidas))
    if not f.u_vencidas:
        chk(f"{f.nombre} · sin stock vencido no hay salida", pd.isna(t.salida), True)
        continue
    ini = pd.Timestamp(_dt.strptime(t.revisar, "%d/%m/%Y"))           # la fecha de revisión de la primera acción
    vig = camp[(camp.sku == s_) & (camp.fecha_desde <= FOTO) & (camp.fecha_hasta >= FOTO)]
    if len(vig):
        ini = max(ini, vig.fecha_hasta.max() + pd.Timedelta(days=1))  # con campaña en curso, cuando termina
    d_hoy = 0 if pd.isna(t.descuento) else t.descuento / 100
    escalones = [d for d in R["escalera"] if d > d_hoy and d <= f.margen]
    chk(f"{f.nombre} · fecha de salida", t.salida, f"{ini + pd.Timedelta(days=R['escalon_dias'] * len(escalones)):%Y-%m-%d}")
for s_, f in P[P.grupo == 2].iterrows():
    l_ = L[L.sku == s_]
    sobra = float((l_.unidades - l_.ritmo_real * (l_.limite - FOTO).dt.days.clip(lower=0)).clip(lower=0).sum())
    chk(f"{f.nombre} · sobrante proyectado (grupo 2)", round(TP.sobrante[s_], 6), round(sobra, 6))

# ---------------------------------------------------------------- 4 · consultora
desc = cons.descuento_pct > 0
chk("consultora · productos que descuenta", T["k"]["cons_desc"], int(desc.sum()))
chk("consultora · coincide con la propuesta", T["k"]["coincide"], int((desc == (P.nuestro != "no")).sum()))
mas_stock = cons.unidades_proyectadas_30d > P.stock
bajo_costo = (P.precio_lista * (1 - cons.descuento_pct / 100) < P.costo_unitario) & desc
chk("consultora · proyecta más que el stock", T["consultora"]["chequeos"] and next((c["productos"] for c in T["consultora"]["chequeos"] if "más unidades" in c["chequeo"]), None), int(mas_stock.sum()))
chk("consultora · vende bajo costo", next((c["productos"] for c in T["consultora"]["chequeos"] if "bajo costo" in c["chequeo"]), None), int(bajo_costo.sum()))

# ---------------------------------------------------------------- 5 · afirmaciones de la nota
chk("nota · productos atrasados", T["k"]["atrasados"], int((P.pct_esperado < R["al_dia"]).sum()))
chk("nota · % del stock vencido", round(T["k"]["vencidas"] / T["k"]["stock"], 4), round(L[L.vencido].unidades.sum() / L.unidades.sum(), 4))
acept_all = hist[hist.aceptacion == 1]
chk("nota · aceptadas", T["consultora"]["aceptadas"], len(acept_all))
chk("nota · aceptadas con fechas (aplicadas)", T["consultora"]["aplicadas"], int(acept_all.fecha_vigencia_desde.notna().sum()))
nota_txt = open("salidas/nota.md").read()
verif = len(acept_all) - int((acept_all.fecha_vigencia_desde.isna() & (acept_all.fecha_sugerencia < INI)).sum())
chk("nota · dice cuántas aceptadas se pueden verificar", f"de las {verif} sugerencias aceptadas que se pueden verificar" in nota_txt, True)

# ---------------------------------------------------------------- 5b · las 5 causas, los indicadores de la ficha y lo que dice la nota de cada causa
causas_txt = open("salidas/causas.md").read()          # las 5 causas en cuatro pasos (la nota las resume en una tabla)
mil_ = lambda v: f"{v:,.0f}".replace(",", ".")
pct_ = lambda v: f"{v * 100:,.0f} %".replace(",", ".")
CAUSA_G = {1: "ok", 2: "ok", 3: "ejecucion", 7: "ejecucion", 4: "producto", 5: "producto", 6: "producto", 8: "compra", 9: "precio"}
TP = {p["sku"]: p for p in T["productos"]}
for s, f in P.iterrows():
    chk(f"causa · {f.nombre}", TP[s].get("causa"), CAUSA_G[f.grupo])
# Ventas con rebaja, por otro camino: precio de lista vigente ese día = el anterior a la primera suba posterior (o el de lista)
def lista_vigente(r):
    c = camb[(camb.sku == r.sku) & (camb.fecha > r.fecha)].sort_values("fecha")
    return c.precio_anterior.iloc[0] if len(c) else prod.precio_lista[r.sku]
ve["lista_vig"] = [lista_vigente(r) for r in ve.itertuples()]
reb = lambda s, desde=INI, hasta=FOTO: ((v := ve[(ve.sku == s) & (ve.fecha >= desde) & (ve.fecha <= hasta)])[v.precio_unitario < v.lista_vig - 0.5].unidades.sum(), v.unidades.sum())
ind_val = lambda s, nombre: next((i["valor"] for i in TP[s]["indicadores"] if i["nombre"] == nombre), None)
for s, f in P[P.grupo.isin([5, 7])].iterrows():
    u_r, u_t = reb(s)
    chk(f"ficha · {f.nombre} unidades con rebaja", ind_val(s, "Unidades vendidas con rebaja"), f"{mil_(u_r)} de {mil_(u_t)}")
camp_hasta = camp[camp.fecha_desde <= FOTO]
camp_con_rebaja = sum(reb(c.sku, c.fecha_desde, min(c.fecha_hasta, FOTO))[0] for c in camp_hasta.itertuples())
chk("causas · unidades con rebaja en las campañas", f"Las {len(camp_hasta)} campañas cargadas: **{mil_(camp_con_rebaja)} unidades** vendidas con rebaja" in causas_txt, True)
# Compra: margen contra el de su tipo con otros proveedores, cuánto debería costar y lo vendido por proveedor
G8 = P[P.grupo == 8]
par = G8.apply(lambda f: P[(P.tipo == f.tipo) & (P.proveedor != f.proveedor)].margen.median(), axis=1)
costo_par = G8.precio_lista * (1 - par)
dif = 1 - costo_par / G8.costo_unitario
vend_prov = P.groupby("proveedor").vendidas.sum()
otros = vend_prov.drop(G8.proveedor.unique())
chk("causas · compra: cuánto menos debería costar", f"tendrían que costar **{pct_(dif.min())} a {pct_(dif.max())} menos**" in causas_txt, True)
chk("causas · compra: $ sobre el stock", f"$ {(((G8.costo_unitario - costo_par) * G8.stock).sum() / 1e6):.1f} M".replace(".", ",") in causas_txt, True)
chk("causas · compra: vendido por proveedor", f"vendió **{mil_(vend_prov[G8.proveedor.unique()].sum())} u**, contra {mil_(otros.min())} a {mil_(otros.max())}" in causas_txt, True)
# Stock vencido: lotes, misma fecha y cuántos no se venderían en un año al ritmo del último mes
LV = L[L.vencido]
anio = int((LV.unidades > LV.v30 / 30 * 365).sum())
chk("causas · lotes vencidos", f"Los {len(LV)} lotes vencidos vencieron {f'el mismo día ({LV.limite.min():%d/%m})' if LV.limite.nunique() == 1 else 'en fechas distintas'} y **{anio} no se venderían ni en un año**" in causas_txt, True)
# Lo que prueba cada tarjeta, por otro camino
G1, G4, G5, G6 = (P[P.grupo == n] for n in (1, 4, 5, 6))
chk("causas · venden bien: % de lo esperado y días de stock", f"venden el **{pct_(G1.pct_esperado.min())} o más** de lo esperado y el stock les alcanza para "
    f"**{mil_(G1.meses.min() * 30)} a {mil_(G1.meses.max() * 30)} días**" in causas_txt, True)
chk("causas · se cortaron", f"vendían {mil_(G5.v_antes_mes.min())} a {mil_(G5.v_antes_mes.max())} u por mes y el último mes {mil_(G5.v30.min())} a {mil_(G5.v30.max())}" in causas_txt, True)
chk("causas · mal ubicados", f"el {pct_(G6.share_sin_venta.min())} a {pct_(G6.share_sin_venta.max())} de su stock está en locales donde nunca vendieron" in causas_txt, True)
chk("causas · cumbre: margen con 10 %", f"quedarían en {pct_(((G8.margen - .1) / .9).min())} a {pct_(((G8.margen - .1) / .9).max())}" in causas_txt, True)
# El mensaje central: stock donde el precio puede ser la causa y cuántos pasan los criterios
P9 = P[P.grupo == 9]
chk("nota · mensaje central", f"solo el {pct_(P9.stock.sum() / P.stock.sum())} del stock ({mil_(P9.stock.sum())} u)" in nota_txt
    and f"pasa los criterios en {int((P9.nuestro != 'no').sum())} de {len(P9)}" in nota_txt, True)
for k in ["ok", "ejecucion", "producto", "compra", "precio"]:
    d = P[P.grupo.map(CAUSA_G) == k]
    chk(f"nota · tabla de causas, {k}", f"| {len(d)} | {mil_(d.stock.sum())} u ({pct_(d.stock.sum() / P.stock.sum())}) |" in nota_txt, True)

# ---------------------------------------------------------------- 6 · sensibilidad y supuestos (para el juicio crítico)
print("== Coinciden reglas, descuentos y consultora:", "sí" if not fallas else f"no, {len(fallas)} diferencias")
for f_ in fallas:
    print("   ✗", f_)
print("\n== Evidencia por tipo: rango del proceso (bootstrap) contra intervalo exacto de Poisson (90 %)")
for t, e in EV.sort_values("respuesta", ascending=False).iterrows():
    print(f"   {t:11} {e.referencia:28} {e.descuento:.0%}  respuesta {e.respuesta - 1:+.0%}  bootstrap [{EVt.bajo[t] - 1:+.0%}, {EVt.alto[t] - 1:+.0%}] "
          f"firme={EVt.firme[t]}  ·  Poisson [{e.ic_lo - 1:+.0%}, {e.ic_hi - 1:+.0%}] firme={e.ic_lo > 1}  ·  después {e.despues - 1:+.0%}")
print(f"\n== Control: {len(ctrl)} lotes de {ctrl.sku.nunique()} productos ({', '.join(prod.nombre[s] for s in ctrl.sku.unique())})")
print("\n== Grupo 5 si 'vendía antes' cuenta solo los días en que el producto estaba:")
for s, f in P.iterrows():
    g_alt = 5 if (f.v_antes_mes_presente / 30 >= R["corte_u_dia"] and f.v30 < R["corte_ratio"] * f.v_antes_mes_presente) else None
    if (f.grupo == 5) != (g_alt == 5) and f.grupo >= 5:
        print(f"   {f.nombre}: grupo {f.grupo}; con días presentes vendía {f.v_antes_mes_presente:.0f} u/mes (el proceso usa {f.v_antes_mes:.0f}); último mes {f.v30}")
print("\n== Grupo 2 ('recién llegado'): fecha de ingreso de cada uno")
for s, f in P[P.grupo == 2].iterrows():
    print(f"   {f.nombre}: ingresó el {f.ingreso_min:%d/%m/%Y} · {f.pct_esperado:.0%} de lo esperado · stock para {f.meses:.1f} meses")
print("\n== Supuesto del stock reconstruido: ventas anteriores al ingreso del lote (indicarían otra mercadería)")
v_ant = L[L.ventas_antes_ingreso > 0]
print(f"   {len(v_ant)} lotes con ventas antes de su ingreso" + (": " + ", ".join(f"{prod.nombre[r.sku]} en {r.suc} ({r.ventas_antes_ingreso} u)" for r in v_ant.itertuples()) if len(v_ant) else ""))
print("\n== Aceptadas: cuántas se pueden verificar en las ventas")
sin_f = acept_all[acept_all.fecha_vigencia_desde.isna()]
print(f"   {len(acept_all)} aceptadas · {acept_all.fecha_vigencia_desde.notna().sum()} con fechas · {len(sin_f)} sin fechas, de las cuales "
      f"{(sin_f.fecha_sugerencia < INI).sum()} son anteriores al {INI:%d/%m/%Y} (no hay ventas para verificarlas)")
