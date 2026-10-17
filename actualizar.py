"""Carga una foto de datos (el Excel de la semana) a la base con historia y arma el tablero.

Qué hace:
  1. Corre armar_excel.py sobre el Excel: análisis, propuesta y nota de esa foto (se guardan en salidas/historia/<fecha>/).
  2. Guarda la foto en la base SQLite (datos/viento_sur.db) sin pisar las anteriores: ventas, lotes, productos y decisiones.
  3. Si hay una foto anterior, mide qué pasó con cada decisión desde entonces (seguimiento).
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
    """Guarda la foto en la base. Si esa fecha ya estaba cargada, la reemplaza (se puede volver a correr sin duplicar)."""
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
    """Compara lo que se decidió en la foto anterior con lo que pasó hasta la foto actual."""
    previas = [r[0] for r in con.execute("SELECT fecha_foto FROM fotos WHERE fecha_foto < ? ORDER BY fecha_foto DESC LIMIT 1", (actual,))]
    if not previas:
        return None, []
    anterior = previas[0]
    dias = (pd.Timestamp(actual) - pd.Timestamp(anterior)).days
    dec = pd.read_sql("SELECT * FROM decisiones WHERE fecha_foto = ?", con, params=(anterior,)).set_index("sku")
    v = pd.read_sql("SELECT * FROM ventas WHERE fecha > ? AND fecha <= ?", con, params=(anterior, actual))
    stock_ahora = pd.read_sql("SELECT sku, SUM(unidades) AS u FROM lotes WHERE fecha_foto = ? GROUP BY sku", con, params=(actual,)).set_index("sku").u
    u = v.groupby("sku").unidades.sum()
    monto = (v.unidades * v.precio_unitario).groupby(v.sku).sum()
    filas = []
    for sku, d in dec.iterrows():
        u_sem = u.get(sku, 0) / dias * 7
        precio_cobrado = monto.get(sku, 0) / u[sku] if u.get(sku, 0) else None
        con_rebaja = precio_cobrado is not None and precio_cobrado < d.precio * 0.99
        if d.nuestro == "ya":
            if not con_rebaja:
                estado = "El descuento no se ve en caja"
            elif d.meta_u_sem and u_sem >= d.meta_u_sem:
                estado = "Cumple la meta"
            else:
                estado = "Debajo de la meta"
        elif d.grupo == 1:
            estado = "Sin stock en algún momento" if stock_ahora.get(sku, 0) == 0 else ("Vende igual o más" if u_sem >= d.u_sem_base * 0.9 else "Vende menos")
        else:
            estado = "Movió stock" if stock_ahora.get(sku, d.stock) < d.stock else "Sin movimiento"
        filas.append(dict(sku=sku, producto=d.producto, n=int(d.grupo), accion=d.accion, revisar=d.revisar, u_sem_antes=d.u_sem_base, u_sem_despues=u_sem,
                          meta_u_sem=(None if pd.isna(d.meta_u_sem) else float(d.meta_u_sem)), precio_lista=d.precio, precio_cobrado=precio_cobrado, stock_antes=int(d.stock),
                          stock_ahora=int(stock_ahora.get(sku, 0)), estado=estado))
    return anterior, filas


def armar_web(con, actual, anterior, seg, web=WEB, salidas=Path("salidas")):
    """Copia la app del tablero a web/ y le escribe los datos: la foto actual, todas las ventas de la base, la historia y el seguimiento."""
    datos = json.loads(con.execute("SELECT datos FROM tablero WHERE fecha_foto = ?", (actual,)).fetchone()[0])
    historia = []
    for fecha, txt in con.execute("SELECT fecha_foto, datos FROM tablero ORDER BY fecha_foto"):
        k = json.loads(txt)["k"]
        historia.append(dict(fecha=fecha, stock=k["stock"], capital=k["capital"], vencidas=k["vencidas"], atrasados=k["atrasados"],
                             ya=k["ya"], cond=k["cond"]))
    ventas = [list(r) for r in con.execute("SELECT fecha, sku, sucursal_id, unidades, precio_unitario FROM ventas WHERE fecha <= ? ORDER BY fecha, sku, sucursal_id", (actual,))]
    web.mkdir(parents=True, exist_ok=True)
    excel = salidas / "historia" / actual / "ventas_y_stock.xlsx"
    if excel.exists():
        shutil.copy(excel, web / "viento_sur_analisis.xlsx")
    datos.update(historia=historia, seguimiento=seg, foto_anterior=anterior, ventas=ventas,
                 archivo_excel="viento_sur_analisis.xlsx" if excel.exists() else None)
    for f in ["app.css", "app.js"]:
        shutil.copy(APP / f, web / f)
    (web / "datos.js").write_text("window.DATOS = " + json.dumps(datos, ensure_ascii=False).replace("</", "<\\/") + ";\n", encoding="utf-8")
    # cada archivo con una versión según su contenido: el navegador no se queda con uno viejo después de actualizar
    html = (APP / "index.html").read_text(encoding="utf-8")
    for f in ["app.css", "app.js", "datos.js"]:
        html = html.replace(f'"{f}"', f'"{f}?v={hashlib.sha1((web / f).read_bytes()).hexdigest()[:10]}"')
    (web / "index.html").write_text(html, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Carga una foto de datos a la base con historia y arma el tablero.")
    ap.add_argument("--datos", default="datos/viento_sur.xlsx", help="Excel de la semana (mismas hojas que viento_sur.xlsx)")
    ap.add_argument("--publicar", action="store_true", help="publicar web/ en Vercel al terminar")
    ap.add_argument("--base", default=str(BASE), help="archivo de la base SQLite")
    ap.add_argument("--web", default=str(WEB), help="carpeta del tablero")
    ap.add_argument("--salidas", default="salidas", help="carpeta de salidas (la historia va en <salidas>/historia/<fecha>)")
    args = ap.parse_args()
    web = Path(args.web)

    fecha = pd.to_datetime(pd.read_excel(args.datos, sheet_name="ventas").fecha).max().strftime("%Y-%m-%d")
    carpeta = Path(args.salidas) / "historia" / fecha
    r = subprocess.run([sys.executable, "armar_excel.py", "--datos", args.datos, "--salidas", str(carpeta)], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"armar_excel.py falló con {args.datos}:\n{r.stderr}")
    tablero = json.loads((carpeta / "tablero_datos.json").read_text(encoding="utf-8"))

    con = sqlite3.connect(args.base)
    con.executescript(ESQUEMA)
    cargar_foto(con, args.datos, fecha, tablero)
    ultima = con.execute("SELECT MAX(fecha_foto) FROM fotos").fetchone()[0]
    if fecha == ultima:                                       # la foto más nueva también queda en salidas/
        for f in ["ventas_y_stock.xlsx", "nota.md", "tablero_datos.json"]:
            shutil.copy(carpeta / f, Path(args.salidas) / f)
    anterior, seg = seguimiento(con, ultima)
    armar_web(con, ultima, anterior, seg, web, Path(args.salidas))
    fotos = [r[0] for r in con.execute("SELECT fecha_foto FROM fotos ORDER BY fecha_foto")]
    con.close()
    print(f"Foto {fecha} cargada. Fotos en la base: {', '.join(fotos)}. "
          f"Seguimiento: {len(seg)} decisiones del {anterior} medidas." if anterior else f"Foto {fecha} cargada. Es la primera: el seguimiento empieza con la próxima.")
    print(f"Tablero: {web / 'index.html'}")
    if args.publicar:
        subprocess.run(["vercel", "deploy", str(web), "--prod", "--yes"], check=True)


if __name__ == "__main__":
    main()
