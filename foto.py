"""Una "foto" es un Excel con los datos de la semana. Este módulo la convierte en el paquete que lee el tablero.

Lo usan los dos caminos, con la misma cuenta:
  - actualizar.py, en la computadora, con la base SQLite (datos/viento_sur.db);
  - api/subir.py, en el servidor, cuando alguien sube un Excel desde la página.

Pasos: validar el Excel → correr armar_excel.py → medir el seguimiento contra la foto anterior → armar el paquete.
"""
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent

# Hojas y columnas que necesita el proceso (las de la consigna)
HOJAS = {
    "productos": ["sku", "nombre", "rubro", "tipo", "proveedor", "precio_lista", "costo_unitario"],
    "sucursales": ["sucursal_id", "nombre", "ciudad", "tipo"],
    "stock_sucursal": ["sku", "sucursal_id", "unidades", "fecha_ingreso", "fecha_limite", "unidades_objetivo"],
    "ventas": ["fecha", "sku", "sucursal_id", "unidades", "precio_unitario"],
    "historial_sugerencias": ["sku", "fecha_sugerencia", "descuento_pct", "aceptacion", "fecha_vigencia_desde", "fecha_vigencia_hasta"],
    "cambios_precio": ["sku", "fecha", "precio_anterior", "precio_nuevo", "origen"],
    "campanas_activas": ["sku", "tipo_campana", "fecha_desde", "fecha_hasta"],
    "propuesta_consultora": ["sku", "decision", "descuento_pct", "unidades_proyectadas_30d"],
}


def validar(xlsx):
    """Lista de problemas del Excel, en palabras. Vacía si está bien."""
    try:
        h = pd.read_excel(xlsx, sheet_name=None)
    except Exception:
        return ["No se pudo abrir el archivo como Excel (.xlsx)."]
    problemas = []
    for hoja, cols in HOJAS.items():
        if hoja not in h:
            problemas.append(f"Falta la hoja «{hoja}».")
            continue
        faltan = [c for c in cols if c not in h[hoja].columns]
        if faltan:
            problemas.append(f"En la hoja «{hoja}» faltan las columnas: {', '.join(faltan)}.")
    for hoja in ["productos", "stock_sucursal", "ventas"]:
        if hoja in h and h[hoja].empty:
            problemas.append(f"La hoja «{hoja}» está vacía.")
    if not problemas:
        sin_catalogo = set(h["stock_sucursal"].sku) - set(h["productos"].sku)
        if sin_catalogo:
            problemas.append(f"Hay stock de productos que no están en «productos»: {', '.join(sorted(map(str, sin_catalogo))[:5])}.")
    return problemas


def fecha_foto(xlsx):
    """La foto es del último día con ventas."""
    return pd.to_datetime(pd.read_excel(xlsx, sheet_name="ventas").fecha).max().strftime("%Y-%m-%d")


def correr_proceso(xlsx, carpeta):
    """Corre armar_excel.py sobre el Excel y devuelve los datos del tablero. Deja el Excel de análisis y la nota en la carpeta."""
    carpeta = Path(carpeta)
    r = subprocess.run([sys.executable, str(RAIZ / "armar_excel.py"), "--datos", str(xlsx), "--salidas", str(carpeta)],
                       capture_output=True, text=True, cwd=RAIZ)
    if r.returncode != 0:
        ultima = (r.stderr.strip().splitlines() or ["sin detalle"])[-1]
        raise RuntimeError(f"El proceso no pudo correr con este Excel: {ultima}")
    return json.loads((carpeta / "tablero_datos.json").read_text(encoding="utf-8"))


def ventas_de(xlsx, hasta):
    """Las ventas del Excel hasta la fecha de la foto, como las lee el tablero: [fecha, sku, sucursal, unidades, precio]."""
    v = pd.read_excel(xlsx, sheet_name="ventas")
    v["fecha"] = pd.to_datetime(v.fecha).dt.strftime("%Y-%m-%d")
    v = v[v.fecha <= hasta].sort_values(["fecha", "sku", "sucursal_id"])
    return [[r.fecha, r.sku, r.sucursal_id, int(r.unidades), float(r.precio_unitario)] for r in v.itertuples()]


BIEN = {"Cumple la meta", "Vende igual o más", "Movió stock"}          # estados que cuentan como "se está cumpliendo"


def _iso(ddmmaaaa):
    d, m, a = ddmmaaaa.split("/")
    return f"{a}-{m}-{d}"


def seguimiento(previas, ventas, stock_ahora, fecha, nuevas=None):
    """Lo que va pasando con cada recomendación, desde que se hizo hasta esta foto.

    previas: [(fecha, productos)] de las fotos anteriores, de la más vieja a la más nueva (productos: sku, producto, n, accion,
             revisar, nuestro, u_sem_base, meta_u_sem, stock, precio).
    Cada recomendación se sigue desde la primera foto en que se propuso, mientras se haya seguido proponiendo lo mismo;
    si la acción cambió, el seguimiento arranca de nuevo en la foto del cambio.
    ventas: DataFrame con fecha (texto), sku, unidades, precio_unitario · stock_ahora: {sku: unidades} · nuevas: {sku: acción en esta foto}
    """
    if not previas:
        return []
    por_foto = [(f, {d["sku"]: d for d in prods}) for f, prods in previas]
    ultima = por_foto[-1][1]
    filas = []
    for sku, d in ultima.items():
        i = len(por_foto) - 1                                   # hasta dónde para atrás se viene recomendando lo mismo
        while i > 0 and sku in por_foto[i - 1][1] and por_foto[i - 1][1][sku]["accion"] == d["accion"]:
            i -= 1
        desde, d0 = por_foto[i][0], por_foto[i][1][sku]
        dias = max((pd.Timestamp(fecha) - pd.Timestamp(desde)).days, 1)
        v = ventas[(ventas.sku == sku) & (ventas.fecha > desde) & (ventas.fecha <= fecha)]
        u = int(v.unidades.sum())
        u_sem = u / dias * 7
        precio_cobrado = float((v.unidades * v.precio_unitario).sum() / u) if u else None
        aplicado = precio_cobrado is not None and precio_cobrado < d0["precio"] * 0.99
        # semanas desde la recomendación (la última puede ser más corta)
        semanas, ini = [], pd.Timestamp(desde) + pd.Timedelta(days=1)
        while ini <= pd.Timestamp(fecha):
            fin = min(ini + pd.Timedelta(days=6), pd.Timestamp(fecha))
            vs = v[(v.fecha >= f"{ini:%Y-%m-%d}") & (v.fecha <= f"{fin:%Y-%m-%d}")]
            semanas.append(dict(desde=f"{ini:%Y-%m-%d}", dias=(fin - ini).days + 1, u=int(vs.unidades.sum())))
            ini = fin + pd.Timedelta(days=1)
        stock = [dict(fecha=f, u=int(prods[sku]["stock"])) for f, prods in por_foto[i:] if sku in prods] + [dict(fecha=fecha, u=int(stock_ahora.get(sku, 0)))]
        meta = d0.get("meta_u_sem")
        meta = None if meta is None or pd.isna(meta) else float(meta)
        if d0["nuestro"] == "ya":
            estado = ("Sin ventas desde la recomendación" if not u else "El descuento no se ve en caja" if not aplicado
                      else "Cumple la meta" if meta and u_sem >= meta else "Debajo de la meta")
        elif d0["n"] == 1:
            estado = "Sin stock en algún momento" if stock_ahora.get(sku, 0) == 0 else ("Vende igual o más" if u_sem >= d0["u_sem_base"] * 0.9 else "Vende menos")
        else:
            estado = "Movió stock" if stock_ahora.get(sku, d0["stock"]) < d0["stock"] else "Sin movimiento"
        revisar = _iso(d0["revisar"]) if d0.get("revisar") else None
        filas.append(dict(sku=sku, producto=d0["producto"], n=int(d0["n"]), accion=d0["accion"], nuestro=d0["nuestro"], desde=desde, dias=dias,
                          revisar=revisar, en_curso=bool(revisar and fecha < revisar), u_sem_antes=d0["u_sem_base"], u_sem_despues=float(u_sem),
                          meta_u_sem=meta, precio_lista=d0["precio"], precio_cobrado=precio_cobrado, aplicado=aplicado,
                          stock_antes=int(d0["stock"]), stock_ahora=int(stock_ahora.get(sku, 0)), stock=stock, semanas=semanas,
                          estado=estado, bien=estado in BIEN, accion_nueva=(nuevas or {}).get(sku)))
    return sorted(filas, key=lambda r: r["sku"])


def resumen(tablero, fecha):
    """Una línea de la historia: lo principal de cada foto."""
    k = tablero["k"]
    return dict(fecha=fecha, stock=k["stock"], capital=k["capital"], vencidas=k["vencidas"], atrasados=k["atrasados"], ya=k["ya"], cond=k["cond"])


def paquete(tablero, ventas, historia, anterior=None, seg=None, archivo_excel=None, meta=None):
    """Todo lo que lee el tablero (window.DATOS)."""
    return {**tablero, "historia": historia, "seguimiento": seg or [], "foto_anterior": anterior, "ventas": ventas,
            "archivo_excel": archivo_excel, "foto_meta": meta}
