"""La base del tablero online: cada Excel que se sube actualiza la base, y el tablero muestra siempre los datos más nuevos.

Es una base SQL (Postgres en Supabase) con las mismas tablas que la base local de actualizar.py: ver base_sql.py.
La base es la fuente única: al subir un Excel se guardan sus 8 hojas y el proceso corre sobre lo que quedó en la base.
Un Excel por fecha de datos (el último día con ventas): si se sube otra vez la misma fecha, lo reemplaza. Si se sube una fecha
vieja, los posteriores recalculan su historia y su seguimiento (las recomendaciones de cada uno no cambian: dependen solo de su Excel).

La dirección de la base está en la variable POSTGRES_URL (la carga Vercel al conectar Supabase; en la computadora, en .env.local).
Uso en la computadora:
  python servidor.py subir datos/viento_sur.xlsx  ·  python servidor.py recalcular 2026-03-15  ·  python servidor.py borrar 2026-02-22
  python servidor.py lista
"""
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import carga
from base_sql import Base

FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _env_local():
    """En la computadora, las variables de .env.local (las que baja `vercel env pull`)."""
    f = Path(__file__).resolve().parent / ".env.local"
    if f.exists():
        for linea in f.read_text().splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def base():
    _env_local()
    url = os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("Falta POSTGRES_URL: la dirección de la base (Supabase).")
    return Base(url)


def url_excel(fecha, tipo):
    return f"/api/excel?fecha={fecha}&tipo={tipo}"


def cargados():
    """Los Excel cargados, del más nuevo al más viejo: [{fecha, subida, nombre, original}]."""
    with base() as b:
        return [dict(c, original=url_excel(c["fecha"], "original")) for c in b.cargas()]


def abrir(fecha=None):
    """Lo que lee el tablero para esa fecha (sin fecha, la más nueva), o None si no está."""
    with base() as b:
        fechas = b.fechas()
        if not fechas or (fecha and fecha not in fechas):
            return None
        return b.tablero(fecha or fechas[-1])


def excel(fecha, tipo):
    with base() as b:
        return b.excel(fecha, tipo)


def procesar_subida(contenido, nombre):
    """Valida el Excel, guarda sus 8 hojas en la base y corre el proceso sobre lo que quedó en la base. Devuelve (resultado, problemas)."""
    with tempfile.TemporaryDirectory() as tmp:
        xlsx = Path(tmp) / "subido.xlsx"
        xlsx.write_bytes(contenido)
        problemas = carga.validar(xlsx)
        if problemas:
            return None, problemas
        fecha = carga.fecha_datos(xlsx)
        meta = dict(nombre=nombre, subida=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        with base() as b:
            b.guardar_hojas(xlsx, fecha, nombre, original=contenido)
            calcular(b, fecha, Path(tmp))
            posteriores = [f for f in b.fechas() if f > fecha]
            for f in [fecha] + posteriores:                     # se cargó un Excel viejo: los de después se recalculan
                paq = b.completar(f, url_excel(f, "analisis"), meta if f == fecha else None)
                if f == fecha:
                    anterior, seguidas = paq["foto_anterior"], len(paq["seguimiento"])
            total = len(b.fechas())
    return dict(fecha=fecha, anterior=anterior, decisiones_seguidas=seguidas, es_la_mas_nueva=not posteriores,
                recalculadas=posteriores, fotos=total), []


def calcular(b, fecha, carpeta):
    """Corre el proceso sobre los datos de la base (no sobre el archivo subido) y guarda el resultado: la base es la fuente única.
    Sirve también para recalcular una fecha si se corrigió algún dato en la base."""
    xlsx = b.exportar_excel(fecha, Path(carpeta) / f"base_{fecha}.xlsx")
    tablero = carga.correr_proceso(xlsx, Path(carpeta) / "salidas")
    b.guardar_resultado(fecha, tablero, (Path(carpeta) / "salidas" / "ventas_y_stock.xlsx").read_bytes())
    return tablero


def recalcular(fecha):
    """Vuelve a correr el proceso de una fecha desde la base (por ejemplo, después de corregir un dato en Supabase) y sus posteriores."""
    with base() as b, tempfile.TemporaryDirectory() as tmp:
        if fecha not in b.fechas():
            raise ValueError(f"No hay un Excel al {fecha} en la base.")
        calcular(b, fecha, Path(tmp))
        for f in [x for x in b.fechas() if x >= fecha]:
            b.completar(f, url_excel(f, "analisis"))
    return dict(fecha=fecha, recalculada=True)


def borrar(fecha):
    """Saca un Excel de la base y recalcula los posteriores. Solo desde la computadora."""
    if not FECHA.match(fecha):
        raise ValueError(f"Fecha inválida: {fecha}")
    with base() as b:
        if not b.borrar(fecha):
            return dict(fecha=fecha, borrada=False)
        posteriores = [f for f in b.fechas() if f > fecha]
        for f in posteriores:
            b.completar(f, url_excel(f, "analisis"))
        return dict(fecha=fecha, borrada=True, recalculadas=posteriores, fotos=len(b.fechas()))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "subir":
        for x in sys.argv[2:]:
            r, prob = procesar_subida(Path(x).read_bytes(), Path(x).name)
            print(x, "→", r or prob)
    elif len(sys.argv) >= 3 and sys.argv[1] == "recalcular":
        for f in sys.argv[2:]:
            print(f, "→", recalcular(f))
    elif len(sys.argv) >= 3 and sys.argv[1] == "borrar":
        for f in sys.argv[2:]:
            print(f, "→", borrar(f))
    elif len(sys.argv) == 2 and sys.argv[1] == "lista":
        for c in cargados():
            print(c["fecha"], "· subida", c["subida"], "·", c["nombre"])
    else:
        print(__doc__)
