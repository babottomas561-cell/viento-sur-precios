"""Auditoría del seguimiento: vuelve a medir cada recomendación por otro camino, directo del Excel original, y la compara
con lo que muestra el tablero (web/datos.js): unidades vendidas desde la recomendación, unidades por semana, precio cobrado,
si el descuento se ve en caja y si cumple su regla. También chequea que los dos grupos del resumen (ya llegaron a su revisión
y en curso) no se pisen y sumen el total.

Uso: python salidas/auditoria/auditar_seguimiento.py   (después de cargar las fotos con actualizar.py)
"""
import json

import pandas as pd

t = open("web/datos.js", encoding="utf-8").read()
D = json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
SG, FOTO = D.get("seguimiento") or [], D["foto_iso"]
ve = pd.read_excel("datos/viento_sur.xlsx", sheet_name="ventas")
ve["fecha"] = pd.to_datetime(ve.fecha).dt.strftime("%Y-%m-%d")
fallas, chequeos = [], 0
# los locales donde la ficha del grupo 6 pide las primeras ventas, de la recomendación de cada Excel anterior (base local)
import re, sqlite3
con = sqlite3.connect("datos/viento_sur.db")
FICHA = {(f, s): re.findall(r"S\d\d", ind or "") for f, s, ind in con.execute("SELECT fecha_foto, sku, indicador FROM decisiones WHERE grupo = 6")}


def chk(que, vio, esp):
    global chequeos
    chequeos += 1
    if vio != esp:
        fallas.append(f"{que}: el tablero dice {vio!r}, recalculado da {esp!r}")


for r in SG:
    v = ve[(ve.sku == r["sku"]) & (ve.fecha > r["desde"]) & (ve.fecha <= FOTO)]
    u = int(v.unidades.sum())
    dias = max((pd.Timestamp(FOTO) - pd.Timestamp(r["desde"])).days, 1)
    u_sem = u / dias * 7
    cobrado = float((v.unidades * v.precio_unitario).sum() / u) if u else None
    aplicado = cobrado is not None and cobrado < r["precio_lista"] * 0.99
    chk(f"{r['producto']} · días medidos", r["dias"], dias)
    chk(f"{r['producto']} · unidades por semana", round(r["u_sem_despues"], 6), round(u_sem, 6))
    chk(f"{r['producto']} · precio cobrado", None if r["precio_cobrado"] is None else round(r["precio_cobrado"], 2), None if cobrado is None else round(cobrado, 2))
    chk(f"{r['producto']} · ¿se ve en caja?", r["aplicado"], aplicado)
    # la regla, escrita de nuevo a partir de lo que se recomendó
    base, n, acc, meta = r["u_sem_antes"] or 0, r["n"], r["accion"], r["meta_u_sem"]
    if r["nuestro"] == "ya":
        cumple = bool(u) and aplicado and (meta is None or u_sem >= meta)
    elif n == 7 or acc.startswith("Esperar · confirmar la campaña"):
        cumple = bool(u) and aplicado
    elif n == 1:
        cumple = r["stock_ahora"] > 0 and u_sem >= base * 0.9
    elif n == 2:
        cumple = u_sem > base                                       # el sobrante proyectado baja solo si vende más rápido
    elif acc.startswith("Esperar · revisar la suba"):
        cumple = u_sem >= base * 0.9
    elif n == 4:
        cumple = u > 0
    elif n == 5 and meta:
        cumple = u_sem >= meta                                      # volver a lo que vendía antes
    elif n == 6 and FICHA.get((r["desde"], r["sku"])):
        cumple = all(v[v.sucursal_id == s_].unidades.sum() > 0 for s_ in FICHA[(r["desde"], r["sku"])])
    elif n in (5, 6) and not acc.startswith("No tocar"):
        cumple = (u_sem > base * 1.1) if base else u > 0
    else:
        cumple = None
    chk(f"{r['producto']} · ¿cumple su regla?", r["cumple"], cumple)

ya = [r for r in SG if r["revisar"] and r["revisar"] <= FOTO]
curso = [r for r in SG if not (r["revisar"] and r["revisar"] <= FOTO)]
chk("resumen · los dos grupos suman el total y no se pisan", len(ya) + len(curso), len(SG))
print(f"Seguimiento: {len(SG)} recomendaciones · {chequeos} chequeos · {len(fallas) or 'sin'} diferencias")
print(f"   ya llegaron a su revisión {len(ya)}: cumplieron {sum(r['cumple'] is True for r in ya)}, no {sum(r['cumple'] is False for r in ya)}, fuera de las ventas {sum(r['cumple'] is None for r in ya)}")
print(f"   en curso {len(curso)}: van bien {sum(r['cumple'] is True for r in curso)}, todavía no {sum(r['cumple'] is False for r in curso)}, fuera de las ventas {sum(r['cumple'] is None for r in curso)}")
for f in fallas[:40]:
    print("  ✗", f)
raise SystemExit(1 if fallas else 0)
