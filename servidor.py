"""La base del tablero online: cada Excel que se sube actualiza la base, y el tablero muestra siempre la foto más nueva.

Igual que actualizar.py con la base SQLite, pero en el almacenamiento de Vercel (Vercel Blob):
  base/<fecha>__<versión>.json            el paquete que lee el tablero (propuesta, ventas, historia y seguimiento)
  base/<fecha>__<versión>_analisis.xlsx   el Excel de análisis que generó el proceso
  base/<fecha>__<versión>_original.xlsx   el Excel tal como se subió
Los archivos nunca se pisan: cada cambio es una versión nueva (el almacenamiento guarda en caché 60 s, y así nadie lee
una versión vieja); la base usa la más nueva de cada fecha y borra las anteriores.
Una foto por fecha: si se sube otra vez la misma fecha, la reemplaza. Si se sube una fecha vieja, las fotos posteriores
recalculan su historia y su seguimiento (las recomendaciones de cada foto no cambian: dependen solo de su Excel).

Uso en la computadora:  python servidor.py subir datos/viento_sur.xlsx  ·  python servidor.py borrar 2026-02-22  ·  python servidor.py fotos
"""
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import blob
import foto

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _version():
    return f"{datetime.now(timezone.utc):%Y%m%d%H%M%S%f}"


def fotos():
    """Las fotos de la base (la versión más nueva de cada fecha), de la más nueva a la más vieja: [{fecha, subida, url, original}]."""
    todos = blob.listar("base/")
    ultima, original = {}, {}
    for b in todos:
        if m := re.match(r"base/(\d{4}-\d{2}-\d{2})__(\d{20})(\.json|_original\.xlsx)$", b["pathname"]):
            d = ultima if m.group(3) == ".json" else original
            if m.group(1) not in d or m.group(2) > d[m.group(1)][0]:
                d[m.group(1)] = (m.group(2), b)
    return [dict(fecha=f, subida=b["uploadedAt"], url=b["url"], original=original.get(f, (None, {}))[1].get("url"))
            for f, (_, b) in sorted(ultima.items(), reverse=True)]


def _guardar(paq):
    blob.subir(f"base/{paq['foto_iso']}__{_version()}.json", json.dumps(paq, ensure_ascii=False).encode("utf-8"), "application/json")


def _limpiar(todas):
    """Borra lo que ya no usa ninguna foto vigente: versiones viejas de los paquetes y sus Excel."""
    usados = {f["url"] for f in fotos()}
    for paq in todas.values():
        if paq.get("archivo_excel"):
            usados |= {paq["archivo_excel"], paq["archivo_excel"].replace("_analisis.xlsx", "_original.xlsx")}
    viejos = [b["url"] for b in blob.listar("base/") if b["url"] not in usados]
    if viejos:
        blob.borrar(viejos)


def _completar(paq, todas):
    """Le pone a un paquete su historia y su seguimiento según las fotos de la base anteriores a él.
    todas: {fecha: paquete} con al menos las fotos anteriores."""
    fecha = paq["foto_iso"]
    previas = sorted(f for f in todas if f < fecha)
    v = pd.DataFrame(paq["ventas"], columns=["fecha", "sku", "sucursal_id", "unidades", "precio_unitario"])
    stock = pd.DataFrame(paq["lotes"]).groupby("sku").unidades.sum().to_dict()
    nuevas = {p["sku"]: p["accion"] for p in paq["productos"]}
    paq["seguimiento"] = foto.seguimiento([(f, todas[f]["productos"]) for f in previas], v, stock, fecha, nuevas)
    paq["foto_anterior"] = previas[-1] if previas else None
    paq["historia"] = [foto.resumen(todas[f], f) for f in previas] + [foto.resumen(paq, fecha)]
    return paq


def procesar_subida(contenido, nombre):
    """Valida el Excel, corre el proceso y lo carga en la base. Devuelve (resultado, problemas)."""
    with tempfile.TemporaryDirectory() as tmp:
        xlsx = Path(tmp) / "subido.xlsx"
        xlsx.write_bytes(contenido)
        problemas = foto.validar(xlsx)
        if problemas:
            return None, problemas
        fecha = foto.fecha_foto(xlsx)
        tablero = foto.correr_proceso(xlsx, Path(tmp) / "salidas")
        v = _version()
        url_excel = blob.subir(f"base/{fecha}__{v}_analisis.xlsx", (Path(tmp) / "salidas" / "ventas_y_stock.xlsx").read_bytes(), XLSX)
        blob.subir(f"base/{fecha}__{v}_original.xlsx", contenido, XLSX)
        meta = dict(nombre=nombre, subida=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        paq = foto.paquete(tablero, foto.ventas_de(xlsx, fecha), [], archivo_excel=url_excel, meta=meta)

    existentes = {f["fecha"]: f["url"] for f in fotos() if f["fecha"] != fecha}
    todas = {f: blob.leer_url(u) for f, u in existentes.items()}
    todas[fecha] = _completar(paq, todas)
    _guardar(todas[fecha])
    posteriores = sorted(f for f in existentes if f > fecha)
    for f in posteriores:                                     # se cargó una foto vieja: las de después se recalculan
        _guardar(_completar(todas[f], todas))
    _limpiar(todas)
    return dict(fecha=fecha, anterior=paq["foto_anterior"], decisiones_seguidas=len(paq["seguimiento"]),
                es_la_mas_nueva=not posteriores, recalculadas=posteriores, fotos=len(todas)), []


def borrar_foto(fecha):
    """Saca una foto de la base (sus versiones y sus Excel) y recalcula las posteriores. Solo desde la computadora."""
    if not FECHA.match(fecha):
        raise ValueError(f"Fecha inválida: {fecha}")
    archivos = [b["url"] for b in blob.listar(f"base/{fecha}__")]
    if not archivos:
        return dict(fecha=fecha, borrada=False)
    blob.borrar(archivos)
    todas = {f["fecha"]: blob.leer_url(f["url"]) for f in fotos()}
    posteriores = sorted(f for f in todas if f > fecha)
    for f in posteriores:
        _guardar(_completar(todas[f], todas))
    _limpiar(todas)
    return dict(fecha=fecha, borrada=True, recalculadas=posteriores, fotos=len(todas))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "subir":
        for x in sys.argv[2:]:
            r, prob = procesar_subida(Path(x).read_bytes(), Path(x).name)
            print(x, "→", r or prob)
    elif len(sys.argv) >= 3 and sys.argv[1] == "borrar":
        for f in sys.argv[2:]:
            print(f, "→", borrar_foto(f))
    elif len(sys.argv) == 2 and sys.argv[1] == "fotos":
        for f in fotos():
            print(f["fecha"], "· subida", f["subida"])
    else:
        print(__doc__)
