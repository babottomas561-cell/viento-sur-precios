"""Carga el Excel de la semana a la base local (con su historia) y arma el tablero. Hace en la computadora lo mismo que «Subir Excel» en el sitio.

Qué hace:
  1. Guarda las 8 hojas del Excel en la base SQLite y corre armar_excel.py sobre lo que quedó en la base (la base es la fuente única):
     análisis, propuesta y nota de ese Excel (se guardan en salidas/historia/<fecha>/).
  2. La base SQLite (datos/viento_sur.db), con su fecha, sin pisar los anteriores: ventas, lotes, productos y decisiones
     (las mismas tablas que la base online en Supabase: ver base_sql.py).
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
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

import carga
from base_sql import Base

BASE = Path("datos/viento_sur.db")
WEB = Path("web")
APP = Path("tablero")                      # index.html, app.css y app.js del tablero

def armar_web(b, actual, web=WEB, salidas=Path("salidas")):
    """Copia la app del tablero a web/ y le escribe los datos del Excel más nuevo de la base (con sus ventas, la historia y el seguimiento)."""
    web.mkdir(parents=True, exist_ok=True)
    excel = salidas / "historia" / actual / "ventas_y_stock.xlsx"
    if excel.exists():
        shutil.copy(excel, web / "viento_sur_analisis.xlsx")
    datos = b.completar(actual, "viento_sur_analisis.xlsx" if excel.exists() else None, dict(id="oficial"))
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
    return datos


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
    with Base(args.base) as b:
        b.guardar_hojas(args.datos, fecha, Path(args.datos).name)
        carpeta.mkdir(parents=True, exist_ok=True)
        xlsx = b.exportar_excel(fecha, carpeta / "datos_desde_la_base.xlsx")     # el proceso corre sobre la base, no sobre el archivo
        try:
            tablero = carga.correr_proceso(xlsx, carpeta)
        except RuntimeError as e:
            sys.exit(str(e))
        b.guardar_resultado(fecha, tablero)
        fechas = b.fechas()
        ultima = fechas[-1]
        for f in [x for x in fechas if x >= fecha and x != ultima]:   # se cargó un Excel viejo: los de después se recalculan
            b.completar(f)
        if fecha == ultima:                                   # el Excel más nuevo también queda en salidas/
            for f in ["ventas_y_stock.xlsx", "nota.md", "causas.md", "tablero_datos.json"]:
                shutil.copy(carpeta / f, Path(args.salidas) / f)
        datos = armar_web(b, ultima, web, Path(args.salidas))
    anterior, seg = datos["foto_anterior"], datos["seguimiento"]
    print(f"Datos al {fecha} cargados. En la base: {', '.join(fechas)}. "
          f"Seguimiento: {len(seg)} decisiones del {anterior} medidas." if anterior else f"Datos al {fecha} cargados. Es el primer Excel: el seguimiento empieza con el próximo.")
    print(f"Tablero: {web / 'index.html'}")
    if args.publicar:
        subprocess.run(["vercel", "deploy", "--prod", "--yes"], check=True)      # sitio (web/) + funciones (api/), según vercel.json


if __name__ == "__main__":
    main()
