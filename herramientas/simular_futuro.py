"""Herramienta de demostración: simula cómo siguieron las ventas después del 15/03, semana por semana, para ver el seguimiento
de la propuesta funcionando. LOS DATOS SON INVENTADOS: no es parte del análisis y no dice nada sobre si la propuesta funciona.

Parte del Excel de la consigna y de la propuesta que el proceso hizo con él (salidas/tablero_datos.json):
  - cada lote sigue vendiendo a su ritmo del último mes, con azar (Poisson) y sin superar su stock (no hay reposiciones);
  - las recomendaciones se aplican solo en parte, como pasaría en los locales (con una semilla fija, siempre igual):
      descuento ahora           3 de cada 4 se cobran en caja; la venta sube como respondió su tipo, con el 70 % del efecto
                                (la evidencia se midió en productos que venden bien: para los lentos es un techo)
      confirmar descuentos      la mitad empieza a cobrar el último descuento aceptado
      nunca vendió: exhibir     2 de cada 3 empiezan a vender (0,25 u por día en cada local)
      se cortó: investigar      la mitad vuelve al 70 % de lo que vendía antes
      mal ubicado: exhibición   la mitad vende en los locales donde estaba quieto (0,2 u por día)
      vende bien: reponer       3 de cada 4 reponen: cuando a un local le quedan menos de 15 días, entran 30 días de venta
      el resto                  sigue como venía
  - el stock baja con las ventas (y sube con las reposiciones) y la antigüedad de cada lote se actualiza; las otras hojas quedan igual.
Cada archivo se llama demo_futuro_al_<fecha>.xlsx: el tablero reconoce "demo" en el nombre y avisa que son datos simulados.

Uso:  python herramientas/simular_futuro.py                    -> datos/demo/demo_futuro_al_2026-03-22.xlsx … _2026-04-12.xlsx
      python herramientas/simular_futuro.py --semanas 2 --semilla 3
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
ap.add_argument("--datos", default="datos/viento_sur.xlsx")
ap.add_argument("--propuesta", default="salidas/tablero_datos.json", help="la propuesta que el proceso hizo con ese Excel")
ap.add_argument("--semanas", type=int, default=4)
ap.add_argument("--semilla", type=int, default=7)
ap.add_argument("--carpeta", default="datos/demo")
args = ap.parse_args()

h = pd.read_excel(args.datos, sheet_name=None)
D = json.load(open(args.propuesta, encoding="utf-8"))
rng = np.random.default_rng(args.semilla)
ventas = h["ventas"].copy()
ventas["fecha"] = pd.to_datetime(ventas.fecha)
hoy = ventas.fecha.max()                                       # 15/03/2026
lista = h["productos"].set_index("sku").precio_lista
stock = h["stock_sucursal"].set_index(["sku", "sucursal_id"]).unidades.astype(int).to_dict()
ult30 = ventas[ventas.fecha > hoy - pd.Timedelta(days=30)].groupby(["sku", "sucursal_id"]).unidades.sum() / 30
respuesta = {e["tipo"]: e["respuesta"] for e in D["evidencia"]}
acept = h["historial_sugerencias"].query("aceptacion == 1").sort_values("fecha_sugerencia").groupby("sku").descuento_pct.last()

# Lo que pasa en cada producto desde el 16/03: ritmo por local y precio cobrado (se decide una vez, con la semilla)
ritmo = {k: float(ult30.get(k, 0.0)) for k in stock}
precio = {s: float(lista[s]) for s in lista.index}
aplicado, repone = {}, set()
for p in sorted(D["productos"], key=lambda p: p["sku"]):
    s, n = p["sku"], p["n"]
    locales = [k for k in stock if k[0] == s]
    efecto = lambda d: 1 + (respuesta.get(p["tipo"], 1.0) - 1) * 0.7
    if p["nuestro"] == "ya":
        if rng.random() < 0.75:
            precio[s] = round(lista[s] * (1 - p["descuento"] / 100))
            for k in locales:
                ritmo[k] *= efecto(p["descuento"])
            aplicado[s] = f"descuento del {p['descuento']:.0f} % cobrado en caja"
        else:
            aplicado[s] = "descuento aprobado, pero no se cobra en caja"
    elif n == 7 and rng.random() < 0.5 and s in acept:
        precio[s] = round(lista[s] * (1 - acept[s] / 100))
        for k in locales:
            ritmo[k] *= efecto(acept[s])
        aplicado[s] = f"empezó a cobrar el {acept[s]} % aceptado"
    elif n == 4 and rng.random() < 2 / 3:
        for k in locales:
            ritmo[k] = 0.25
        aplicado[s] = "se exhibió y empezó a vender"
    elif n == 5 and p["accion"].startswith("No bajar") and rng.random() < 0.5:
        antes = (ventas[(ventas.sku == s) & (ventas.fecha <= hoy - pd.Timedelta(days=30))].unidades.sum()
                 / max((hoy - pd.Timedelta(days=30) - ventas.fecha.min()).days, 1))
        tot = sum(stock[k] for k in locales) or 1
        for k in locales:
            ritmo[k] = 0.7 * antes * stock[k] / tot
        aplicado[s] = "se encontró la causa del corte y volvió a vender"
    elif n == 1 and rng.random() < 0.75:
        repone.add(s)
        aplicado[s] = "se repuso a tiempo"
    elif n == 6 and p["accion"].startswith("No bajar") and rng.random() < 0.5:
        for suc in re.findall(r"S\d\d", p["indicador"] or ""):
            if (s, suc) in ritmo:
                ritmo[(s, suc)] = 0.2
        aplicado[s] = "se mejoró la exhibición y vendió donde estaba quieto"

# Día por día, hasta la última semana
nuevas, carpeta = [], Path(args.carpeta)
carpeta.mkdir(parents=True, exist_ok=True)
for dia in range(1, 7 * args.semanas + 1):
    fecha = hoy + pd.Timedelta(days=dia)
    for k in sorted(stock):
        if k[0] in repone and ritmo[k] > 0 and stock[k] < 15 * ritmo[k]:
            stock[k] += round(30 * ritmo[k])                     # llega la reposición
        u = min(int(rng.poisson(ritmo[k])), stock[k]) if ritmo[k] > 0 and stock[k] > 0 else 0
        if u:
            stock[k] -= u
            nuevas.append(dict(fecha=fecha, sku=k[0], sucursal_id=k[1], unidades=u, precio_unitario=int(precio[k[0]])))
    if dia % 7 == 0:                                           # cierre de semana: un Excel con los datos a ese día
        x = {nombre: hoja.copy() for nombre, hoja in h.items()}
        v = pd.concat([ventas, pd.DataFrame(nuevas)], ignore_index=True)
        v["fecha"] = v.fecha.dt.strftime("%Y-%m-%d")
        x["ventas"] = v
        st = x["stock_sucursal"]
        st["unidades"] = [stock[(r.sku, r.sucursal_id)] for r in st.itertuples()]
        st["antiguedad_dias"] = [(fecha - pd.Timestamp(r.fecha_ingreso)).days for r in st.itertuples()]
        salida = carpeta / f"demo_futuro_al_{fecha:%Y-%m-%d}.xlsx"
        with pd.ExcelWriter(salida) as w:
            for nombre, hoja in x.items():
                hoja.to_excel(w, sheet_name=nombre, index=False)
        print(f"{salida}: {len(nuevas)} ventas simuladas desde el {hoy + pd.Timedelta(days=1):%d/%m}, {sum(stock.values())} u en stock")

print("\nLo que se simuló que pasó en los locales:")
nombre = {p["sku"]: p["producto"] for p in D["productos"]}
for s, que in sorted(aplicado.items(), key=lambda x: nombre[x[0]]):
    print(f"   {nombre[s]:32s} {que}")
