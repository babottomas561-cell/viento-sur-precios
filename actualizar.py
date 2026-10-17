"""Carga el Excel de la semana a la base local (con su historia) y arma el tablero. Hace en la computadora lo mismo que «Subir Excel» en el sitio.

Qué hace:
  1. Corre armar_excel.py sobre el Excel: análisis, propuesta y nota de ese Excel (se guardan en salidas/historia/<fecha>/).
  2. Guarda los datos en la base SQLite (datos/viento_sur.db), con su fecha, sin pisar los anteriores: ventas, lotes, productos y decisiones.
  3. Si hay un Excel anterior, mide qué pasó con cada decisión desde entonces (seguimiento).
  4. Arma el tablero en web/ (index.html, app.css, app.js, datos.js y el Excel), listo para abrir o publicar.

Uso:  .venv/bin/python actualizar.py                                  -> carga datos/viento_sur.xlsx
      .venv/bin/python actualizar.py --datos datos/semana_12.xlsx
      .venv/bin/python actualizar.py --publicar                       -> además publica web/ en Vercel
"""
import hashlib
import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

import carga

BASE = Path("datos/viento_sur.db")
WEB = Path("web")
APP = Path("tablero")                      # index.html, app.css y app.js del tablero

ESQUEMA = """
CREATE TABLE IF NOT EXISTS fotos      (fecha_foto TEXT PRIMARY KEY, archivo TEXT, cargada TEXT);
CREATE TABLE IF NOT EXISTS ventas     (fecha TEXT, sku TEXT, sucursal_id TEXT, unidades INTEGER, precio_unitario REAL,
                                       PRIMARY KEY (fecha, sku, sucursal_id));
CREATE TABLE IF NOT EXISTS productos  (fecha_foto TEXT, sku TEXT, nombre TEXT, rubro TEXT, tipo TEXT, proveedor TEXT,
                                       precio_lista REAL, costo_unitario REAL, PRIMARY KEY (fecha_foto, sku));
CREATE TABLE IF NOT EXISTS lotes      (fecha_foto TEXT, sku TEXT, sucursal_id TEXT, unidades INTEGER, fecha_ingreso TEXT,
                                       fecha_limite TEXT, unidades_objetivo INTEGER, PRIMARY KEY (fecha_foto, sku, sucursal_id));
CREATE TABLE IF NOT EXISTS decisiones (fecha_foto TEXT, sku TEXT, producto TEXT, grupo INTEGER, accion TEXT, descuento REAL,
                                       condicion TEXT, indicador TEXT, linea_base TEXT, meta TEXT, revisar TEXT, nuestro TEXT,
                                       u_sem_base REAL, meta_u_sem REAL, stock INTEGER, precio REAL, PRIMARY KEY (fecha_foto, sku));
CREATE TABLE IF NOT EXISTS tablero    (fecha_foto TEXT PRIMARY KEY, datos TEXT);
"""


def cargar_foto(con, datos_xlsx, fecha, tablero):
    """Guarda los datos de ese Excel en la base. Si esa fecha ya estaba cargada, la reemplaza (se puede volver a correr sin duplicar)."""
    h = pd.read_excel(datos_xlsx, sheet_name=None)
    for t in ["productos", "lotes", "decisiones", "tablero", "fotos"]:
        con.execute(f"DELETE FROM {t} WHERE fecha_foto = ?", (fecha,))
    con.execute("INSERT INTO fotos VALUES (?, ?, ?)", (fecha, str(datos_xlsx), datetime.now().isoformat(timespec="seconds")))
    v = h["ventas"].copy()
    v["fecha"] = pd.to_datetime(v.fecha).dt.strftime("%Y-%m-%d")
    con.executemany("INSERT OR REPLACE INTO ventas VALUES (?, ?, ?, ?, ?)",
                    v[["fecha", "sku", "sucursal_id", "unidades", "precio_unitario"]].itertuples(index=False, name=None))
    p = h["productos"]
    con.executemany("INSERT INTO productos VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [(fecha, r.sku, r.nombre, r.rubro, r.tipo, r.proveedor, float(r.precio_lista), float(r.costo_unitario)) for r in p.itertuples()])
    st = h["stock_sucursal"]
    con.executemany("INSERT INTO lotes VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [(fecha, r.sku, r.sucursal_id, int(r.unidades), str(pd.Timestamp(r.fecha_ingreso).date()), str(pd.Timestamp(r.fecha_limite).date()),
                      int(r.unidades_objetivo)) for r in st.itertuples()])
    con.executemany("INSERT INTO decisiones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [(fecha, d["sku"], d["producto"], d["n"], d["accion"], d["descuento"], d["condicion"], d["indicador"], d["linea_base"],
                      d["meta"], d["revisar"], d["nuestro"], d["u_sem_base"], d["meta_u_sem"], d["stock"], d["precio"]) for d in tablero["productos"]])
    con.execute("INSERT INTO tablero VALUES (?, ?)", (fecha, json.dumps(tablero, ensure_ascii=False)))
    con.commit()


def seguimiento(con, actual):
    """Lo que va pasando con cada recomendación de los Excel anteriores hasta el actual (la cuenta está en carga.py)."""
    previas = [r[0] for r in con.execute("SELECT fecha_foto FROM fotos WHERE fecha_foto < ? ORDER BY fecha_foto", (actual,))]
    if not previas:
        return None, []
    dec = pd.read_sql("SELECT * FROM decisiones WHERE fecha_foto < ?", con, params=(actual,)).rename(columns={"grupo": "n"})
    fotos_prev = [(f, dec[dec.fecha_foto == f].to_dict("records")) for f in previas]
    v = pd.read_sql("SELECT fecha, sku, unidades, precio_unitario FROM ventas WHERE fecha <= ?", con, params=(actual,))
    stock = dict(con.execute("SELECT sku, SUM(unidades) FROM lotes WHERE fecha_foto = ? GROUP BY sku", (actual,)).fetchall())
    nuevas = dict(con.execute("SELECT sku, accion FROM decisiones WHERE fecha_foto = ?", (actual,)).fetchall())
    return previas[-1], carga.seguimiento(fotos_prev, v, stock, actual, nuevas)

def armar_web(con, actual, anterior, seg, web=WEB, salidas=Path("salidas")):
    """Copia la app del tablero a web/ y le escribe los datos: los del Excel actual, todas las ventas de la base, la historia y el seguimiento."""
    tablero = json.loads(con.execute("SELECT datos FROM tablero WHERE fecha_foto = ?", (actual,)).fetchone()[0])
    historia = [carga.resumen(json.loads(txt), fecha) for fecha, txt in con.execute("SELECT fecha_foto, datos FROM tablero ORDER BY fecha_foto")]
    ventas = [list(r) for r in con.execute("SELECT fecha, sku, sucursal_id, unidades, precio_unitario FROM ventas WHERE fecha <= ? ORDER BY fecha, sku, sucursal_id", (actual,))]
    web.mkdir(parents=True, exist_ok=True)
    excel = salidas / "historia" / actual / "ventas_y_stock.xlsx"
    if excel.exists():
        shutil.copy(excel, web / "viento_sur_analisis.xlsx")
    datos = carga.paquete(tablero, ventas, historia, anterior, seg, "viento_sur_analisis.xlsx" if excel.exists() else None, dict(id="oficial"))
    for f in ["app.css", "app.js"]:
        shutil.copy(APP / f, web / f)
    # la auditoría del tablero también se publica, para poder correrla en el sitio (ver salidas/auditoria/LEEME.md)
    (web / "auditoria").mkdir(exist_ok=True)
    for f in ["auditar_filtros.js", "esperado.json", "auditar_ventas.js", "esperado_ventas.json"]:
        if (salidas / "auditoria" / f).exists():
            shutil.copy(salidas / "auditoria" / f, web / "auditoria" / f)
    (web / "datos.js").write_text("window.DATOS = " + json.dumps(datos, ensure_ascii=False).replace("</", "<\\/") + ";\n", encoding="utf-8")
    # cada archivo con una versión según su contenido: el navegador no se queda con uno viejo después de actualizar
    html = (APP / "index.html").read_text(encoding="utf-8")
    for f in ["app.css", "app.js", "datos.js"]:
        html = html.replace(f'"{f}"', f'"{f}?v={hashlib.sha1((web / f).read_bytes()).hexdigest()[:10]}"')
    (web / "index.html").write_text(html, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Carga un Excel a la base con historia y arma el tablero.")
    ap.add_argument("--datos", default="datos/viento_sur.xlsx", help="Excel de la semana (mismas hojas que viento_sur.xlsx)")
    ap.add_argument("--publicar", action="store_true", help="publicar el tablero y el servidor en Vercel al terminar")
    ap.add_argument("--base", default=str(BASE), help="archivo de la base SQLite")
    ap.add_argument("--web", default=str(WEB), help="carpeta del tablero")
    ap.add_argument("--salidas", default="salidas", help="carpeta de salidas (la historia va en <salidas>/historia/<fecha>)")
    args = ap.parse_args()
    web = Path(args.web)

    problemas = carga.validar(args.datos)
    if problemas:
        sys.exit(f"{args.datos} no tiene la forma esperada:\n- " + "\n- ".join(problemas))
    fecha = carga.fecha_datos(args.datos)
    carpeta = Path(args.salidas) / "historia" / fecha
    try:
        tablero = carga.correr_proceso(args.datos, carpeta)
    except RuntimeError as e:
        sys.exit(str(e))

    con = sqlite3.connect(args.base)
    con.executescript(ESQUEMA)
    cargar_foto(con, args.datos, fecha, tablero)
    ultima = con.execute("SELECT MAX(fecha_foto) FROM fotos").fetchone()[0]
    if fecha == ultima:                                       # el Excel más nuevo también queda en salidas/
        for f in ["ventas_y_stock.xlsx", "nota.md", "causas.md", "tablero_datos.json"]:
            shutil.copy(carpeta / f, Path(args.salidas) / f)
    anterior, seg = seguimiento(con, ultima)
    armar_web(con, ultima, anterior, seg, web, Path(args.salidas))
    fotos = [r[0] for r in con.execute("SELECT fecha_foto FROM fotos ORDER BY fecha_foto")]
    con.close()
    print(f"Datos al {fecha} cargados. En la base: {', '.join(fotos)}. "
          f"Seguimiento: {len(seg)} decisiones del {anterior} medidas." if anterior else f"Datos al {fecha} cargados. Es el primer Excel: el seguimiento empieza con el próximo.")
    print(f"Tablero: {web / 'index.html'}")
    if args.publicar:
        subprocess.run(["vercel", "deploy", "--prod", "--yes"], check=True)      # sitio (web/) + funciones (api/), según vercel.json


if __name__ == "__main__":
    main()
