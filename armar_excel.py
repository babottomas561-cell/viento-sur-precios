"""El proceso completo: lee el Excel de datos y arma el análisis, la propuesta para cada producto y la nota.

Salidas (en la carpeta de salidas):
  tablero_datos.json   -> lo que muestra el tablero para esta foto (lo usa actualizar.py)
  ventas_y_stock.xlsx  -> Propuesta, Nota, Resumen, Descuentos, una hoja por sucursal, datos y definiciones
  nota.md              -> la nota corta (qué miré, qué dejé afuera, efecto en 30 días, juicio sobre la consultora)

Uso:  .venv/bin/python armar_excel.py                                   -> datos/viento_sur.xlsx, salidas/
      .venv/bin/python armar_excel.py --datos otra_semana.xlsx --salidas salidas_semana_12
      .venv/bin/python armar_excel.py S01 S02                           -> solo esas sucursales
"""
import argparse
from datetime import datetime
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.chart import AreaChart, BarChart, LineChart, Reference, Series
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

_args = argparse.ArgumentParser(description="Arma el análisis y la propuesta de precios desde el Excel de datos.")
_args.add_argument("--datos", default="datos/viento_sur.xlsx", help="Excel de entrada (mismas hojas que viento_sur.xlsx)")
_args.add_argument("--salidas", default="salidas", help="carpeta donde se escriben el Excel y la nota")
_args.add_argument("sucursales", nargs="*", help="sucursales a incluir (por defecto, todas las que tienen stock)")
ARGS = _args.parse_args() if __name__ == "__main__" else _args.parse_args([])
DATOS = Path(ARGS.datos)
SALIDAS = Path(ARGS.salidas)
SALIDA = SALIDAS / "ventas_y_stock.xlsx"

# ---------------------------------------------------------------------------------------------- datos
h = pd.read_excel(DATOS, sheet_name=None)
# Productos del catálogo sin stock en ninguna sucursal: no hay mercadería para mover, así que quedan fuera del análisis
# (la nota los nombra). Con los datos de la consigna no hay ninguno.
_con_stock = set(h["stock_sucursal"].sku)
_sin = h["productos"][~h["productos"].sku.isin(_con_stock)]
SIN_STOCK = _sin.nombre.tolist()
SIN_STOCK_SKU = list(zip(_sin.sku, _sin.nombre))
for _hoja in ["productos", "ventas", "historial_sugerencias", "cambios_precio", "campanas_activas", "propuesta_consultora"]:
    h[_hoja] = h[_hoja][h[_hoja].sku.isin(_con_stock)]
prod = h["productos"].set_index("sku")
suc = h["sucursales"].set_index("sucursal_id")
lotes = h["stock_sucursal"].copy()
ventas = h["ventas"].copy()
for c in ["fecha_ingreso", "fecha_limite"]:
    lotes[c] = pd.to_datetime(lotes[c])
ventas["fecha"] = pd.to_datetime(ventas["fecha"])

INICIO, FOTO = ventas.fecha.min(), ventas.fecha.max()          # 16/12/2025 y 15/03/2026
DIAS = pd.date_range(INICIO, FOTO)
RUBROS = sorted(prod.rubro.unique())

lotes["producto"] = lotes.sku.map(prod.nombre)
lotes["rubro"] = lotes.sku.map(prod.rubro)
lotes = lotes.set_index(["sku", "sucursal_id"])

# Ventas diarias de cada lote (producto en una sucursal), con 0 en los días sin venta
vd = (ventas.groupby(["sku", "sucursal_id", "fecha"]).unidades.sum().unstack(fill_value=0)
      .reindex(columns=DIAS, fill_value=0).reindex(lotes.index, fill_value=0))

# Ventas diarias en pesos: unidades × precio cobrado ese día (incluye los descuentos aplicados)
ventas["monto"] = ventas.unidades * ventas.precio_unitario
vdp = (ventas.groupby(["sku", "sucursal_id", "fecha"]).monto.sum().unstack(fill_value=0)
       .reindex(columns=DIAS, fill_value=0).reindex(lotes.index, fill_value=0))

# Stock al cierre de cada día, reconstruido hacia atrás desde la foto del 15/03:
#   stock al cierre del día d = stock del 15/03 + lo vendido después del día d.
#   Antes de la fecha de ingreso del lote, el lote no estaba: queda vacío.
#   Supone que no hubo reposiciones, transferencias ni devoluciones (no están en los datos).
vendido_despues = vd.iloc[:, ::-1].cumsum(axis=1).iloc[:, ::-1] - vd
stock_dia = vendido_despues.add(lotes.unidades, axis=0).astype(float)
antes_ingreso = np.array([[d < ing for d in DIAS] for ing in lotes.fecha_ingreso])
stock_dia = stock_dia.mask(antes_ingreso)

# Ritmo del lote (como lo define la consigna) y rotación
lotes["cuenta_desde"] = lotes.fecha_ingreso.clip(lower=INICIO)
lotes["dias_observados"] = (FOTO - lotes.cuenta_desde).dt.days + 1
lotes["vendidas"] = [vd.loc[i, DIAS >= lotes.cuenta_desde[i]].sum() for i in lotes.index]
lotes["stock_inicial"] = lotes.unidades + lotes.vendidas
lotes["venta_pesos"] = vdp.sum(axis=1)
lotes["stock_costo"] = lotes.unidades * lotes.index.get_level_values("sku").map(prod.costo_unitario)
lotes["stock_lista"] = lotes.unidades * lotes.index.get_level_values("sku").map(prod.precio_lista)
lotes["pct_vendido"] = lotes.vendidas / lotes.stock_inicial
lotes["venta_ultimos_30"] = vd.iloc[:, -30:].sum(axis=1)
lotes["dias_de_stock"] = (lotes.unidades / (lotes.venta_ultimos_30 / 30)).replace(np.inf, np.nan)
lotes["ritmo_objetivo"] = lotes.unidades_objetivo / (lotes.fecha_limite - lotes.fecha_ingreso).dt.days
lotes["ritmo_observado"] = lotes.vendidas / lotes.dias_observados
lotes["pct_esperado"] = lotes.ritmo_observado / lotes.ritmo_objetivo
lotes["vencido"] = np.where(lotes.fecha_limite < FOTO, "sí", "no")

# ¿Rotó? Cada producto en cada sucursal, según sus ventas en la ventana
fechas_venta = ventas.groupby(["sku", "sucursal_id"]).fecha
lotes["primera_venta"] = fechas_venta.min().reindex(lotes.index)
lotes["ultima_venta"] = fechas_venta.max().reindex(lotes.index)
lotes["dias_sin_vender"] = (FOTO - lotes.ultima_venta).dt.days
total_producto = vd.groupby(level="sku").sum().sum(axis=1)
lotes["vendidas_otras_sucursales"] = total_producto.reindex(lotes.index.get_level_values("sku")).values - vd.sum(axis=1).values
CRITERIO_AL_DIA = 0.9
ROTACION = ["Sin ventas", "Vendió, pero no en los últimos 30 días", "Vendió en los últimos 30 días"]
COLOR_ROT = {ROTACION[0]: "F2C4BC", ROTACION[1]: "F5E2A8", ROTACION[2]: "CDE8D6"}
# ¿Tuvo descuento? Cada producto según el historial de sugerencias y las campañas (es lo mismo en todas sus sucursales)
hist = h["historial_sugerencias"].copy()
camp = h["campanas_activas"].copy()
for c in ["fecha_sugerencia", "fecha_vigencia_desde", "fecha_vigencia_hasta"]:
    hist[c] = pd.to_datetime(hist[c])
for c in ["fecha_desde", "fecha_hasta"]:
    camp[c] = pd.to_datetime(camp[c])
DESCUENTO = ["Descuento aplicado (se ve en las ventas)", "Campaña cargada (no se ve en el precio)",
             "Descuento aceptado sin fechas (no se ve en las ventas)", "Sugerencia rechazada o sin respuesta", "Sin descuento ni campaña"]
COLOR_DESC = dict(zip(DESCUENTO, ["9FD3B5", "F5E2A8", "CFE0EE", "E6D3EE", "EEEEEE"]))


def info_descuento(sku):
    hs, cs = hist[hist.sku == sku], camp[camp.sku == sku]
    aplicado = hs.dropna(subset=["fecha_vigencia_desde"])
    aceptado = hs[(hs.aceptacion == 1) & hs.fecha_vigencia_desde.isna()]
    otras = hs[hs.aceptacion != 1]
    partes = ([f"{x.descuento_pct} % del {x.fecha_vigencia_desde:%d/%m/%Y} al {x.fecha_vigencia_hasta:%d/%m/%Y}, aplicado" for x in aplicado.itertuples()]
              + [f"{x.tipo_campana.lower()} del {x.fecha_desde:%d/%m/%Y} al {x.fecha_hasta:%d/%m/%Y}" for x in cs.itertuples()]
              + [f"{x.descuento_pct} % aceptado el {x.fecha_sugerencia:%d/%m/%Y}, sin fechas" for x in aceptado.itertuples()]
              + [f"{x.descuento_pct} % sugerido el {x.fecha_sugerencia:%d/%m/%Y}, {'rechazado' if x.aceptacion == 2 else 'sin respuesta'}" for x in otras.itertuples()])
    cat = next(c for c, hay in zip(DESCUENTO, [len(aplicado), len(cs), len(aceptado), len(otras), True]) if hay)
    vig = (aplicado.fecha_vigencia_desde.min(), aplicado.fecha_vigencia_hasta.max()) if len(aplicado) else (pd.NaT, pd.NaT)
    return cat, "; ".join(partes) or "—", *vig


_d = pd.DataFrame([info_descuento(s) for s in prod.index], index=prod.index, columns=["descuento", "descuento_detalle", "vig_desde", "vig_hasta"])
for c in _d.columns:
    lotes[c] = lotes.index.get_level_values("sku").map(_d[c])
# En cada sucursal: unidades por día durante el descuento aplicado y el resto de la ventana (la cuenta de la consigna)
con_desc = np.array([[pd.notna(a) and a <= d <= b for d in DIAS] for a, b in zip(lotes.vig_desde, lotes.vig_hasta)])
lotes["u_dia_con_descuento"] = np.where(con_desc.any(axis=1), (vd.values * con_desc).sum(axis=1) / np.maximum(con_desc.sum(axis=1), 1), np.nan)
lotes["u_dia_sin_descuento"] = np.where(con_desc.any(axis=1), (vd.values * ~con_desc).sum(axis=1) / np.maximum((~con_desc).sum(axis=1), 1), np.nan)
lotes["variacion_con_descuento"] = lotes.u_dia_con_descuento / lotes.u_dia_sin_descuento - 1

lotes["rotacion"] = np.select([vd.sum(axis=1).values == 0, lotes.venta_ultimos_30.values == 0], ROTACION[:2], ROTACION[2])

# ---------------------------------------------------------------------------------------------- formato
F_TIT = Font(size=15, bold=True)
F_SEC = Font(size=12, bold=True, color="1D4E63")
F_HEAD = Font(bold=True, size=9, color="333333")
F_NOTA = Font(italic=True, size=9, color="666666")
F_DIA = Font(size=9)
FILL_HEAD = PatternFill("solid", fgColor="E9EEF1")
FILL_TOTAL = PatternFill("solid", fgColor="F4F6F7")
COL0 = 4                                    # primera columna de días (D); A = nombre, B = rubro, C = total
COLORES_RUBRO = {"calzado": "2A6F97", "deportes": "C9A227", "hogar": "2E7D4F", "indumentaria": "B3402E", "Total": "333333"}
ULT = get_column_letter(COL0 + len(DIAS) - 1)


def encabezado_dias(ws, fila, titulo_a="", titulo_b="", titulo_c="total"):
    for col, t in [(1, titulo_a), (2, titulo_b), (3, titulo_c)]:
        c = ws.cell(fila, col, t); c.font = F_HEAD; c.fill = FILL_HEAD
    for j, d in enumerate(DIAS):
        c = ws.cell(fila, COL0 + j, d.to_pydatetime())
        c.number_format = "dd/mm"; c.font = F_HEAD; c.fill = FILL_HEAD
        c.alignment = Alignment(text_rotation=90, horizontal="center")
    ws.row_dimensions[fila].height = 34


def fila_dias(ws, fila, nombre, rubro, total, valores, formato="0", negrita=False, formato_total="#,##0"):
    ws.cell(fila, 1, nombre).font = Font(bold=negrita)
    ws.cell(fila, 2, rubro)
    if total is not None:
        c = ws.cell(fila, 3, float(total)); c.number_format = formato_total; c.font = Font(bold=True)
    for j, x in enumerate(valores):
        if pd.notna(x):
            c = ws.cell(fila, COL0 + j, float(x)); c.number_format = formato; c.font = F_DIA
    if negrita:
        for col in range(1, COL0 + len(DIAS)):
            ws.cell(fila, col).fill = FILL_TOTAL


def nota(ws, fila, texto):
    ws.cell(fila, 1, texto).font = F_NOTA


def grafico_lineas(titulo, ws, fila_head, fila_ini, fila_fin, eje_y, colores, ancho=34, alto=9, apilado=False):
    ch = AreaChart() if apilado else LineChart()
    if apilado:
        ch.grouping = "stacked"
    ch.title, ch.y_axis.title, ch.width, ch.height = titulo, eje_y, ancho, alto
    # Una serie por fila: los valores son las columnas de días y el nombre es la columna A
    for fila, color in zip(range(fila_ini, fila_fin + 1), colores):
        valores = Reference(ws, min_col=COL0, max_col=COL0 + len(DIAS) - 1, min_row=fila, max_row=fila)
        s = Series(valores, title=str(ws.cell(fila, 1).value))
        ch.series.append(s)
        if apilado:
            s.graphicalProperties.solidFill = color
            s.graphicalProperties.line.noFill = True
        else:
            s.graphicalProperties.line.solidFill = color
            s.graphicalProperties.line.width = 22000
            s.smooth = False
    ch.set_categories(Reference(ws, min_col=COL0, max_col=COL0 + len(DIAS) - 1, min_row=fila_head))
    ch.x_axis.number_format = "dd/mm"
    ch.x_axis.majorTickMark = "out"
    ch.x_axis.tickLblSkip = 7
    ch.x_axis.delete = False
    ch.y_axis.delete = False
    ch.legend.position = "b"
    return ch


def grafico_barras(titulo, ws, col_val, fila_ini, fila_fin, eje, color, formato="#,##0"):
    ch = BarChart()
    ch.type, ch.title, ch.width = "bar", titulo, 22
    ch.height = max(6, 0.5 * (fila_fin - fila_ini + 1) + 2)
    ch.add_data(Reference(ws, min_col=col_val, min_row=fila_ini - 1, max_row=fila_fin), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=fila_ini, max_row=fila_fin))
    ch.series[0].graphicalProperties.solidFill = color
    ch.series[0].graphicalProperties.line.noFill = True
    ch.x_axis.scaling.orientation = "maxMin"           # el más alto arriba
    ch.y_axis.title, ch.y_axis.number_format = eje, formato
    ch.x_axis.delete = False; ch.y_axis.delete = False
    ch.legend = None
    ch.gapWidth = 40
    ch.dataLabels = DataLabelList(showVal=True, showCatName=False, showSerName=False, showLegendKey=False, showPercent=False); ch.dataLabels.numFmt = formato
    return ch, ch.height


def filas_alto(cm):
    return int(cm / 0.53) + 2                          # filas de ~0,53 cm que ocupa un gráfico


def dec(x, d=1):
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def signo(x):
    return "0 %" if abs(x) < 0.005 else f"{'+' if x > 0 else '−'}{abs(x):.0%}".replace("%", " %")


def mil(x):
    return f"{x:,.0f}".replace(",", ".")


def celda(ws, fila, col, valor, ancho=1, fmt=None, fill=None, font=None, alinear="right"):
    """Escribe un valor; si ancho > 1, combina esa cantidad de columnas (para que entre en las columnas angostas de días)."""
    c = ws.cell(fila, col, valor.item() if hasattr(valor, "item") else valor)
    if ancho > 1:
        ws.merge_cells(start_row=fila, start_column=col, end_row=fila, end_column=col + ancho - 1)
    c.alignment = Alignment(horizontal=alinear, vertical="top", wrap_text=True)
    if fmt:
        c.number_format = fmt
    if font:
        c.font = font
    if fill:
        for k in range(col, col + ancho):
            ws.cell(fila, k).fill = fill
    return c


def bloque_rotacion(ws, sid, L, r):
    """1 · Qué productos rotaron en esta sucursal y cuáles no."""
    ws.cell(r, 1, "1 · ¿Qué productos rotaron? (ventas del %s al %s en esta sucursal)" % (f"{INICIO:%d/%m}", f"{FOTO:%d/%m/%Y}")).font = F_SEC
    r += 1
    nota(ws, r, "Sin ventas: ni una unidad en los 90 días. Vendió, pero no en los últimos 30 días: vendía y se frenó. "
                "Vendió en los últimos 30 días: sigue rotando.")
    r += 2

    # Resumen por categoría
    heads = [("categoría", 1, 1), ("productos", 2, 1), ("stock hoy", 3, 1), ("% del stock", COL0, 3), ("vendidas", COL0 + 3, 3), ("cuáles", COL0 + 6, 40)]
    for t, col, ancho in heads:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if t in ("categoría", "cuáles") else "center")
    head = r
    for cat in ROTACION:
        g = L[L.rotacion == cat].sort_values("unidades", ascending=False)
        r += 1
        fill = PatternFill("solid", fgColor=COLOR_ROT[cat])
        celda(ws, r, 1, cat, fill=fill, font=Font(bold=True), alinear="left")
        celda(ws, r, 2, len(g), fill=fill)
        celda(ws, r, 3, int(g.unidades.sum()), fmt="#,##0", fill=fill)
        celda(ws, r, COL0, g.unidades.sum() / L.unidades.sum(), 3, fmt="0%", fill=fill)
        celda(ws, r, COL0 + 3, int(g.vendidas.sum()), 3, fmt="#,##0", fill=fill)
        lista = ", ".join(f"{p} ({int(u)} u)" for p, u in zip(g.producto, g.unidades)) or "—"
        celda(ws, r, COL0 + 6, lista, 40, fill=fill, alinear="left")
        ws.row_dimensions[r].height = 15 * max(1, -(-len(lista) // 200))
    ini, fin = head + 1, r

    # Gráficos: cuántos productos y cuánto stock hay en cada categoría
    for k, (col, titulo, eje, color) in enumerate([(2, f"{sid} · Productos según si rotaron", "productos", "5A6A74"),
                                                   (3, f"{sid} · Stock hoy según si rotaron", "unidades en stock", "B3402E")]):
        ch, _ = grafico_barras(titulo, ws, col, ini, fin, eje, color)
        ch.width, ch.height = 15, 6.5
        for j, cat in enumerate(ROTACION):
            from openpyxl.chart.marker import DataPoint
            pt = DataPoint(idx=j); pt.graphicalProperties.solidFill = {ROTACION[0]: "C0392B", ROTACION[1]: "C9A227", ROTACION[2]: "2E7D4F"}[cat]
            ch.series[0].dPt.append(pt)
        ws.add_chart(ch, f"{'A' if k == 0 else get_column_letter(COL0 + 12)}{r + 2}")
    r += filas_alto(6.5) + 2

    # Lo que dicen los números
    sin, frenado, rota = (L[L.rotacion == c] for c in ROTACION)
    sin_otro = sin[sin.vendidas_otras_sucursales > 0]
    lineas = [
        f"• {len(sin)} de {len(L)} productos no vendieron nada en {sid}: son {mil(sin.unidades.sum())} u, el {sin.unidades.sum() / L.unidades.sum():.0%} del stock de la sucursal."
        + (f" {len(sin_otro)} de ellos sí venden en otra sucursal ({', '.join(sin_otro.producto)}): el problema es de este local." if len(sin_otro) else ""),
        f"• {len(frenado)} vendían y se frenaron (nada en los últimos 30 días): {mil(frenado.unidades.sum())} u." if len(frenado) else "• Ningún producto se frenó en el último mes.",
        f"• {len(rota)} siguen vendiendo; de ellos, {(rota.pct_vendido >= 0.5).sum()} ya vendieron más de la mitad de su stock.",
    ]
    for t in lineas:
        ws.cell(r, 1, t)
        r += 1
    r += 1

    # ¿Tuvieron descuento?
    ws.cell(r, 1, "¿Tuvieron descuento? (según el historial de sugerencias y las campañas)").font = F_HEAD
    r += 1
    cols_d = [("descuento", 1, 2, None), ("productos", 3, 1, "0"), ("stock hoy", COL0, 3, "#,##0"), ("vendidas", COL0 + 3, 3, "#,##0"),
              ("sin ventas", COL0 + 6, 3, "0"), ("se frenó", COL0 + 9, 3, "0"), ("sigue rotando", COL0 + 12, 3, "0"), ("cuáles", COL0 + 15, 36, None)]
    for t, col, ancho, _ in cols_d:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 or t == "cuáles" else "center")
    for cat in DESCUENTO:
        g = L[L.descuento == cat]
        if not len(g):
            continue
        r += 1
        lista = ", ".join(g.sort_values("unidades", ascending=False).producto)
        vals = [cat, len(g), g.unidades.sum(), g.vendidas.sum()] + [(g.rotacion == x).sum() for x in ROTACION] + [lista]
        for (t, col, ancho, fmt), x in zip(cols_d, vals):
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 or t == "cuáles" else "right",
                  fill=PatternFill("solid", fgColor=COLOR_DESC[cat]) if col == 1 else None)
        ws.row_dimensions[r].height = 15 * max(1, -(-len(lista) // 180))
    r += 1
    ap = L[L.descuento == DESCUENTO[0]]
    if len(ap):
        ws.cell(r, 1, f"• {len(ap)} productos tuvieron un descuento aplicado en esta sucursal. Unidades por día con descuento contra el resto de la ventana: "
                      + ", ".join(f"{p} {a:.1f} contra {b:.1f} ({'+' if v >= 0 else '−'}{abs(v):.0%})".replace(".", ",")
                                  for p, a, b, v in zip(ap.producto, ap.u_dia_con_descuento, ap.u_dia_sin_descuento, ap.variacion_con_descuento)) + ".")
    else:
        ws.cell(r, 1, "• Ningún producto de esta sucursal tuvo un descuento aplicado en la ventana de ventas.")
    r += 1
    ws.cell(r, 1, "• Los descuentos aceptados sin fechas y las campañas no se ven en el precio de venta: no se puede medir si movieron algo.").font = F_NOTA
    r += 2

    # Detalle por producto
    ws.cell(r, 1, "Detalle por producto (ordenado por categoría y stock)").font = F_HEAD
    r += 1
    cols = [("producto", 1, 1, None), ("rubro", 2, 1, None), ("vendidas", 3, 1, "#,##0"), ("stock hoy", COL0, 3, "#,##0"),
            ("% vendido", COL0 + 3, 3, "0%"), ("vendidas últimos 30 días", COL0 + 6, 3, "#,##0"), ("primera venta", COL0 + 9, 4, "dd/mm/yyyy"),
            ("última venta", COL0 + 13, 4, "dd/mm/yyyy"), ("días sin vender", COL0 + 17, 3, "#,##0"),
            ("vendidas en otras sucursales", COL0 + 20, 4, "#,##0"), ("ingreso del lote", COL0 + 24, 4, "dd/mm/yyyy"), ("¿rotó?", COL0 + 28, 9, None),
            ("¿tuvo descuento?", COL0 + 37, 10, None), ("detalle del descuento", COL0 + 47, 22, None),
            ("u/día con descuento", COL0 + 69, 3, "0.0"), ("u/día sin descuento", COL0 + 72, 3, "0.0"), ("variación", COL0 + 75, 3, "+0%;-0%;0%")]
    for t, col, ancho, _ in cols:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 else "center")
    ws.row_dimensions[r].height = 30
    orden_cat = {c: i for i, c in enumerate(ROTACION)}
    det = L.assign(_o=L.rotacion.map(orden_cat)).sort_values(["_o", "unidades"], ascending=[True, False])
    for sku, f in det.iterrows():
        r += 1
        fill = PatternFill("solid", fgColor=COLOR_ROT[f.rotacion])
        vals = [f.producto, f.rubro, f.vendidas, f.unidades, f.pct_vendido, f.venta_ultimos_30,
                f.primera_venta, f.ultima_venta, f.dias_sin_vender, f.vendidas_otras_sucursales, f.fecha_ingreso, f.rotacion,
                f.descuento, f.descuento_detalle, f.u_dia_con_descuento, f.u_dia_sin_descuento, f.variacion_con_descuento]
        for (t, col, ancho, fmt), x in zip(cols, vals):
            if isinstance(x, pd.Timestamp):
                x = x.to_pydatetime()
            elif x is pd.NaT or (isinstance(x, float) and np.isnan(x)):
                x = "—"
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 or t in ("¿rotó?", "¿tuvo descuento?", "detalle del descuento") else "right",
                  fill=fill if t == "¿rotó?" else PatternFill("solid", fgColor=COLOR_DESC[f.descuento]) if t == "¿tuvo descuento?" else None)
    return r + 3



# ---------------------------------------------------------------------------------------------- hoja de sucursal
def hoja_sucursal(wb, sid):
    ws = wb.create_sheet(sid)
    L = lotes.xs(sid, level="sucursal_id").copy()
    V = vd.xs(sid, level="sucursal_id")
    S = stock_dia.xs(sid, level="sucursal_id")
    orden = L.vendidas.sort_values(ascending=False).index
    s_info = suc.loc[sid]

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 13
    ws.column_dimensions["C"].width = 9
    for j in range(len(DIAS)):
        ws.column_dimensions[get_column_letter(COL0 + j)].width = 5.6
    ws.freeze_panes = ws.cell(1, COL0)

    ws.cell(1, 1, f"{sid} · {s_info.nombre} ({s_info.ciudad}, {s_info.tipo})").font = F_TIT
    nota(ws, 2, f"{len(L)} productos · stock al {FOTO:%d/%m/%Y}: {int(L.unidades.sum()):,} u · vendidas del {INICIO:%d/%m/%Y} al {FOTO:%d/%m/%Y}: "
                f"{int(L.vendidas.sum()):,} u · venta: $ {L.venta_pesos.sum():,.0f}".replace(",", "."))
    r = 4
    r = bloque_rotacion(ws, sid, L, r)

    # ---- 1 · ventas por rubro
    ws.cell(r, 1, "2 · Ventas por rubro, día a día (unidades)").font = F_SEC
    r += 1
    encabezado_dias(ws, r, "rubro", "", "total")
    head1 = r
    por_rubro = V.groupby(L.rubro).sum().reindex(RUBROS, fill_value=0)
    rubros_aca = [x for x in RUBROS if (L.rubro == x).any()]
    for x in rubros_aca:
        r += 1; fila_dias(ws, r, x, "", por_rubro.loc[x].sum(), por_rubro.loc[x])
    r += 1; fila_dias(ws, r, "Total sucursal", "", V.sum().sum(), V.sum(), negrita=True)
    r += 2
    ws.cell(r, 1, "Promedio de los últimos 7 días (lo que muestra el gráfico)").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "rubro", "", "")
    head1b = r
    ini = r + 1
    for x in rubros_aca:
        r += 1; fila_dias(ws, r, x, "", None, por_rubro.loc[x].rolling(7).mean(), "0.0")
    r += 1; fila_dias(ws, r, "Total sucursal", "", None, V.sum().rolling(7).mean(), "0.0", negrita=True)
    ch = grafico_lineas(f"{sid} · Ventas por rubro (unidades por día, promedio de 7 días)", ws, head1b, ini, r, "unidades por día",
                        [COLORES_RUBRO[x] for x in rubros_aca] + [COLORES_RUBRO["Total"]])
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height)
    nota(ws, r, "Cada punto es el promedio de los 7 días anteriores: suaviza el día a día sin perder la tendencia. El dato diario está en la tabla de arriba.")
    r += 3

    # ---- ventas por rubro en pesos
    P = vdp.xs(sid, level="sucursal_id")
    ws.cell(r, 1, "Ventas por rubro en pesos, día a día (miles de $; el total, en $)").font = F_SEC
    r += 1
    nota(ws, r, "Unidades × precio cobrado ese día: incluye los descuentos aplicados. Las celdas de días muestran miles de $ (1.234 = $ 1.234.000).")
    r += 1
    encabezado_dias(ws, r, "rubro", "", "total $")
    ws.column_dimensions["C"].width = 15
    pr = P.groupby(L.rubro).sum().reindex(RUBROS, fill_value=0)
    for x in rubros_aca:
        r += 1; fila_dias(ws, r, x, "", pr.loc[x].sum(), pr.loc[x], "#,##0,", formato_total="$ #,##0")
    r += 1; fila_dias(ws, r, "Total sucursal", "", P.sum().sum(), P.sum(), "#,##0,", negrita=True, formato_total="$ #,##0")
    r += 2
    ws.cell(r, 1, "Promedio de los últimos 7 días, en miles de $ (lo que muestra el gráfico)").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "rubro", "", "")
    hp, ini = r, r + 1
    for x in rubros_aca:
        r += 1; fila_dias(ws, r, x, "", None, pr.loc[x].rolling(7).mean() / 1000, "#,##0")
    r += 1; fila_dias(ws, r, "Total sucursal", "", None, P.sum().rolling(7).mean() / 1000, "#,##0", negrita=True)
    ch = grafico_lineas(f"{sid} · Ventas por rubro en pesos (miles de $ por día, promedio de 7 días)", ws, hp, ini, r, "miles de $ por día",
                        [COLORES_RUBRO[x] for x in rubros_aca] + [COLORES_RUBRO["Total"]])
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height) + 2

    # ---- 2 · ventas por producto
    ws.cell(r, 1, "3 · Ventas por producto, día a día (unidades) · más oscuro = más venta").font = F_SEC
    r += 1
    encabezado_dias(ws, r, "producto", "rubro", "total")
    ini = r + 1
    for sku in orden:
        r += 1; fila_dias(ws, r, L.producto[sku], L.rubro[sku], V.loc[sku].sum(), V.loc[sku])
    fin = r
    ws.conditional_formatting.add(f"{get_column_letter(COL0)}{ini}:{ULT}{fin}",
                                  ColorScaleRule(start_type="num", start_value=0, start_color="FFFFFF", end_type="max", end_color="1D6A86"))
    r += 2
    ch, alto = grafico_barras(f"{sid} · Unidades vendidas por producto ({INICIO:%d/%m} al {FOTO:%d/%m})", ws, 3, ini, fin, "unidades", "1D6A86")
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(alto) + 2

    # ---- 3 · stock y rotación
    ws.cell(r, 1, "4 · Stock de los mismos productos, día a día").font = F_SEC
    r += 1
    nota(ws, r, f"El stock por día se reconstruye hacia atrás desde la foto del {FOTO:%d/%m/%Y}: stock del día = stock del {FOTO:%d/%m} + lo vendido después. "
                "Vacío antes de la fecha de ingreso. Supone que no hubo reposiciones, transferencias ni devoluciones (no están en los datos).")
    r += 2
    ws.cell(r, 1, "Stock por rubro al cierre de cada día (unidades)").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "rubro", "", "hoy")
    head3 = r
    ini = r + 1
    stock_rubro = S.fillna(0).groupby(L.rubro).sum()
    for x in rubros_aca:
        r += 1; fila_dias(ws, r, x, "", stock_rubro.loc[x].iloc[-1], stock_rubro.loc[x])
    fin = r
    r += 1; fila_dias(ws, r, "Total sucursal", "", stock_rubro.sum().iloc[-1], stock_rubro.sum(), negrita=True)
    ch = grafico_lineas(f"{sid} · Stock por rubro, día a día (unidades, apilado)", ws, head3, ini, fin, "unidades en stock",
                        [COLORES_RUBRO[x] for x in rubros_aca], apilado=True)
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height) + 1

    ws.cell(r, 1, "Stock por producto al cierre de cada día (unidades) · más oscuro = más stock").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "producto", "rubro", "hoy")
    ini = r + 1
    for sku in orden:
        r += 1; fila_dias(ws, r, L.producto[sku], L.rubro[sku], L.unidades[sku], S.loc[sku])
    fin = r
    ws.conditional_formatting.add(f"{get_column_letter(COL0)}{ini}:{ULT}{fin}",
                                  ColorScaleRule(start_type="num", start_value=0, start_color="FFFFFF", end_type="max", end_color="C9772B"))
    r += 3

    ws.cell(r, 1, "% vendido y ritmo por producto").font = F_HEAD
    r += 1
    cols = [("producto", None, 32), ("rubro", None, 13), ("stock al inicio", "#,##0", 9), ("vendidas", "#,##0", 9), ("stock hoy", "#,##0", 9),
            ("% vendido", "0%", 9), ("vendidas últimos 30 días", "#,##0", 10), ("días de stock (ritmo últimos 30)", "#,##0", 11),
            ("ritmo objetivo (u/día)", "0.00", 10), ("ritmo real (u/día)", "0.00", 10), ("% de lo esperado", "0%", 10),
            ("ingreso", "dd/mm/yyyy", 11), ("fecha límite", "dd/mm/yyyy", 11), ("¿fecha límite vencida?", None, 10)]
    col_de = lambda j: j if j <= 2 else COL0 + 3 * (j - 3)          # producto y rubro en A y B; cada dato en 3 columnas de días
    def poner(fila, j, valor):
        c = ws.cell(fila, col_de(j), valor)
        if j > 2:
            ws.merge_cells(start_row=fila, start_column=col_de(j), end_row=fila, end_column=col_de(j) + 2)
            c.alignment = Alignment(horizontal="right", wrap_text=True, vertical="top")
        return c
    for j, (t, _, _) in enumerate(cols, start=1):
        c = poner(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD; c.alignment = Alignment(wrap_text=True, vertical="top", horizontal="center" if j > 2 else "left")
    ws.row_dimensions[r].height = 42
    ini = r + 1
    rot = L.loc[orden].sort_values("pct_vendido", ascending=False)
    for sku, f in rot.iterrows():
        r += 1
        vals = [f.producto, f.rubro, f.stock_inicial, f.vendidas, f.unidades, f.pct_vendido, f.venta_ultimos_30, f.dias_de_stock,
                f.ritmo_objetivo, f.ritmo_observado, f.pct_esperado, f.fecha_ingreso.to_pydatetime(), f.fecha_limite.to_pydatetime(), f.vencido]
        for j, (x, (_, fmt, _)) in enumerate(zip(vals, cols), start=1):
            if isinstance(x, (np.floating, float)) and np.isnan(x):
                poner(r, j, "sin venta" if j == 8 else None)
                continue
            c = poner(r, j, x.item() if hasattr(x, "item") else x)
            if fmt:
                c.number_format = fmt
    fin = r
    cF, cK = get_column_letter(col_de(6)), get_column_letter(col_de(11))
    ws.conditional_formatting.add(f"{cF}{ini}:{cF}{fin}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="2E7D4F"))
    ws.conditional_formatting.add(f"{cK}{ini}:{cK}{fin}", ColorScaleRule(start_type="num", start_value=0, start_color="F2C4BC",
                                                                   mid_type="num", mid_value=0.9, mid_color="FFFFFF", end_type="num", end_value=1.4, end_color="BFE0CC"))
    r += 2
    ch, alto = grafico_barras(f"{sid} · % vendido por producto (vendidas ÷ stock al inicio)", ws, col_de(6), ini, fin, "% vendido", "2E7D4F", "0%")
    ch.y_axis.scaling.min, ch.y_axis.scaling.max = 0, 1
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(alto)
    nota(ws, r, f"Stock al inicio = stock hoy + vendidas desde el {INICIO:%d/%m/%Y} (o desde el ingreso, si el lote llegó después). "
                "% de lo esperado = ritmo real ÷ ritmo objetivo (la cuenta de la consigna): 90 % o más es que el lote viene al día.")
    return ws


# ---------------------------------------------------------------------------------------------- hojas de apoyo
def grafico_columnas(titulo, ws, series, fila_ini, fila_fin, col_cat, formato, apilado=False, ancho=16, alto=7.5):
    """Columnas agrupadas (o apiladas): series = [(columna, nombre, color), ...]; categorías en col_cat."""
    ch = BarChart()
    ch.type, ch.title, ch.width, ch.height = "col", titulo, ancho, alto
    ch.grouping = "stacked" if apilado else "clustered"
    if apilado:
        ch.overlap = 100
    for col, nombre, color in series:
        sr = Series(Reference(ws, min_col=col, min_row=fila_ini, max_row=fila_fin), title=nombre)
        sr.graphicalProperties.solidFill = color; sr.graphicalProperties.line.noFill = True
        ch.series.append(sr)
    ch.set_categories(Reference(ws, min_col=col_cat, min_row=fila_ini, max_row=fila_fin))
    ch.y_axis.number_format = formato
    ch.x_axis.delete = False; ch.y_axis.delete = False; ch.legend.position = "b"
    if not apilado:
        ch.dataLabels = DataLabelList(showVal=True, showCatName=False, showSerName=False, showLegendKey=False, showPercent=False)
        ch.dataLabels.numFmt = formato
    return ch


def bloque_unidades_vs_pesos(ws, sucursales_, r):
    """2 · ¿Cambian las conclusiones si se mide en unidades o en pesos?"""
    ws.cell(r, 1, "2 · Unidades contra pesos: ¿cambian las conclusiones?").font = F_SEC
    r += 1
    nota(ws, r, "Venta en $ = unidades × precio cobrado ese día. Cuando el puesto en unidades y en pesos no coincide, la diferencia es el precio promedio: "
                "se venden productos más caros o más baratos.")
    r += 2
    cols = [("", 1, 1, None), ("", 2, 1, None), ("unidades", 3, 1, "#,##0"), ("% de las unidades", COL0, 3, "0%"),
            ("venta en $", COL0 + 3, 4, "$ #,##0"), ("% de los pesos", COL0 + 7, 3, "0%"), ("precio promedio por unidad", COL0 + 10, 3, "$ #,##0"),
            ("puesto en unidades", COL0 + 13, 3, "0"), ("puesto en pesos", COL0 + 16, 3, "0"),
            ("% del stock (unidades)", COL0 + 19, 3, "0%"), ("% del stock (a costo)", COL0 + 22, 3, "0%")]
    conclusiones = []
    graficos = []
    for nivel, grupos in [("sucursal", [(sid, lotes.xs(sid, level="sucursal_id")) for sid in sucursales_]),
                          ("rubro", [(x, lotes[lotes.rubro == x]) for x in RUBROS])]:
        ws.cell(r, 1, f"Por {nivel}").font = F_HEAD
        r += 1
        for t, col, ancho, _ in cols:
            celda(ws, r, col, nivel if col == 1 else t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 else "center")
        ws.row_dimensions[r].height = 30
        u = pd.Series({k: L.vendidas.sum() for k, L in grupos})
        m = pd.Series({k: L.venta_pesos.sum() for k, L in grupos})
        su = pd.Series({k: L.unidades.sum() for k, L in grupos})
        sc = pd.Series({k: L.stock_costo.sum() for k, L in grupos})
        ru, rm = u.rank(ascending=False, method="min").astype(int), m.rank(ascending=False, method="min").astype(int)
        ini = r + 1
        for k in m.sort_values(ascending=False).index:
            r += 1
            vals = [k if nivel == "rubro" else f"{k} · {suc.nombre[k]}", "", u[k], u[k] / u.sum(), m[k], m[k] / m.sum(), m[k] / u[k] if u[k] else None,
                    ru[k], rm[k], su[k] / su.sum(), sc[k] / sc.sum()]
            for (t, col, ancho, fmt), x in zip(cols, vals):
                if x is not None:
                    celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 else "right",
                          fill=PatternFill("solid", fgColor="F5E2A8") if t.startswith("puesto") and ru[k] != rm[k] else None)
        fin = r
        graficos.append(grafico_columnas(f"Por {nivel}: % de las unidades y % de los pesos", ws,
                                         [(COL0, "% de las unidades", "9AA0A6"), (COL0 + 7, "% de los pesos", "1D6A86")], ini, fin, 1, "0%"))
        cambian = [k for k in m.index if ru[k] != rm[k]]
        top_u, top_m = u.idxmax(), m.idxmax()
        conclusiones.append(
            f"• Por {nivel}: " + (f"la que más unidades vende es {top_u} y la que más pesos, {top_m}. " if nivel == "sucursal" and top_u != top_m else
                                  f"el que más unidades vende es {top_u} y el que más pesos, {top_m}. " if top_u != top_m else f"{top_m} lidera en unidades y en pesos. ")
            + (f"Cambian de puesto: {', '.join(f'{k} ({ru[k]}.º en unidades, {rm[k]}.º en pesos)' for k in cambian)}." if cambian else "Ningún puesto cambia."))
        dif = (m / m.sum() - u / u.sum())
        conclusiones.append(f"  Lo que más gana al medir en pesos: {dif.idxmax()} ({u[dif.idxmax()] / u.sum():.0%} de las unidades, {m[dif.idxmax()] / m.sum():.0%} de los pesos). "
                            f"Lo que más pierde: {dif.idxmin()} ({u[dif.idxmin()] / u.sum():.0%} contra {m[dif.idxmin()] / m.sum():.0%}).")
        if nivel == "sucursal":
            brecha_u, brecha_c = su / su.sum() - u / u.sum(), sc / sc.sum() - m / m.sum()
            invierte = [k for k in su.index if np.sign(brecha_u[k]) != np.sign(brecha_c[k]) and abs(brecha_u[k]) > 0.01]
            conclusiones.append(f"  Más stock que venta, en unidades y a costo: {', '.join(k for k in su.index if brecha_u[k] > 0.01 and brecha_c[k] > 0.01) or 'ninguna'}."
                                + (f" Se invierte al medir en plata: {', '.join(invierte)}." if invierte else ""))
        r += 2
        ws.add_chart(graficos[-1], f"A{r}")
        r += filas_alto(7.5) + 1

    # Stock valuado a costo según si rotó
    ws.cell(r, 1, "Stock hoy según si rotó: unidades, a costo y a precio de lista").font = F_HEAD
    r += 1
    cols_s = [("categoría", 1, 1, None), ("", 2, 1, None), ("unidades", 3, 1, "#,##0"), ("% de las unidades", COL0, 3, "0%"),
              ("a costo ($)", COL0 + 3, 4, "$ #,##0"), ("% a costo", COL0 + 7, 3, "0%"), ("a precio de lista ($)", COL0 + 10, 4, "$ #,##0")]
    for k, sid in enumerate(sucursales_):
        cols_s.append((f"{sid} a costo ($)", COL0 + 14 + 4 * k, 4, "$ #,##0"))
    for t, col, ancho, _ in cols_s:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 else "center")
    ws.row_dimensions[r].height = 30
    ini = r + 1
    for cat in ROTACION + ["Total"]:
        r += 1
        L = lotes if cat == "Total" else lotes[lotes.rotacion == cat]
        fill = FILL_TOTAL if cat == "Total" else PatternFill("solid", fgColor=COLOR_ROT[cat])
        vals = [cat, "", L.unidades.sum(), L.unidades.sum() / lotes.unidades.sum(), L.stock_costo.sum(), L.stock_costo.sum() / lotes.stock_costo.sum(),
                L.stock_lista.sum()] + [L.stock_costo[L.index.get_level_values("sucursal_id") == sid].sum() for sid in sucursales_]
        for (t, col, ancho, fmt), x in zip(cols_s, vals):
            celda(ws, r, col, x, ancho, fmt=fmt, fill=fill if col == 1 else None, font=Font(bold=cat == "Total"),
                  alinear="left" if col <= 2 else "right")
    fin = r - 1
    # Tabla auxiliar (sucursal × categoría, a costo) para el gráfico apilado
    t0 = COL0 + 50
    r += 2
    celda(ws, r, t0, "a costo", font=F_HEAD)
    for k, cat in enumerate(ROTACION):
        celda(ws, r, t0 + 1 + 3 * k, cat, 3, font=F_HEAD, fill=PatternFill("solid", fgColor=COLOR_ROT[cat]))
    aux = r
    for sid in sucursales_:
        r += 1
        L = lotes.xs(sid, level="sucursal_id")
        celda(ws, r, t0, sid, alinear="left")
        for k, cat in enumerate(ROTACION):
            celda(ws, r, t0 + 1 + 3 * k, float(L.stock_costo[L.rotacion == cat].sum()), 3, fmt="$ #,##0")
    ch1 = grafico_columnas("Stock a costo según si rotó (cadena)", ws, [(COL0 + 3, "a costo ($)", "B3402E")], ini, fin, 1, "$ #,##0", alto=9)
    ch2 = grafico_columnas("Stock a costo según si rotó, por sucursal ($)", ws,
                           [(t0 + 1 + 3 * k, ROTACION[k], c) for k, c in enumerate(["C0392B", "C9A227", "2E7D4F"])], aux + 1, r, t0, "$ #,##0", apilado=True)
    r = aux
    ws.add_chart(ch1, f"A{r}")
    ws.add_chart(ch2, f"{get_column_letter(COL0 + 14)}{r}")
    r += filas_alto(7.5) + 1
    sin, fr = lotes[lotes.rotacion == ROTACION[0]], lotes[lotes.rotacion == ROTACION[1]]
    conclusiones.append(f"• Stock quieto a costo: $ {mil(sin.stock_costo.sum())} en productos sin ventas ({sin.stock_costo.sum() / lotes.stock_costo.sum():.0%} del stock a costo) "
                        f"y $ {mil(fr.stock_costo.sum())} en productos que se frenaron ({fr.stock_costo.sum() / lotes.stock_costo.sum():.0%}). "
                        f"En unidades son el {sin.unidades.sum() / lotes.unidades.sum():.0%} y el {fr.unidades.sum() / lotes.unidades.sum():.0%}: la foto casi no cambia.")
    ws.cell(r, 1, "Qué cambia y qué no").font = F_HEAD
    r += 1
    for t in conclusiones:
        ws.cell(r, 1, t); r += 1
    return r + 2


def hoja_descuentos(wb):
    """Cómo reaccionó cada producto en cada sucursal antes, durante y después de su descuento aplicado."""
    ws = wb.create_sheet("Descuentos", 1)
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 11
    ws.column_dimensions["C"].width = 11
    for j in range(len(DIAS)):
        ws.column_dimensions[get_column_letter(COL0 + j)].width = 5.6
    ap = hist.dropna(subset=["fecha_vigencia_desde"])
    D0, D1 = ap.fecha_vigencia_desde.min(), ap.fecha_vigencia_hasta.max()
    per = np.where(DIAS < D0, "antes", np.where(DIAS <= D1, "durante", "después"))
    PER = ["antes", "durante", "después"]
    ndias = {k: int((per == k).sum()) for k in PER}
    costo_l = lotes.index.get_level_values("sku").map(prod.costo_unitario).values
    margen_dia = vdp - vd.mul(costo_l, axis=0)              # $ por día: lo cobrado menos el costo de lo vendido
    rng = np.random.default_rng(0)

    ws.cell(1, 1, "Descuentos: cómo reaccionó cada producto en cada sucursal, antes, durante y después").font = F_TIT
    nota(ws, 2, f"Los {len(ap)} descuentos aplicados fueron todos del {D0:%d/%m/%Y} al {D1:%d/%m/%Y}. Antes = {INICIO:%d/%m} al {D0 - pd.Timedelta(days=1):%d/%m} "
                f"({ndias['antes']} días) · durante = {ndias['durante']} días · después = {D1 + pd.Timedelta(days=1):%d/%m} al {FOTO:%d/%m} ({ndias['después']} días). "
                "Todo en promedio por día, para que los períodos de distinto largo se puedan comparar.")
    r = 4

    # ---- 1 · tabla principal
    ws.cell(r, 1, "1 · Cada producto con descuento, en cada una de sus sucursales").font = F_SEC
    r += 1
    nota(ws, r, "Rango = entre qué valores puede estar la variación por azar (se recalcula 2.000 veces tomando días al azar). Si el rango no cruza el 0 %, la reacción es firme. "
                "Margen por día = lo cobrado menos el costo de lo vendido.")
    r += 1
    cols = [("producto", 1, 1, None), ("sucursal", 2, 1, None), ("descuento", 3, 1, "0%"), ("u/día antes", COL0, 3, "0.00"),
            ("u/día durante", COL0 + 3, 3, "0.00"), ("u/día después", COL0 + 6, 3, "0.00"), ("durante vs antes", COL0 + 9, 3, "+0%;-0%;0%"),
            ("rango (5 % a 95 %)", COL0 + 12, 5, None), ("después vs antes", COL0 + 17, 3, "+0%;-0%;0%"),
            ("$/día antes", COL0 + 20, 4, "$ #,##0"), ("$/día durante", COL0 + 24, 4, "$ #,##0"), ("$/día después", COL0 + 28, 4, "$ #,##0"),
            ("margen/día antes", COL0 + 32, 4, "$ #,##0"), ("margen/día durante", COL0 + 36, 4, "$ #,##0"), ("margen/día después", COL0 + 40, 4, "$ #,##0"),
            ("margen durante vs antes", COL0 + 44, 3, "+0%;-0%;0%"), ("lectura", COL0 + 47, 24, None)]
    for t, col, ancho, _ in cols:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 or t == "lectura" else "center")
    ws.row_dimensions[r].height = 30
    filas, mini = [], {}
    for x in ap.sort_values("descuento_pct").itertuples():
        for sid in lotes.xs(x.sku, level="sku").index:
            u = vd.loc[(x.sku, sid)].values
            esta = np.asarray(DIAS >= lotes.cuenta_desde[(x.sku, sid)])          # solo los días en que el lote ya estaba en el local
            m = {k: u[(per == k) & esta].mean() for k in PER}
            pesos = {k: vdp.loc[(x.sku, sid)].values[(per == k) & esta].mean() for k in PER}
            marg = {k: margen_dia.loc[(x.sku, sid)].values[(per == k) & esta].mean() for k in PER}
            a, b = u[(per == "antes") & esta], u[per == "durante"]
            sim = [rng.choice(b, len(b)).mean() / max(rng.choice(a, len(a)).mean(), 1e-9) - 1 for _ in range(2000)]
            lo, hi = np.percentile(sim, [5, 95])
            dur, desp = m["durante"] / m["antes"] - 1, m["después"] / m["antes"] - 1
            if lo <= 0:
                lec = "No se puede decir que reaccionó: la variación entra en lo que cambia por azar"
            elif desp < -0.15:
                lec = "Subió con el descuento y después cayó por debajo de antes: en parte adelantó compras"
            elif desp > 0.15:
                lec = "Subió con el descuento y siguió alto después: no es solo el descuento"
            else:
                lec = "Subió con el descuento y después volvió a su nivel"
            filas.append(dict(sku=x.sku, sid=sid, d=x.descuento_pct / 100, **{f"u_{k}": m[k] for k in PER}, dur=dur, lo=lo, hi=hi, desp=desp,
                              **{f"p_{k}": pesos[k] for k in PER}, **{f"m_{k}": marg[k] for k in PER}, mdur=marg["durante"] / marg["antes"] - 1, lec=lec))
            mini.setdefault(x.sku, []).append((sid, m))
    for f in filas:
        r += 1
        firme = f["lo"] > 0
        vals = [prod.nombre[f["sku"]], f["sid"], f["d"], f["u_antes"], f["u_durante"], f["u_después"], f["dur"],
                f"{signo(f['lo'])} a {signo(f['hi'])}", f["desp"], f["p_antes"], f["p_durante"], f["p_después"], f["m_antes"], f["m_durante"], f["m_después"], f["mdur"], f["lec"]]
        for (t, col, ancho, fmt), x in zip(cols, vals):
            fill = None
            if t == "durante vs antes":
                fill = PatternFill("solid", fgColor="CDE8D6" if firme else "EEEEEE")
            if t == "margen durante vs antes":
                fill = PatternFill("solid", fgColor="CDE8D6" if x >= 0 else "F2C4BC")
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 or t == "lectura" else "right", fill=fill)
    r += 2

    # ---- 2 · control
    ws.cell(r, 1, "2 · Control: productos que venden bien y no tuvieron ningún cambio, en las mismas fechas").font = F_SEC
    r += 1
    nota(ws, r, "Si estos también subieran 'durante', la suba de los descontados sería temporada y no descuento.")
    r += 1
    tocados = set(hist.sku) | set(camp.sku) | set(h["cambios_precio"].sku)
    ctrl = [i for i in lotes.index if i[0] not in tocados and lotes.pct_esperado[i] >= CRITERIO_AL_DIA
            and lotes.fecha_ingreso[i] <= INICIO]                 # que ya estuviera en el local antes de la ventana
    for t, col, ancho, _ in cols[:2] + cols[3:7] + [cols[8]]:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 else "center")
    ctrl_filas = []
    for i in ctrl + ["total"]:
        r += 1
        u = (vd.loc[ctrl].sum() if i == "total" else vd.loc[i]).values
        m = {k: u[per == k].mean() for k in PER}
        ctrl_filas.append(dict(producto="Total control" if i == "total" else prod.nombre[i[0]], sucursal="" if i == "total" else i[1],
                               u_antes=m["antes"], u_durante=m["durante"], u_despues=m["después"],
                               dur=m["durante"] / m["antes"] - 1, desp=m["después"] / m["antes"] - 1))
        vals = ["Total control" if i == "total" else prod.nombre[i[0]], "" if i == "total" else i[1], m["antes"], m["durante"], m["después"],
                m["durante"] / m["antes"] - 1, m["después"] / m["antes"] - 1]
        for (t, col, ancho, fmt), x in zip(cols[:2] + cols[3:7] + [cols[8]], vals):
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 else "right", font=Font(bold=i == "total"),
                  fill=FILL_TOTAL if i == "total" else None)
    uc = vd.loc[ctrl].sum().values
    ctrl_dur = uc[per == "durante"].mean() / uc[per == "antes"].mean() - 1
    r += 2

    # ---- 3 · gráficos por producto
    ws.cell(r, 1, "3 · Unidades por día antes, durante y después, producto por producto").font = F_SEC
    r += 1
    nota(ws, r, "Cada barra es una sucursal. Si la del medio (durante) es más alta, vendió más con el descuento; la tercera muestra si se sostuvo después.")
    r += 2
    for k, (sku, lst) in enumerate(mini.items()):
        top = r
        celda(ws, r, 1, f"{prod.nombre[sku]} · {int(ap.set_index('sku').descuento_pct[sku])} %", fill=FILL_HEAD, font=F_HEAD, alinear="left")
        for j, t in enumerate(PER):
            celda(ws, r, 2 + j, t, fill=FILL_HEAD, font=F_HEAD, alinear="center")
        for sid, m in lst:
            r += 1
            celda(ws, r, 1, sid, alinear="left")
            for j, t in enumerate(PER):
                celda(ws, r, 2 + j, m[t], fmt="0.00")
        ch = BarChart()
        ch.type, ch.grouping, ch.title, ch.width, ch.height = "col", "clustered", f"{prod.nombre[sku]} · descuento {int(ap.set_index('sku').descuento_pct[sku])} %", 14, 6
        for i, (sid, _) in enumerate(lst):
            sr = Series(Reference(ws, min_col=2, max_col=4, min_row=top + 1 + i), title=sid)
            sr.graphicalProperties.solidFill = ["2A6F97", "C9A227", "2E7D4F"][i]; sr.graphicalProperties.line.noFill = True
            ch.series.append(sr)
        ch.set_categories(Reference(ws, min_col=2, max_col=4, min_row=top))
        ch.y_axis.title = "unidades por día"; ch.y_axis.number_format = "0.0"; ch.y_axis.scaling.min = 0
        ch.x_axis.delete = False; ch.y_axis.delete = False; ch.legend.position = "b"
        ch.dataLabels = DataLabelList(showVal=True, showCatName=False, showSerName=False, showLegendKey=False, showPercent=False); ch.dataLabels.numFmt = "0.0"
        ws.add_chart(ch, f"{get_column_letter(COL0 + 1)}{top}")
        r = top + filas_alto(6)

    # ---- 4 · día a día
    ws.cell(r, 1, "4 · Día a día (unidades) · en verde, los días del descuento").font = F_SEC
    r += 1
    encabezado_dias(ws, r, "producto", "sucursal", "total")
    for j, d in enumerate(DIAS):
        if per[j] == "durante":
            ws.cell(r, COL0 + j).fill = PatternFill("solid", fgColor="9FD3B5")
    ini = r + 1
    for f in filas:
        r += 1; fila_dias(ws, r, prod.nombre[f["sku"]], f["sid"], vd.loc[(f["sku"], f["sid"])].sum(), vd.loc[(f["sku"], f["sid"])])
    ws.conditional_formatting.add(f"{get_column_letter(COL0)}{ini}:{ULT}{r}",
                                  ColorScaleRule(start_type="num", start_value=0, start_color="FFFFFF", end_type="max", end_color="1D6A86"))
    r += 3

    # ---- 5 · ¿el efecto duró?
    ws.cell(r, 1, "5 · ¿El efecto duró? Semana a semana, durante y después del descuento (cada producto, sumando sus sucursales)").font = F_SEC
    r += 1
    nota(ws, r, "Índice = unidades por día de esa semana ÷ unidades por día de antes del descuento. 1,00 = igual que antes; 1,30 = 30 % más. "
                "Corregido por temporada: se divide por lo que hizo el control esa misma semana. Se suman las sucursales para tener menos ruido.")
    r += 1
    rel = np.asarray((DIAS - D0).days)
    sem = np.floor(rel / 7).astype(int)
    semanas = sorted(k for k in set(sem) if k >= 0)
    nombre_sem = {k: (f"durante · sem {k + 1}" if (D0 + pd.Timedelta(days=7 * k)) <= D1 else f"después · sem {k - (int((D1 - D0).days) // 7)}") for k in semanas}
    ingreso_p = lotes.reset_index().groupby("sku").cuenta_desde.min()
    vp = vd.groupby(level="sku").sum()
    vcp = vdp.groupby(level="sku").sum()
    uc_ = vd.loc[ctrl].sum().values
    c_idx = {k: uc_[sem == k].mean() / uc_[rel < 0].mean() for k in semanas}
    celda(ws, r, 1, "producto", fill=FILL_HEAD, font=F_HEAD, alinear="left")
    celda(ws, r, 2, "descuento", fill=FILL_HEAD, font=F_HEAD, alinear="center")
    celda(ws, r, 3, "u/día antes", fill=FILL_HEAD, font=F_HEAD, alinear="center")
    for j, k in enumerate(semanas):
        celda(ws, r, COL0 + 3 * j, nombre_sem[k], 3, fill=FILL_HEAD, font=F_HEAD, alinear="center")
    c_lec = COL0 + 3 * len(semanas)
    celda(ws, r, c_lec, "lectura", 20, fill=FILL_HEAD, font=F_HEAD, alinear="left")
    ws.row_dimensions[r].height = 30
    head5 = r
    persist = []
    dur_mask = np.asarray((DIAS >= D0) & (DIAS <= D1)); desp_mask = np.asarray(DIAS > D1)
    for x in ap.sort_values("descuento_pct").itertuples():
        u = vp.loc[x.sku].values
        esta = np.asarray(DIAS >= ingreso_p[x.sku])
        base = u[(rel < 0) & esta].mean()
        idx = {k: u[sem == k].mean() / base / c_idx[k] for k in semanas}
        esperado = np.array([base * c_idx.get(k, 1) if k >= 0 else base for k in sem])
        extra_dur, extra_desp = (u - esperado)[dur_mask].sum(), (u - esperado)[desp_mask].sum()
        precio, costo_u, d = prod.precio_lista[x.sku], prod.costo_unitario[x.sku], x.descuento_pct / 100
        # margen ganado o perdido contra seguir igual que antes (corregido por temporada)
        m_dur = (u[dur_mask] * (precio * (1 - d) - costo_u) - esperado[dur_mask] * (precio - costo_u)).sum()
        m_desp = ((u[desp_mask] - esperado[desp_mask]) * (precio - costo_u)).sum()
        desp_idx = np.mean([idx[k] for k in semanas if nombre_sem[k].startswith("después")])
        dur_idx = [idx[k] for k in semanas if nombre_sem[k].startswith("durante")]
        if max(dur_idx) < 1.15:
            lec = "No subió en ninguna semana del descuento"
        elif desp_idx >= 1.1:
            lec = "Subió y siguió alto después: efecto persistente (o el producto ya venía en alza)"
        elif desp_idx <= 0.9:
            lec = "Subió durante y cayó después: parte de lo vendido fue adelantar compras"
        else:
            lec = "Subió durante y volvió a su nivel al terminar"
        if dur_idx[-1] < dur_idx[0] - 0.3:
            lec += "; el efecto se fue apagando dentro del mes"
        persist.append(dict(sku=x.sku, d=d, base=base, extra_dur=extra_dur, extra_desp=extra_desp, m_dur=m_dur, m_desp=m_desp, lec=lec, desp_idx=desp_idx,
                            idx=[idx[k] for k in semanas]))
        r += 1
        celda(ws, r, 1, prod.nombre[x.sku], alinear="left"); celda(ws, r, 2, d, fmt="0%"); celda(ws, r, 3, base, fmt="0.00")
        for j, k in enumerate(semanas):
            celda(ws, r, COL0 + 3 * j, idx[k], 3, fmt="0.00")
        celda(ws, r, c_lec, lec, 20, alinear="left")
    fin5 = r
    r += 1
    celda(ws, r, 1, "Control (sin cambios), sin corregir", alinear="left", font=Font(italic=True))
    for j, k in enumerate(semanas):
        celda(ws, r, COL0 + 3 * j, c_idx[k], 3, fmt="0.00", font=Font(italic=True))
    ws.conditional_formatting.add(f"{get_column_letter(COL0)}{head5 + 1}:{get_column_letter(COL0 + 3 * len(semanas) - 1)}{fin5}",
                                  ColorScaleRule(start_type="num", start_value=0.5, start_color="E2705C", mid_type="num", mid_value=1, mid_color="FFFFFF",
                                                 end_type="num", end_value=1.8, end_color="2E7D4F"))
    # gráfico de líneas: índice semanal de cada producto (tabla auxiliar contigua a la derecha, para el gráfico)
    aux = COL0 + len(DIAS) + 3
    celda(ws, head5, aux - 1, "para el gráfico", font=F_NOTA, alinear="left")
    for j, k in enumerate(semanas):
        celda(ws, head5, aux + j, nombre_sem[k].replace("durante · ", "dur ").replace("después · ", "desp "), font=F_HEAD)
    for rr in range(head5 + 1, fin5 + 1):
        celda(ws, rr, aux - 1, ws.cell(rr, 1).value, alinear="left")
        for j in range(len(semanas)):
            celda(ws, rr, aux + j, ws.cell(rr, COL0 + 3 * j).value, fmt="0.00")
    ch = LineChart()
    ch.title, ch.width, ch.height = "Índice semanal contra antes del descuento (1 = igual que antes; corregido por temporada)", 30, 9
    for i, rr in enumerate(range(head5 + 1, fin5 + 1)):
        sr = Series(Reference(ws, min_col=aux, max_col=aux + len(semanas) - 1, min_row=rr), title=str(ws.cell(rr, 1).value))
        sr.graphicalProperties.line.solidFill = ["2A6F97", "C9A227", "2E7D4F", "B3402E", "7A4A9A", "5A6A74", "D9772B", "1D6A86"][i % 8]
        sr.graphicalProperties.line.width = 20000
        ch.series.append(sr)
    ch.set_categories(Reference(ws, min_col=aux, max_col=aux + len(semanas) - 1, min_row=head5))
    ch.y_axis.title = "índice (1 = antes)"; ch.y_axis.number_format = "0.0"
    ch.x_axis.delete = False; ch.y_axis.delete = False; ch.legend.position = "b"
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(9) + 1

    # unidades y margen netos
    ws.cell(r, 1, "Lo que dejó cada descuento, sumando durante y después (contra seguir igual que antes, corregido por temporada)").font = F_HEAD
    r += 1
    cols5 = [("producto", 1, 1, None), ("descuento", 2, 1, "0%"), ("u extra durante", 3, 1, "+#,##0;-#,##0;0"), ("u extra después", COL0, 3, "+#,##0;-#,##0;0"),
             ("u extra netas", COL0 + 3, 3, "+#,##0;-#,##0;0"), ("lo perdido después ÷ lo ganado durante", COL0 + 6, 4, "0%"),
             ("margen durante ($)", COL0 + 10, 4, "+$ #,##0;-$ #,##0;$ 0"), ("margen después ($)", COL0 + 14, 4, "+$ #,##0;-$ #,##0;$ 0"),
             ("margen neto ($)", COL0 + 18, 4, "+$ #,##0;-$ #,##0;$ 0")]
    for t, col, ancho, _ in cols5:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col == 1 else "center")
    ws.row_dimensions[r].height = 30
    for f in persist:
        r += 1
        devuelto = -f["extra_desp"] / f["extra_dur"] if f["extra_dur"] > 0 and f["extra_desp"] < 0 else 0
        vals = [prod.nombre[f["sku"]], f["d"], round(f["extra_dur"]), round(f["extra_desp"]), round(f["extra_dur"] + f["extra_desp"]), devuelto,
                f["m_dur"], f["m_desp"], f["m_dur"] + f["m_desp"]]
        for (t, col, ancho, fmt), x in zip(cols5, vals):
            fill = None
            if t in ("u extra netas", "margen neto ($)"):
                fill = PatternFill("solid", fgColor="CDE8D6" if x > 0 else "F2C4BC")
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col == 1 else "right", fill=fill)
    r += 2
    P_ = pd.DataFrame(persist)
    P_["neto_u"] = P_.extra_dur + P_.extra_desp
    P_["neto_m"] = P_.m_dur + P_.m_desp
    adel = P_[(P_.extra_dur > 0) & (P_.extra_desp < 0)]
    lineas5 = [
        f"• Persistencia: {(P_.desp_idx >= 1.1).sum()} productos siguieron vendiendo más después del descuento "
        f"({', '.join(prod.nombre[s_] for s_ in P_.sku[P_.desp_idx >= 1.1])}); {(P_.desp_idx <= 0.9).sum()} cayeron por debajo de antes "
        f"({', '.join(prod.nombre[s_] for s_ in P_.sku[P_.desp_idx <= 0.9])}).",
        f"• Adelantar compras: en {len(adel)} productos parte de lo que se vendió de más durante se perdió después "
        + "(" + ", ".join(f"{prod.nombre[a.sku]}: {mil(a.extra_dur)} u de más y {mil(-a.extra_desp)} de menos" for a in adel.itertuples()) + ").",
        f"• Neto en unidades: {(P_.neto_u > 0).sum()} de {len(P_)} descuentos dejaron unidades de más; en total {mil(P_.neto_u.sum())} u en 2 meses.",
        f"• Neto en margen: {(P_.neto_m > 0).sum()} de {len(P_)} dejaron más margen que seguir igual "
        f"({', '.join(prod.nombre[s_] for s_ in P_.sku[P_.neto_m > 0])}); en total, $ {mil(P_.neto_m.sum())}.",
    ]
    for t in lineas5:
        ws.cell(r, 1, t.replace("$ -", "−$ ")); r += 1
    r += 2

    # ---- conclusiones
    F = pd.DataFrame(filas)
    firmes = F[F.lo > 0]
    ws.cell(r, 1, "Qué muestran los datos").font = F_SEC
    r += 1
    lineas = [
        f"• {len(firmes)} de {len(F)} casos (producto en una sucursal) reaccionaron de forma firme al descuento: "
        + ", ".join(f"{prod.nombre[x.sku]} en {x.sid} ({signo(x.dur)})" for x in firmes.itertuples()) + ".",
        f"• En los otros {len(F) - len(firmes)} la variación entra en lo que cambia por azar: "
        + ", ".join(f"{prod.nombre[x.sku]} en {x.sid} ({signo(x.dur)})" for x in F[F.lo <= 0].itertuples()) + ".",
        f"• El mismo producto reaccionó distinto según la sucursal en {sum(F.groupby('sku').apply(lambda g: (g.lo > 0).any() and (g.lo <= 0).any()))} de {F.sku.nunique()} productos.",
        f"• Después del descuento, {(F.desp < -0.15).sum()} casos cayeron por debajo de su nivel de antes (adelantaron compras) y {(F.desp > 0.15).sum()} quedaron más altos.",
        f"• El margen por día subió en {(F.mdur >= 0).sum()} de {len(F)} casos: vender más no siempre compensó cobrar menos.",
        f"• Control (venden bien, sin ningún cambio): {signo(ctrl_dur)} durante las mismas fechas. "
        + ("Las semanas del descuento no fueron de temporada alta: la suba de los descontados no se explica por temporada." if ctrl_dur <= 0.05
           else "Esas semanas vendieron más en general: parte de la suba de los descontados puede ser temporada."),
    ]
    for t in lineas:
        ws.cell(r, 1, t); r += 1
    ws.freeze_panes = "B4"
    global RES_DESC                         # los mismos números, para el tablero (una sola fuente)
    RES_DESC = dict(desde=f"{D0:%Y-%m-%d}", hasta=f"{D1:%Y-%m-%d}", inicio=f"{INICIO:%Y-%m-%d}", foto=f"{FOTO:%Y-%m-%d}", dias=ndias,
                    casos=[{**{k: v for k, v in f.items() if k != "lec"}, "lectura": f["lec"], "producto": prod.nombre[f["sku"]], "tipo": prod.tipo[f["sku"]]} for f in filas],
                    control=ctrl_filas, ctrl_dur=ctrl_dur, semanas=[nombre_sem[k] for k in semanas], ctrl_idx=[c_idx[k] for k in semanas],
                    netos=[{**f, "producto": prod.nombre[f["sku"]], "tipo": prod.tipo[f["sku"]]} for f in persist], conclusiones=lineas + [t.replace("$ -", "−$ ") for t in lineas5])
    return ws


def hoja_resumen(wb, sucursales_):
    """Hoja que compara las sucursales entre sí."""
    ws = wb.create_sheet("Resumen", 0)
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 13
    ws.column_dimensions["C"].width = 9
    for j in range(len(DIAS)):
        ws.column_dimensions[get_column_letter(COL0 + j)].width = 5.6
    ws.freeze_panes = ws.cell(1, COL0)
    ws.cell(1, 1, "Resumen · las sucursales comparadas").font = F_TIT
    nota(ws, 2, f"Ventas del {INICIO:%d/%m/%Y} al {FOTO:%d/%m/%Y} y stock al {FOTO:%d/%m/%Y}. "
                f"{', '.join(s for s in suc.index if s not in sucursales_)} no tiene stock ni ventas en estos datos." if len(suc) > len(sucursales_) else "")
    r = 4

    # ---- 1 · tabla comparativa
    ws.cell(r, 1, "1 · Cada sucursal en números").font = F_SEC
    r += 1
    cols = [("sucursal", 1, 1, None), ("tipo", 2, 1, None), ("productos", 3, 1, "#,##0"), ("stock al inicio", COL0, 3, "#,##0"),
            ("vendidas", COL0 + 3, 3, "#,##0"), ("stock hoy", COL0 + 6, 3, "#,##0"), ("% vendido", COL0 + 9, 3, "0%"),
            ("% del stock de la cadena", COL0 + 12, 3, "0%"), ("% de las ventas de la cadena", COL0 + 15, 3, "0%"),
            ("% de lo esperado", COL0 + 18, 3, "0%"), ("productos sin ventas", COL0 + 21, 3, "#,##0"), ("productos que se frenaron", COL0 + 24, 3, "#,##0"),
            ("productos que siguen rotando", COL0 + 27, 3, "#,##0"), ("u en productos sin ventas", COL0 + 30, 3, "#,##0"),
            ("u con fecha límite vencida", COL0 + 33, 3, "#,##0"), ("venta en $", COL0 + 36, 4, "$ #,##0"),
            ("% de la venta en $ de la cadena", COL0 + 40, 3, "0%"), ("precio promedio cobrado por unidad", COL0 + 43, 3, "$ #,##0")]
    for t, col, ancho, _ in cols:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 else "center")
    ws.row_dimensions[r].height = 42
    head = r
    tot_stock, tot_vend, tot_pesos = lotes.unidades.sum(), lotes.vendidas.sum(), lotes.venta_pesos.sum()
    def fila_resumen(nombre, tipo, L, negrita=False):
        vals = [nombre, tipo, len(L), L.stock_inicial.sum(), L.vendidas.sum(), L.unidades.sum(), L.vendidas.sum() / L.stock_inicial.sum(),
                L.unidades.sum() / tot_stock, L.vendidas.sum() / tot_vend, L.ritmo_observado.sum() / L.ritmo_objetivo.sum(),
                (L.rotacion == ROTACION[0]).sum(), (L.rotacion == ROTACION[1]).sum(), (L.rotacion == ROTACION[2]).sum(),
                L.unidades[L.rotacion == ROTACION[0]].sum(), L.unidades[L.vencido == "sí"].sum(), L.venta_pesos.sum(),
                L.venta_pesos.sum() / tot_pesos, L.venta_pesos.sum() / L.vendidas.sum()]
        for (t, col, ancho, fmt), x in zip(cols, vals):
            celda(ws, r, col, x, ancho, fmt=fmt, font=Font(bold=negrita), fill=FILL_TOTAL if negrita else None,
                  alinear="left" if col <= 2 else "right")
    for sid in sucursales_:
        r += 1
        fila_resumen(f"{sid} · {suc.nombre[sid]}", suc.tipo[sid], lotes.xs(sid, level="sucursal_id"))
    fin = r
    r += 1
    fila_resumen("Total cadena (lotes)", "", lotes, negrita=True)
    cP, cV = get_column_letter(COL0 + 12), get_column_letter(COL0 + 15)
    ws.conditional_formatting.add(f"{get_column_letter(COL0 + 9)}{head + 1}:{get_column_letter(COL0 + 9)}{fin}",
                                  DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="2E7D4F"))
    r += 2

    # % del stock contra % de las ventas
    ch = BarChart()
    ch.type, ch.grouping, ch.title, ch.width, ch.height = "col", "clustered", "% del stock y % de las ventas de la cadena", 16, 7.5
    for col, color in [(COL0 + 12, "9AA0A6"), (COL0 + 15, "1D6A86")]:
        sr = Series(Reference(ws, min_col=col, min_row=head + 1, max_row=fin), title=str(ws.cell(head, col).value))
        sr.graphicalProperties.solidFill = color; sr.graphicalProperties.line.noFill = True
        ch.series.append(sr)
    ch.set_categories(Reference(ws, min_col=1, min_row=head + 1, max_row=fin))
    ch.y_axis.number_format = "0%"; ch.x_axis.delete = False; ch.y_axis.delete = False; ch.legend.position = "b"
    ch.dataLabels = DataLabelList(showVal=True, showCatName=False, showSerName=False, showLegendKey=False, showPercent=False); ch.dataLabels.numFmt = "0%"
    ws.add_chart(ch, f"A{r}")

    # Stock según si rotó, por sucursal (tabla chica al costado + barras apiladas)
    t0 = COL0 + 50
    celda(ws, head, t0, "stock hoy según si rotó", 1, font=F_HEAD)
    for k, cat in enumerate(ROTACION):
        celda(ws, head, t0 + 1 + 3 * k, cat, 3, fill=PatternFill("solid", fgColor=COLOR_ROT[cat]), font=F_HEAD, alinear="center")
    for i, sid in enumerate(sucursales_, start=1):
        L = lotes.xs(sid, level="sucursal_id")
        celda(ws, head + i, t0, sid, 1, alinear="left")
        for k, cat in enumerate(ROTACION):
            celda(ws, head + i, t0 + 1 + 3 * k, int(L.unidades[L.rotacion == cat].sum()), 3, fmt="#,##0")
    ch = BarChart()
    ch.type, ch.grouping, ch.overlap, ch.title, ch.width, ch.height = "col", "stacked", 100, "Stock hoy según si rotó (unidades)", 16, 7.5
    for k, color in enumerate(["C0392B", "C9A227", "2E7D4F"]):
        sr = Series(Reference(ws, min_col=t0 + 1 + 3 * k, min_row=head + 1, max_row=head + len(sucursales_)), title=ROTACION[k])
        sr.graphicalProperties.solidFill = color; sr.graphicalProperties.line.noFill = True
        ch.series.append(sr)
    ch.set_categories(Reference(ws, min_col=t0, min_row=head + 1, max_row=head + len(sucursales_)))
    ch.x_axis.delete = False; ch.y_axis.delete = False; ch.legend.position = "b"
    ws.add_chart(ch, f"{get_column_letter(COL0 + 14)}{r}")
    r += filas_alto(7.5) + 1

    # Lo que dicen los números
    por_s = {sid: lotes.xs(sid, level="sucursal_id") for sid in sucursales_}
    pe = {sid: L.ritmo_observado.sum() / L.ritmo_objetivo.sum() for sid, L in por_s.items()}
    gap = {sid: L.unidades.sum() / tot_stock - L.vendidas.sum() / tot_vend for sid, L in por_s.items()}
    peor, mejor = min(pe, key=pe.get), max(pe, key=pe.get)
    pesos = {sid: L.venta_pesos.sum() for sid, L in por_s.items()}
    top_p = max(pesos, key=pesos.get)
    precio_u = {sid: pesos[sid] / L.vendidas.sum() for sid, L in por_s.items()}
    sobra = max(gap, key=gap.get)
    lineas = [
        f"• La que mejor va contra su objetivo es {mejor} ({pe[mejor]:.0%} de lo esperado) y la que peor, {peor} ({pe[peor]:.0%}).",
        f"• {sobra} tiene el {por_s[sobra].unidades.sum() / tot_stock:.0%} del stock de la cadena pero hace el {por_s[sobra].vendidas.sum() / tot_vend:.0%} de las unidades vendidas: "
        "es la que más stock tiene para lo que vende.",
        f"• En pesos, la que más vende es {top_p}: $ {mil(pesos[top_p])}, el {pesos[top_p] / tot_pesos:.0%} de la cadena. "
        f"El precio promedio cobrado por unidad va de $ {mil(min(precio_u.values()))} ({min(precio_u, key=precio_u.get)}) "
        f"a $ {mil(max(precio_u.values()))} ({max(precio_u, key=precio_u.get)}): depende de qué productos vende cada una.",
        f"• En toda la cadena hay {mil(lotes.unidades[lotes.rotacion == ROTACION[0]].sum())} u en productos que no vendieron nada en su sucursal "
        f"y {mil(lotes.unidades[lotes.rotacion == ROTACION[1]].sum())} u en productos que se frenaron.",
    ]
    for t in lineas:
        ws.cell(r, 1, t); r += 1
    r += 2

    # ---- 2 · unidades contra pesos
    r = bloque_unidades_vs_pesos(ws, sucursales_, r)

    # ---- 3 · ventas por sucursal en el tiempo
    ws.cell(r, 1, "3 · Ventas de cada sucursal, día a día (unidades)").font = F_SEC
    r += 1
    encabezado_dias(ws, r, "sucursal", "", "total")
    for sid in sucursales_:
        r += 1; Vs = vd.xs(sid, level="sucursal_id").sum(); fila_dias(ws, r, sid, "", Vs.sum(), Vs)
    r += 1; fila_dias(ws, r, "Total cadena", "", vd.sum().sum(), vd.sum(), negrita=True)
    r += 2
    ws.cell(r, 1, "Promedio de los últimos 7 días (lo que muestra el gráfico)").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "sucursal", "", "")
    h2, ini = r, r + 1
    for sid in sucursales_:
        r += 1; fila_dias(ws, r, sid, "", None, vd.xs(sid, level="sucursal_id").sum().rolling(7).mean(), "0.0")
    COL_SUC = ["2A6F97", "C9A227", "2E7D4F", "B3402E", "7A4A9A", "5A6A74"]
    ch = grafico_lineas("Ventas por sucursal (unidades por día, promedio de 7 días)", ws, h2, ini, r, "unidades por día", COL_SUC)
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height) + 2

    # ---- 4 · ventas por sucursal en pesos
    ws.cell(r, 1, "4 · Ventas de cada sucursal en pesos, día a día (miles de $; el total, en $)").font = F_SEC
    r += 1
    nota(ws, r, "Unidades × precio cobrado ese día: incluye los descuentos aplicados. Las celdas de días muestran miles de $ (1.234 = $ 1.234.000).")
    r += 1
    ws.column_dimensions["C"].width = 15
    encabezado_dias(ws, r, "sucursal", "", "total $")
    hpt, ini = r, r + 1
    for sid in sucursales_:
        r += 1; Ps = vdp.xs(sid, level="sucursal_id").sum(); fila_dias(ws, r, sid, "", Ps.sum(), Ps, "#,##0,", formato_total="$ #,##0")
    fin_p = r
    r += 1; fila_dias(ws, r, "Total cadena", "", vdp.sum().sum(), vdp.sum(), "#,##0,", negrita=True, formato_total="$ #,##0")
    r += 2
    ws.cell(r, 1, "Promedio de los últimos 7 días, en miles de $ (lo que muestra el gráfico)").font = F_HEAD
    r += 1
    encabezado_dias(ws, r, "sucursal", "", "")
    hp, ini2 = r, r + 1
    for sid in sucursales_:
        r += 1; fila_dias(ws, r, sid, "", None, vdp.xs(sid, level="sucursal_id").sum().rolling(7).mean() / 1000, "#,##0")
    ch = grafico_lineas("Ventas por sucursal en pesos (miles de $ por día, promedio de 7 días)", ws, hp, ini2, r, "miles de $ por día", COL_SUC)
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height) + 1
    ch, alto = grafico_barras(f"Venta total por sucursal en pesos ({INICIO:%d/%m} al {FOTO:%d/%m})", ws, 3, ini, fin_p, "$", "1D6A86", "$ #,##0")
    ch.width = 18
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(alto) + 2

    # ---- 5 · stock por sucursal en el tiempo
    ws.cell(r, 1, "5 · Stock de cada sucursal, día a día (unidades)").font = F_SEC
    r += 1
    nota(ws, r, f"Reconstruido hacia atrás desde la foto del {FOTO:%d/%m/%Y}; supone que no hubo reposiciones ni transferencias (no están en los datos).")
    r += 1
    encabezado_dias(ws, r, "sucursal", "", "hoy")
    h3, ini = r, r + 1
    for sid in sucursales_:
        Ss = stock_dia.xs(sid, level="sucursal_id").fillna(0).sum()
        r += 1; fila_dias(ws, r, sid, "", Ss.iloc[-1], Ss)
    fin = r
    r += 1; St = stock_dia.fillna(0).sum(); fila_dias(ws, r, "Total cadena", "", St.iloc[-1], St, negrita=True)
    ch = grafico_lineas("Stock por sucursal, día a día (unidades)", ws, h3, ini, fin, "unidades en stock", COL_SUC)
    r += 2
    ws.add_chart(ch, f"A{r}")
    r += filas_alto(ch.height) + 2

    # ---- 4 · dónde vende cada producto
    for titulo, campo, fmt in [("6 · Dónde vende cada producto: unidades vendidas en cada sucursal", "vendidas", "#,##0"),
                               ("7 · Dónde está el stock de cada producto: unidades hoy en cada sucursal", "unidades", "#,##0")]:
        ws.cell(r, 1, titulo).font = F_SEC
        r += 1
        nota(ws, r, "Color = cómo rotó ese producto en esa sucursal: rojo sin ventas, amarillo se frenó, verde sigue rotando. Vacío = el producto no está en esa sucursal.")
        r += 1
        celda(ws, r, 1, "producto", fill=FILL_HEAD, font=F_HEAD, alinear="left")
        celda(ws, r, 2, "rubro", fill=FILL_HEAD, font=F_HEAD, alinear="left")
        celda(ws, r, 3, "total", fill=FILL_HEAD, font=F_HEAD, alinear="center")
        for k, sid in enumerate(sucursales_):
            celda(ws, r, COL0 + 3 * k, sid, 3, fill=FILL_HEAD, font=F_HEAD, alinear="center")
        celda(ws, r, COL0 + 3 * len(sucursales_) + 1, "¿tuvo descuento?", 12, fill=FILL_HEAD, font=F_HEAD, alinear="left")
        tabla = lotes[campo].unstack("sucursal_id").reindex(columns=sucursales_)
        rot = lotes.rotacion.unstack("sucursal_id").reindex(columns=sucursales_)
        for sku in tabla.sum(axis=1).sort_values(ascending=False).index:
            r += 1
            celda(ws, r, 1, prod.nombre[sku], alinear="left"); celda(ws, r, 2, prod.rubro[sku], alinear="left")
            celda(ws, r, 3, int(tabla.loc[sku].sum()), fmt=fmt, font=Font(bold=True))
            for k, sid in enumerate(sucursales_):
                x = tabla.loc[sku, sid]
                if pd.notna(x):
                    celda(ws, r, COL0 + 3 * k, int(x), 3, fmt=fmt, fill=PatternFill("solid", fgColor=COLOR_ROT[rot.loc[sku, sid]]))
            dcat = _d.descuento[sku]
            celda(ws, r, COL0 + 3 * len(sucursales_) + 1, dcat, 12, alinear="left", fill=PatternFill("solid", fgColor=COLOR_DESC[dcat]))
        r += 3

    # ---- 8 · descuentos
    ws.cell(r, 1, "8 · ¿Tuvieron descuento? Productos de la cadena según su historial de descuentos y cómo rotaron").font = F_SEC
    r += 1
    nota(ws, r, "Cada producto se cuenta una vez por sucursal donde está (lotes). Solo los descuentos aplicados se ven en el precio de venta y se pueden medir.")
    r += 1
    cols_d = [("descuento", 1, 2, None), ("productos", 3, 1, "0"), ("lotes", COL0, 3, "0"), ("stock hoy", COL0 + 3, 3, "#,##0"),
              ("stock a costo", COL0 + 6, 4, "$ #,##0"), ("vendidas", COL0 + 10, 3, "#,##0"), ("lotes sin ventas", COL0 + 13, 3, "0"),
              ("lotes que se frenaron", COL0 + 16, 3, "0"), ("lotes que siguen rotando", COL0 + 19, 3, "0"), ("productos y detalle", COL0 + 22, 50, None)]
    for t, col, ancho, _ in cols_d:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 or t.startswith("productos y") else "center")
    ws.row_dimensions[r].height = 30
    for cat in DESCUENTO:
        g = lotes[lotes.descuento == cat]
        if not len(g):
            continue
        r += 1
        prods = _d[_d.descuento == cat]
        lista = "; ".join(f"{prod.nombre[s_]} ({prods.descuento_detalle[s_]})" if prods.descuento_detalle[s_] != "—" else prod.nombre[s_] for s_ in prods.index)
        vals = [cat, len(prods), len(g), g.unidades.sum(), g.stock_costo.sum(), g.vendidas.sum()] + [(g.rotacion == x).sum() for x in ROTACION] + [lista]
        for (t, col, ancho, fmt), x in zip(cols_d, vals):
            celda(ws, r, col, x, ancho, fmt=fmt, alinear="left" if col <= 2 or t.startswith("productos y") else "right",
                  fill=PatternFill("solid", fgColor=COLOR_DESC[cat]) if col == 1 else None)
        ws.row_dimensions[r].height = 15 * max(1, -(-len(lista) // 260))
    r += 2
    ap = lotes[lotes.descuento == DESCUENTO[0]]
    rep = lotes[(lotes.descuento == DESCUENTO[2]) & (lotes.rotacion != ROTACION[2])]
    for t in [f"• Con descuento aplicado: {ap.index.get_level_values('sku').nunique()} productos, todos siguen rotando "
              f"({(ap.rotacion == ROTACION[2]).sum()} de {len(ap)} lotes). En sus sucursales vendieron {dec(ap.u_dia_con_descuento.sum())} u/día con descuento "
              f"contra {dec(ap.u_dia_sin_descuento.sum())} sin descuento "
              + f"({ap.u_dia_con_descuento.sum() / ap.u_dia_sin_descuento.sum() - 1:+.0%}). Son los que mejor venden, así que esto no dice cómo respondería un producto lento.",
              f"• Con descuento aceptado sin fechas: {lotes[lotes.descuento == DESCUENTO[2]].index.get_level_values('sku').nunique()} productos; "
              f"{len(rep)} de sus {(lotes.descuento == DESCUENTO[2]).sum()} lotes no venden o se frenaron. El descuento ya se intentó y no alcanzó.",
              f"• Sin descuento ni campaña: {lotes[lotes.descuento == DESCUENTO[4]].index.get_level_values('sku').nunique()} productos, "
              f"{(lotes[lotes.descuento == DESCUENTO[4]].rotacion == ROTACION[0]).sum()} lotes sin ninguna venta."]:
        ws.cell(r, 1, t); r += 1
    r += 2
    r = bloque_compartidos(ws, sucursales_, r)
    return ws


def estado_lote(f):
    """Cómo le va a un producto en una sucursal, en pocas palabras."""
    if f.rotacion == ROTACION[0]:
        return "sin ventas"
    if f.rotacion == ROTACION[1]:
        return "se frenó"
    return "al día" if f.pct_esperado >= 0.9 else "lento"


COLOR_ESTADO = {"sin ventas": "F2C4BC", "se frenó": "F5E2A8", "lento": "FBEFD9", "al día": "CDE8D6"}


def lectura_producto(estados, pct_vendido):
    """estados y pct_vendido: {sucursal: valor}. Dice si lo que pasa es del producto o del local.
    Es del local si en una sucursal va al día y en otra no, o si en una no vende nada y en otra vendió al menos el 20 % de su stock."""
    valores = set(estados.values())
    donde = lambda cond: ", ".join(s for s in estados if cond(s))
    if valores == {"al día"}:
        return "Vende bien en todas"
    if "al día" in valores:
        return f"Al día en {donde(lambda s: estados[s] == 'al día')}, no en {donde(lambda s: estados[s] != 'al día')}: es el local"
    sin = [s for s in estados if estados[s] == "sin ventas"]
    buenas = [s for s in estados if estados[s] != "sin ventas" and pct_vendido[s] >= 0.2]
    if sin and buenas:
        return (f"No vende en {', '.join(sin)}; en {', '.join(buenas)} vendió el "
                f"{' y '.join(f'{pct_vendido[s]:.0%}' for s in buenas)} de su stock: es el local")
    if valores == {"sin ventas"}:
        return "No vende en ninguna: es el producto"
    return "Le va mal en todas" + (f" (en {', '.join(sin)} ni vende)" if sin else "") + ": es el producto"


def bloque_compartidos(ws, sucursales_, r):
    """9 · Qué productos comparten las sucursales y cómo le va al mismo producto en cada una."""
    ws.cell(r, 1, "9 · Productos compartidos: el mismo producto en distintas sucursales").font = F_SEC
    r += 1
    nota(ws, r, "Ningún producto está en todas las sucursales: cada uno está en 2 o 3. Comparar el mismo producto entre locales separa lo que es del producto "
                "(le va igual en todos) de lo que es del local (vende en uno y en otro no).")
    r += 2
    presencia = lotes.reset_index().pivot_table(index="sku", columns="sucursal_id", values="unidades", aggfunc="size", fill_value=0).reindex(columns=sucursales_, fill_value=0) > 0

    # Matriz de productos en común
    ws.cell(r, 1, "Productos en común entre cada par de sucursales (en la diagonal: los productos de cada una)").font = F_HEAD
    r += 1
    celda(ws, r, 1, "", fill=FILL_HEAD)
    for k, b in enumerate(sucursales_):
        celda(ws, r, COL0 + 3 * k, b, 3, fill=FILL_HEAD, font=F_HEAD, alinear="center")
    ini = r + 1
    for a in sucursales_:
        r += 1
        celda(ws, r, 1, f"{a} · {suc.nombre[a]}", alinear="left", font=Font(bold=True))
        for k, b in enumerate(sucursales_):
            celda(ws, r, COL0 + 3 * k, int((presencia[a] & presencia[b]).sum()), 3, fmt="0",
                  font=Font(bold=a == b, color="888888" if a == b else "000000"), alinear="center")
    ws.conditional_formatting.add(f"{get_column_letter(COL0)}{ini}:{get_column_letter(COL0 + 3 * len(sucursales_) - 1)}{r}",
                                  ColorScaleRule(start_type="num", start_value=0, start_color="FFFFFF", end_type="max", end_color="7FB3C9"))
    r += 1
    nvec = presencia.sum(axis=1)
    nota(ws, r, f"{(nvec == 2).sum()} productos están en 2 sucursales y {(nvec == 3).sum()} en 3. Ninguno está en todas.")
    r += 3

    # El mismo producto en cada sucursal
    ws.cell(r, 1, "El mismo producto en cada una de sus sucursales (agrupado por combinación de sucursales)").font = F_HEAD
    r += 1
    nota(ws, r, "Estado en cada local: al día (vende el 90 % o más de lo esperado), lento (vende menos), se frenó (nada en los últimos 30 días), sin ventas (nada en 90 días).")
    r += 1
    celda(ws, r, 1, "producto", fill=FILL_HEAD, font=F_HEAD, alinear="left")
    celda(ws, r, 2, "rubro", fill=FILL_HEAD, font=F_HEAD, alinear="left")
    celda(ws, r, 3, "sucursales", fill=FILL_HEAD, font=F_HEAD, alinear="left")
    SLOT = 13
    for k in range(3):
        base = COL0 + SLOT * k
        for t, off, ancho in [(f"sucursal {k + 1}", 0, 2), ("vendidas", 2, 2), ("stock hoy", 4, 2), ("% vendido", 6, 2), ("estado", 8, 5)]:
            celda(ws, r, base + off, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="center")
    col_lec = COL0 + SLOT * 3
    celda(ws, r, col_lec, "lectura", 22, fill=FILL_HEAD, font=F_HEAD, alinear="left")
    ws.row_dimensions[r].height = 30
    combo = presencia.apply(lambda f: "+".join(s for s in sucursales_ if f[s]), axis=1)
    orden_combo = combo.value_counts().index
    lecturas = {}
    for c in orden_combo:
        for sku in sorted(combo.index[combo == c], key=lambda x: -lotes.xs(x, level="sku").unidades.sum()):
            r += 1
            L = lotes.xs(sku, level="sku").reindex([s for s in sucursales_ if presencia.loc[sku, s]])
            estados = {s: estado_lote(f) for s, f in L.iterrows()}
            lec = lectura_producto(estados, L.pct_vendido.to_dict())
            lecturas[sku] = lec
            celda(ws, r, 1, prod.nombre[sku], alinear="left"); celda(ws, r, 2, prod.rubro[sku], alinear="left"); celda(ws, r, 3, c, alinear="left")
            for k, (sid, f) in enumerate(L.iterrows()):
                base = COL0 + SLOT * k
                celda(ws, r, base, sid, 2, alinear="center", font=Font(bold=True))
                celda(ws, r, base + 2, f.vendidas, 2, fmt="#,##0")
                celda(ws, r, base + 4, f.unidades, 2, fmt="#,##0")
                celda(ws, r, base + 6, f.pct_vendido, 2, fmt="0%")
                celda(ws, r, base + 8, estados[sid], 5, alinear="center", fill=PatternFill("solid", fgColor=COLOR_ESTADO[estados[sid]]))
            tipo = "producto" if lec.endswith("es el producto") or lec.startswith(("Se frenó en todas", "Vende bien")) else "local" if lec.endswith("es el local") else "otro"
            celda(ws, r, col_lec, lec, 22, alinear="left",
                  fill=PatternFill("solid", fgColor={"producto": "E6D3EE", "local": "CFE0EE", "otro": "FFFFFF"}[tipo]))
    r += 2

    # Lo que dice la comparación
    lec = pd.Series(lecturas)
    tipo = lec.map(lambda x: "Vende bien en todas" if x.startswith("Vende bien") else "Es el producto (le va mal en todas)" if x.endswith("es el producto") or x.startswith("Se frenó en todas")
                   else "Es el local (vende en una y en otra no)" if x.endswith("es el local") else "Mixto")
    stock_p = lotes.groupby(level="sku").unidades.sum()
    ws.cell(r, 1, "Resumen de la comparación").font = F_HEAD
    r += 1
    for t, col, ancho in [("lectura", 1, 2), ("productos", 3, 1), ("stock hoy", COL0, 3), ("cuáles", COL0 + 3, 50)]:
        celda(ws, r, col, t, ancho, fill=FILL_HEAD, font=F_HEAD, alinear="left" if col <= 2 or t == "cuáles" else "center")
    for t_ in ["Vende bien en todas", "Es el producto (le va mal en todas)", "Es el local (vende en una y en otra no)", "Mixto"]:
        idx = tipo.index[tipo == t_]
        if not len(idx):
            continue
        r += 1
        lista = ", ".join(prod.nombre[i] for i in sorted(idx, key=lambda i: -stock_p[i]))
        celda(ws, r, 1, t_, 2, alinear="left", font=Font(bold=True))
        celda(ws, r, 3, len(idx)); celda(ws, r, COL0, int(stock_p[idx].sum()), 3, fmt="#,##0")
        celda(ws, r, COL0 + 3, lista, 50, alinear="left")
        ws.row_dimensions[r].height = 15 * max(1, -(-len(lista) // 260))
    r += 2
    loc = tipo.index[tipo == "Es el local (vende en una y en otra no)"]
    ws.cell(r, 1, f"• En {len(loc)} productos el problema es del local: venden en una sucursal y en otra no o van mucho peor. "
                  "Ahí la primera acción es mover el stock o revisar la exhibición, no tocar el precio.")
    r += 1
    prodm = tipo.index[tipo == "Es el producto (le va mal en todas)"]
    ws.cell(r, 1, f"• En {len(prodm)} productos le va mal en todas sus sucursales ({mil(stock_p[prodm].sum())} u): el problema es del producto. "
                  "Antes de decidir el precio hay que ver por qué: si se cortó, si nunca se exhibió, si ya se descontó o si no tiene margen (hojas de cada sucursal).")
    return r + 2


def hoja_como_se_calcula(wb):
    ws = wb.create_sheet("Cómo se calcula")
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 120
    ws.cell(1, 1, "Cómo se calcula cada número").font = F_TIT
    filas = [
        ("Fuente", f"{DATOS} (hojas ventas, stock_sucursal, productos, sucursales). Ventas del {INICIO:%d/%m/%Y} al {FOTO:%d/%m/%Y} ({len(DIAS)} días)."),
        ("Ventas por día", "Unidades vendidas cada día. La hoja ventas solo trae los días con venta: los demás días se completan con 0."),
        ("Stock a costo", "Unidades en stock × costo_unitario del catálogo. Es la plata ya puesta en ese stock. A precio de lista: unidades × precio_lista."),
        ("¿Tuvo descuento?", "Según historial_sugerencias y campanas_activas: descuento aplicado (aceptado y con fechas: se ve en el precio de venta), "
                             "campaña cargada, descuento aceptado sin fechas (no se ve en las ventas), sugerencia rechazada o sin respuesta, o nada."),
        ("u/día con y sin descuento", "Solo para descuentos aplicados: unidades por día en esa sucursal durante las fechas del descuento contra el resto de la ventana."),
        ("Venta en pesos", "Unidades × precio_unitario de cada venta (el precio cobrado ese día, con los descuentos aplicados). En las tablas diarias se muestra en miles de $."),
        ("Promedio de 7 días", "Promedio de las ventas del día y los 6 anteriores. Los primeros 6 días quedan vacíos."),
        ("Stock por día", "Stock al cierre del día = stock de la foto del 15/03 + lo vendido después de ese día. Vacío antes de la fecha de ingreso del lote. "
                          "Supone que no hubo reposiciones, transferencias ni devoluciones, porque los datos no los registran."),
        ("Stock al inicio", "Stock hoy + vendidas desde el 16/12/2025, o desde la fecha de ingreso si el lote llegó después."),
        ("% vendido", "Vendidas ÷ stock al inicio. Cuánto de lo que había ya se vendió."),
        ("Días de stock", "Stock hoy ÷ (vendidas en los últimos 30 días ÷ 30). Cuántos días dura el stock al ritmo del último mes."),
        ("Ritmo objetivo", "unidades_objetivo ÷ días entre fecha_ingreso y fecha_limite (consigna)."),
        ("Ritmo real", "Vendidas desde fecha_ingreso, o desde el 16/12/2025 si el lote es anterior, ÷ esos días (consigna)."),
        ("% de lo esperado", "Ritmo real ÷ ritmo objetivo. 90 % o más: el lote viene al día."),
    ]
    for i, (a, b) in enumerate(filas, start=3):
        ws.cell(i, 1, a).font = Font(bold=True)
        c = ws.cell(i, 2, b); c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = 30


def hoja_lotes(wb):
    ws = wb.create_sheet("Datos por lote")
    t = lotes.reset_index()[["sucursal_id", "sku", "producto", "rubro", "fecha_ingreso", "fecha_limite", "unidades_objetivo", "stock_inicial",
                             "vendidas", "venta_pesos", "unidades", "pct_vendido", "venta_ultimos_30", "dias_de_stock", "ritmo_objetivo", "ritmo_observado",
                             "pct_esperado", "vencido", "rotacion", "descuento", "descuento_detalle", "u_dia_con_descuento",
                             "u_dia_sin_descuento", "variacion_con_descuento"]].rename(columns={"unidades": "stock_hoy", "ritmo_observado": "ritmo_real"})
    for j, c in enumerate(t.columns, start=1):
        x = ws.cell(1, j, c); x.font = F_HEAD; x.fill = FILL_HEAD
        ws.column_dimensions[get_column_letter(j)].width = 30 if c == "producto" else 13
    for i, row in enumerate(t.itertuples(index=False), start=2):
        for j, x in enumerate(row, start=1):
            if isinstance(x, pd.Timestamp):
                ws.cell(i, j, x.to_pydatetime()).number_format = "dd/mm/yyyy"
            elif isinstance(x, float) and np.isnan(x):
                continue
            else:
                ws.cell(i, j, x.item() if hasattr(x, "item") else x)
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = ws.dimensions


# ---------------------------------------------------------------------------------------------- armado
def pct(x, d=0):
    return f"{x * 100:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".") + " %"


# ---------------------------------------------------------------------------------------------- propuesta
# La decisión de precio para cada producto. Reglas en dos pasos:
#   1) Qué le pasa al producto (9 grupos, la primera regla que se cumple).
#   2) Si su grupo admite descuento, los criterios: dos obligatorios (su tipo responde al descuento y queda al menos el
#      margen mínimo) y dos más (no es ya el más barato de su tipo, y en su tipo la venta no cayó después del descuento;
#      este último no se mira si la mayor parte del stock ya venció). Tipo firme: con todo -> bajar, falla uno -> probar.
#      Tipo débil: solo probar, y solo si cumple todo. Con el stock mayormente vencido, como mucho probar.
#   3) Stock vencido: cada producto mantiene su diagnóstico, pero si la primera acción no cumple, una escalera con fechas
#      (20 % dos semanas, 35 % dos semanas, después devolución u outlet), siempre con piso en el costo.
REGLAS = dict(
    al_dia=0.90,                # vende el 90 % o más de lo esperado (ritmo del lote, sumando sus sucursales)
    meses_reponer=3,            # al día y con stock para menos de 3 meses -> vende bien y hay que reponer
    dias_en_curso=30,           # campaña vigente, cambio de precio o sugerencia de los últimos 30 días
    corte_u_dia=0.5,            # se cortó: vendía al menos 0,5 u/día ...
    corte_ratio=0.25,           # ... y el último mes, menos de un cuarto de eso
    mal_ubicado=0.5,            # más de la mitad del stock en sucursales sin ninguna venta
    aceptados_repetidos=3,      # 3 o más descuentos aceptados antes
    margen_minimo=0.15,         # margen que tiene que quedar después de un descuento
    despues_minimo=0.90,        # en su tipo, la venta después del descuento no cayó más de 10 % (corregido por temporada)
    stock_minimo=10,            # con menos unidades no se toca el precio
    destino_max_meses=7,        # solo se mueve stock a una sucursal que tenga menos de 7 meses de stock
    respuesta_debil=1.20,       # evidencia débil: su tipo no es firme pero vendió +20 % o más y la venta se sostuvo después -> como mucho, probar
    vencido_mayoria=0.5,        # más de la mitad del stock ya pasó su fecha límite -> no se mira "después" y como mucho se prueba
    escalera=(0.20, 0.35),      # escalones de liquidación del stock vencido (el primero es la profundidad con más evidencia)
    escalon_dias=14,            # cuánto dura cada escalón
    escalon_duplicar=2.0,       # se pasa al escalón siguiente si la venta no llegó a duplicarse
)
GRUPOS = {1: "1 · Vende bien", 2: "2 · Recién llegado, al día", 3: "3 · Algo en curso", 4: "4 · Nunca vendió", 5: "5 · Se cortó",
          6: "6 · Mal ubicado", 7: "7 · Descuentos aceptados varias veces", 8: "8 · Margen bajo", 9: "9 · Lento parejo"}
# Los 9 grupos se cuentan en 5 causas: por qué no se vende y qué herramienta lo resuelve. Solo la última es de precio.
CAUSAS = {"ok": dict(nombre="No es un problema", grupos=[1, 2], problema="Vende bien o recién llegó",
                     solucion="Dejar el precio; reponer, mover stock entre sucursales y medir cuánto sobraría", precio="No por ahora"),
          "ejecucion": dict(nombre="Ejecución", grupos=[3, 7], problema="Campañas o descuentos aprobados que no llegaron a caja, o un cambio en curso",
                            solucion="Que lo aprobado se cobre en caja, con fechas, y medirlo antes de proponer otro precio", precio="Lo ya aprobado"),
          "producto": dict(nombre="Producto o ubicación", grupos=[4, 5, 6], problema="Nunca vendió, se cortó o está en el local equivocado",
                           solucion="Contar el stock, exhibir, mover a donde vende o investigar en el local", precio="No"),
          "compra": dict(nombre="Compra", grupos=[8], problema="Se compró tan caro que no hay margen para descontar",
                         solucion="Negociar devolución o bonificación con el proveedor; outlet al costo si no hay acuerdo", precio="No"),
          "precio": dict(nombre="Puede ser precio", grupos=[9], problema="Vende poco pero parejo, sin otra explicación",
                         solucion="Descuento a prueba solo si su tipo respondió y queda margen", precio="Sí, a prueba")}
CAUSA_DE = {g: k for k, c in CAUSAS.items() for g in c["grupos"]}
FECHA = lambda dias_: (FOTO + pd.Timedelta(days=dias_)).strftime("%d/%m/%Y")


def evidencia_por_tipo():
    """Respuesta al descuento de cada tipo, medida en su producto descontado (la cuenta de la consigna)."""
    ap = hist.dropna(subset=["fecha_vigencia_desde"])
    D0, D1 = ap.fecha_vigencia_desde.min(), ap.fecha_vigencia_hasta.max()
    rng = np.random.default_rng(0)
    vp = vd.groupby(level="sku").sum()
    desde = lotes.reset_index().groupby("sku").cuenta_desde.min()
    tocados = set(hist.sku) | set(camp.sku) | set(h["cambios_precio"].sku)
    ctrl = [i for i in lotes.index if i[0] not in tocados and lotes.pct_esperado[i] >= REGLAS["al_dia"] and lotes.fecha_ingreso[i] <= INICIO]
    uc = vd.loc[ctrl].sum().values
    ctrl_despues = uc[np.asarray(DIAS > D1)].mean() / uc[np.asarray(DIAS < D0)].mean()
    filas = {}
    # ¿el producto descontado era lento? Si en un tipo hay descuentos medidos en productos lentos, se prefieren esos:
    # la respuesta de un producto que vende bien no tiene por qué ser la de uno que no vende.
    g_ = lotes.groupby(level="sku")
    lento = (g_.ritmo_observado.sum() / g_.ritmo_objetivo.sum()) < REGLAS["al_dia"]
    ap = ap.assign(lento=ap.sku.map(lento).fillna(False))
    candidatos = {}
    for x in ap.itertuples():                               # mismo orden de siempre: los rangos por azar no cambian
        u = vp.loc[x.sku].values
        esta = np.asarray(DIAS >= desde[x.sku])
        con = np.asarray((DIAS >= x.fecha_vigencia_desde) & (DIAS <= x.fecha_vigencia_hasta))
        a, b = u[con], u[~con & esta]
        sim = [rng.choice(a, len(a)).mean() / rng.choice(b, len(b)).mean() for _ in range(4000)]
        antes, despues = u[np.asarray(DIAS < D0) & esta].mean(), u[np.asarray(DIAS > D1)].mean()
        candidatos.setdefault(prod.tipo[x.sku], []).append((bool(x.lento), x.fecha_vigencia_desde, x.Index))
        filas[(prod.tipo[x.sku], x.Index)] = dict(referencia=prod.nombre[x.sku], lento=bool(x.lento), descuento=x.descuento_pct / 100, respuesta=a.mean() / b.mean(),
                                       rango_bajo=np.percentile(sim, 5), rango_alto=np.percentile(sim, 95), firme=np.percentile(sim, 5) > 1,
                                       despues=despues / antes / ctrl_despues)
    # de cada tipo, el medido en un producto lento si lo hay; si no, el más reciente
    elegidos = {t: max(c, key=lambda k: (k[0], k[1]))[2] for t, c in candidatos.items()}
    filas = {t: filas[(t, i)] for t, i in elegidos.items()}
    return pd.DataFrame(filas).T


def escenarios(tipo, d, v30, stock, precio, costo):
    """Qué se puede esperar de un descuento, medido en lo que pasó antes con el mismo descuento (hoja Descuentos).

    Medida: los casos del mismo tipo y el mismo %; si no hay, los del mismo % en cualquier tipo.
    Cada caso (un producto en una sucursal) aporta cuánto cambió la venta durante y el mes siguiente, contra antes,
    corregido por lo que hizo el control esas mismas semanas (temporada).
    Escenarios: la peor sucursal, todas juntas y la mejor. Horizonte: 4 semanas con descuento + el mes siguiente sin él,
    contra seguir 2 meses sin tocar el precio. Nunca se vende más que el stock.
    """
    casos = [c for c in RES_DESC["casos"] if abs(c["d"] - d) < 1e-9]
    mismos = [c for c in casos if c["tipo"] == tipo]
    medida = "mismo tipo y mismo %" if mismos else "mismo %, otro tipo"
    mismos = mismos or casos
    if not mismos:
        return None
    k = RES_DESC["control"][-1]                                  # total del control
    corr = lambda dur, desp: ((1 + dur) / (1 + k["dur"]) - 1, (1 + desp) / (1 + k["desp"]) - 1)
    juntos = {f"u_{p}": sum(c[f"u_{p}"] for c in mismos) for p in ("antes", "durante", "después")}
    filas = [("Peor sucursal", min(mismos, key=lambda c: c["dur"])),
             ("Todas juntas", dict(producto=", ".join(sorted({c["producto"] for c in mismos})), sid="todas",
                                   dur=juntos["u_durante"] / juntos["u_antes"] - 1, desp=juntos["u_después"] / juntos["u_antes"] - 1)),
             ("Mejor sucursal", max(mismos, key=lambda c: c["dur"]))]
    m_lista, m_desc = precio - costo, precio * (1 - d) - costo
    sin = 2 * v30 * m_lista
    out = []
    for nombre, c in filas:
        dur, desp = corr(c["dur"], c["desp"])
        u_dur = max(0.0, min(v30 * (1 + dur), stock))
        u_desp = max(0.0, min(v30 * (1 + desp), stock - u_dur))
        margen = u_dur * m_desc + u_desp * m_lista
        out.append(dict(escenario=nombre, medido_en=f"{c['producto']} · {c['sid']}", dur=dur, desp=desp, u_dur=u_dur, u_desp=u_desp,
                        margen=margen, dif=margen - sin, dif_30=u_dur * m_desc - v30 * m_lista))   # dif_30: solo las 4 semanas con descuento
    return dict(medida=medida, casos=len(mismos), d=d, v30=v30, sin=sin, u_sin=2 * v30, m_lista=m_lista, m_desc=m_desc,
                equilibrio=m_lista / m_desc - 1 if m_desc > 0 else None, ctrl_dur=k["dur"], ctrl_desp=k["desp"], escenarios=out)


def escenarios_de(D):
    """Los escenarios de cada producto con descuento ahora, por sku."""
    return {s: escenarios(f.tipo, float(f.descuento) / 100, f.v30, f.stock, f.precio, f.costo) for s, f in D[D.nuestro_descuento == "ya"].iterrows()}


def meta_esc(f, dpct, u_sem):
    """La meta de un descuento sale de sus escenarios: lo esperado (todas las sucursales juntas) y el piso (la peor)."""
    e = escenarios(f.tipo, float(dpct) / 100, f.v30, f.stock, f.precio, f.costo)
    if e is None:
        return f"más de {dec(u_sem)} (no hay un descuento igual medido)"
    peor, todas = e["escenarios"][0], e["escenarios"][1]
    return (f"{dec(u_sem * (1 + todas['dur']))} u/sem durante (como {todas['medido_en'].split(' · ')[0]} al {dpct} %); "
            f"menos de {dec(u_sem * max(1 + peor['dur'], 1))} es que no funcionó")


# Ventas con rebaja: precio cobrado debajo del precio de lista vigente ese día (antes de una suba, vale el anterior).
# Es la forma de saber si un descuento o una campaña llegó a caja.
_vr = ventas.assign(lista=ventas.sku.map(prod.precio_lista))
for _c in h["cambios_precio"].assign(fecha=pd.to_datetime(h["cambios_precio"].fecha)).sort_values("fecha", ascending=False).itertuples():
    _vr.loc[(_vr.sku == _c.sku) & (_vr.fecha < _c.fecha), "lista"] = _c.precio_anterior
_vr["rebaja"] = _vr.precio_unitario < _vr.lista - 0.5


def con_rebaja(s, desde=None, hasta=None):
    """(unidades vendidas con rebaja, unidades vendidas) de un producto entre dos fechas."""
    v = _vr[(_vr.sku == s) & (_vr.fecha >= (desde if desde is not None else INICIO)) & (_vr.fecha <= (hasta if hasta is not None else FOTO))]
    return int(v.unidades[v.rebaja].sum()), int(v.unidades.sum())


def armar_propuesta():
    ev = evidencia_por_tipo()
    reciente = FOTO - pd.Timedelta(days=REGLAS["dias_en_curso"])
    cambios = h["cambios_precio"].copy(); cambios["fecha"] = pd.to_datetime(cambios.fecha)
    cons = h["propuesta_consultora"].set_index("sku")
    g = lotes.groupby(level="sku")
    P = pd.DataFrame({"producto": prod.nombre, "tipo": prod.tipo, "proveedor": prod.proveedor, "precio": prod.precio_lista,
                      "costo": prod.costo_unitario})
    P["margen"] = 1 - P.costo / P.precio
    P["sucursales"] = g.apply(lambda d: ", ".join(f"{s} ({int(u)})" for (_, s), u in d.unidades.items()))
    P["stock"] = g.unidades.sum()
    P["vendidas"] = g.vendidas.sum()
    P["v30"] = g.venta_ultimos_30.sum()
    P["v_antes_mes"] = vd.groupby(level="sku").sum().iloc[:, :-30].mean(axis=1) * 30
    P["pct_esperado"] = g.ritmo_observado.sum() / g.ritmo_objetivo.sum()
    P["meses"] = P.stock / P.v30.replace(0, np.nan)
    P["share_sin_venta"] = lotes.unidades.where(lotes.vendidas == 0, 0).groupby(level="sku").sum() / P.stock
    P["u_vencidas"] = lotes.unidades.where(lotes.vencido == "sí", 0).groupby(level="sku").sum()
    P["share_vencido"] = P.u_vencidas / P.stock
    P["rank_tipo"] = P.groupby("tipo").precio.rank(method="min").astype(int)
    P["n_tipo"] = P.groupby("tipo").precio.transform("size")
    aceptadas = hist[(hist.aceptacion == 1) & (hist.fecha_sugerencia <= reciente)]
    P["aceptados_antes"] = aceptadas.groupby("sku").size().reindex(P.index).fillna(0).astype(int)
    P["aceptados_sin_aplicar"] = aceptadas[aceptadas.fecha_vigencia_desde.isna()].groupby("sku").size().reindex(P.index).fillna(0).astype(int)

    camp_v = camp[(camp.fecha_desde <= FOTO) & (camp.fecha_hasta >= FOTO)].set_index("sku")
    cambio_r = cambios[cambios.fecha > reciente].set_index("sku")
    sug_r = hist[hist.fecha_sugerencia > reciente].set_index("sku")

    def pasos(s, f):
        """El recorrido de las reglas: cada pregunta en orden, con su respuesta y el dato que la decide, hasta la primera que se cumple."""
        en_curso = []
        if s in camp_v.index: en_curso.append(f"campaña {camp_v.loc[s].tipo_campana.lower()} hasta el {camp_v.loc[s].fecha_hasta:%d/%m}")
        if s in cambio_r.index: en_curso.append(f"cambio de precio el {cambio_r.loc[[s]].iloc[-1].fecha:%d/%m}")
        if s in sug_r.index: en_curso.append(f"sugerencia del {sug_r.loc[[s]].iloc[-1].fecha_sugerencia:%d/%m}")
        al_dia = f.pct_esperado >= REGLAS["al_dia"]
        m10 = (f.margen - 0.10) / 0.90
        P_ = [(3, "¿Tiene algo en curso? (campaña, cambio de precio o sugerencia de los últimos 30 días)", bool(en_curso), "; ".join(en_curso) or "nada en curso"),
              (1, f"¿Vende al día ({pct(REGLAS['al_dia'])} o más de lo esperado) y le quedan menos de {REGLAS['meses_reponer']} meses de stock?",
               al_dia and f.meses < REGLAS["meses_reponer"], f"vende el {pct(f.pct_esperado)} de lo esperado; stock para {dec(f.meses) if f.meses == f.meses else 'sin venta'} meses"),
              (2, "¿Vende al día pero con stock para varios meses?", al_dia, f"vende el {pct(f.pct_esperado)} de lo esperado"),
              (4, "¿Nunca vendió en toda la ventana?", f.vendidas == 0, f"{mil(f.vendidas)} vendidas"),
              (5, "¿Se cortó? (vendía 0,5 u/día o más y el último mes cayó a menos de un cuarto)",
               f.v_antes_mes / 30 >= REGLAS["corte_u_dia"] and f.v30 < REGLAS["corte_ratio"] * f.v_antes_mes,
               f"vendía {mil(f.v_antes_mes)} u/mes; el último mes, {mil(f.v30)}"),
              (6, "¿Está mal ubicado? (más de la mitad del stock en sucursales sin ninguna venta)",
               f.share_sin_venta > REGLAS["mal_ubicado"] and f.vendidas > 0, f"{pct(f.share_sin_venta)} del stock en sucursales sin ventas"),
              (7, f"¿Tiene {REGLAS['aceptados_repetidos']} o más descuentos aceptados antes?", f.aceptados_antes >= REGLAS["aceptados_repetidos"],
               f"{f.aceptados_antes} {'aceptado' if f.aceptados_antes == 1 else 'aceptados'}"),
              (8, f"¿Margen bajo? (con 10 % quedaría menos de {pct(REGLAS['margen_minimo'])})", m10 < REGLAS["margen_minimo"],
               f"margen {pct(f.margen)}; con 10 % quedaría {pct(m10)}"),
              (9, "Ninguna de las anteriores: vende poco pero parejo", True, f"vende el {pct(f.pct_esperado)} de lo esperado; {mil(f.v30)} u el último mes")]
        out = []
        for g_, q, c, d in P_:
            out.append(dict(grupo=g_, pregunta=q, cumple=bool(c), dato=d))
            if c:
                break
        return out

    P["pasos"] = [pasos(s, f) for s, f in P.iterrows()]
    P["grupo_n"] = P.pasos.map(lambda x: x[-1]["grupo"])

    def criterios(s, f):
        """Evalúa el descuento probado en su tipo. Devuelve (veredicto, %, texto)."""
        if f.tipo not in ev.index:
            return "no", 0, "no hay evidencia de su tipo", {}
        e = ev.loc[f.tipo]
        d = e.descuento
        m_desp = (f.precio * (1 - d) - f.costo) / (f.precio * (1 - d))
        vencido = f.share_vencido > REGLAS["vencido_mayoria"]
        ok = {"posicion": f.rank_tipo > 1}
        if not vencido:                                  # con stock vencido, adelantar compras no es un costo
            ok["despues"] = e.despues >= REGLAS["despues_minimo"]
        debil = (not e.firme) and e.respuesta >= REGLAS["respuesta_debil"] and e.despues >= REGLAS["despues_minimo"]
        estado_tipo = "responde" if e.firme else ("respondió pero sin rango firme: evidencia débil, se prueba y no se baja" if debil else "no respondió de forma firme")
        txt = (f"su tipo {estado_tipo} ({e.referencia}: {signo(e.respuesta - 1)}); "
               f"{'ya es el más barato de su tipo' if not ok['posicion'] else f'es el {f.rank_tipo}.º de {f.n_tipo} en precio'}; "
               + (f"en su tipo, después del descuento la venta {'se sostuvo' if ok['despues'] else 'cayó por debajo de antes'}; " if "despues" in ok
                  else f"el {pct(f.share_vencido)} de su stock ya venció, así que adelantar compras no es un costo; ")
               + f"le quedaría {pct(m_desp)} de margen")
        det = dict(descuento=d, referencia=e.referencia, respuesta=e.respuesta - 1,
                   tipo=("firme" if e.firme else "débil" if debil else "no"), ahorro=f.precio * d,
                   rank=int(f.rank_tipo), n_tipo=int(f.n_tipo), posicion_ok=bool(ok["posicion"]),
                   despues=e.despues - 1, despues_ok=(bool(ok["despues"]) if "despues" in ok else None), vencido=bool(vencido),
                   margen=m_desp, margen_ok=bool(m_desp >= REGLAS["margen_minimo"]))
        fallan = sum(not v for v in ok.values())
        if m_desp < REGLAS["margen_minimo"] or not (e.firme or debil):
            ver = "no"
        elif debil:
            ver = "probar" if fallan == 0 else "no"         # evidencia débil: se le exige todo
        else:
            ver = "bajar" if fallan == 0 else "probar" if fallan == 1 else "no"
        if vencido and ver == "bajar":
            ver = "probar"                                  # con stock vencido, todo descuento es una prueba medida
        det["veredicto"] = ver
        return ver, round(d * 100), txt, det

    def escalera(s, f, R):
        """Plan B del stock vencido: el producto mantiene su diagnóstico y su primera acción, pero si al revisar no se cumplió,
        se liquida con fechas. Arranca en la fecha de revisión (o cuando termina la campaña en curso). Piso: el costo."""
        if not f.u_vencidas:
            return dict(salida=None)
        ini = pd.Timestamp(datetime.strptime(R["revisar"], "%d/%m/%Y"))
        if s in camp_v.index:
            ini = max(ini, camp_v.loc[s].fecha_hasta + pd.Timedelta(days=1))
        d_hoy = float(R["descuento"]) / 100 if R["descuento"] != "" else 0
        pasos_ = [d for d in REGLAS["escalera"] if d > d_hoy and d <= f.margen]      # nunca debajo del costo
        dur = pd.Timedelta(days=REGLAS["escalon_dias"])
        if not pasos_:
            txt = (f"Stock vencido ({mil(f.u_vencidas)} u): con {pct(REGLAS['escalera'][0])} ya vendería bajo costo (margen {pct(f.margen)}). "
                   f"Si al {ini:%d/%m} no se cumplió: devolución o bonificación de {f.proveedor}; si no hay acuerdo, outlet al costo.")
            return dict(si_no=txt, salida=f"{ini:%Y-%m-%d}")
        tramos = [f"{pct(d)} del {ini + i * dur:%d/%m} al {ini + (i + 1) * dur - pd.Timedelta(days=1):%d/%m}" for i, d in enumerate(pasos_)]
        fin = ini + len(pasos_) * dur
        txt = (f"Stock vencido ({mil(f.u_vencidas)} u): si al {ini:%d/%m} no se cumplió, liquidar con fechas: " + "; si la venta no se duplica, ".join(tramos)
               + f"; lo que quede, devolución a {f.proveedor} u outlet desde el {fin:%d/%m}. Piso: el costo.")
        return dict(si_no=txt, salida=f"{fin:%Y-%m-%d}")

    def sintesis(s, f, L, R, det):
        """El problema en una frase y los indicadores que lo deciden, con su valor y su regla: lo que la ficha muestra para revisar la decisión.
        La regla está escrita como la condición del diagnóstico. ok: True = se cumple, False = no se cumple, None = dato de contexto."""
        I = lambda nombre, valor, regla, ok=None: dict(nombre=nombre, valor=valor, regla=regla, ok=ok)
        G, ind = f.grupo_n, []
        esperado = I("% de lo esperado (ritmo del lote)", pct(f.pct_esperado), f"al día: {pct(REGLAS['al_dia'])} o más", bool(f.pct_esperado >= REGLAS["al_dia"]))
        lento = I("% de lo esperado (ritmo del lote)", pct(f.pct_esperado), f"atrasado: menos de {pct(REGLAS['al_dia'])}", bool(f.pct_esperado < REGLAS["al_dia"]))
        meses = I("Meses de stock al ritmo del último mes", dec(f.meses) if f.meses == f.meses else "sin venta el último mes",
                  f"se vende solo: menos de {REGLAS['meses_reponer']}", bool(f.meses < REGLAS["meses_reponer"]))
        if G == 1:
            problema = f"Vende el {pct(f.pct_esperado)} de lo esperado y el stock alcanza para {dec(f.meses)} meses: no tiene un problema de venta."
            ind += [esperado, meses, I("Días de stock en el local más justo", mil(L.dias_de_stock.min()), "reponer si baja de 30", bool(L.dias_de_stock.min() < 30))]
        elif G == 2:
            sobra = R["sobrante"]
            problema = f"Vende al ritmo de su objetivo, pero el objetivo no alcanza para el stock: sobrarían {mil(sobra)} u ({pct(sobra / f.stock)}) a la fecha límite."
            ind += [esperado, I("Meses de stock al ritmo del último mes", dec(f.meses), f"{REGLAS['meses_reponer']} o más: el stock dura más que el objetivo", True),
                    I("Días en el local", mil((FOTO - L.fecha_ingreso.min()).days), "recién llegado: temprano para medir el precio"),
                    I("Sobrante proyectado a la fecha límite", f"{mil(sobra)} u ({pct(sobra / f.stock)})", "el objetivo no alcanza: sobra stock (se revisa que baje)", sobra > 0)]
        elif G == 3:
            ind.append(I("Algo en curso", f.pasos[-1]["dato"], f"campaña vigente, cambio de precio o sugerencia de los últimos {REGLAS['dias_en_curso']} días", True))
            if s in cambio_r.index:
                c = cambio_r.loc[[s]].iloc[-1]
                problema = f"Se le subió el precio {signo(c.precio_nuevo / c.precio_anterior - 1)} el {c.fecha:%d/%m}: todavía no se puede medir la suba."
                ind += [I("Días desde la suba", mil((FOTO - c.fecha).days), "todavía no se puede medir: menos de 31", (FOTO - c.fecha).days < 31), lento]
            elif s in camp_v.index:
                c = camp_v.loc[s]
                ur, ut = con_rebaja(s, c.fecha_desde)
                problema = f"Tiene una campaña cargada desde el {c.fecha_desde:%d/%m}, pero {'desde entonces no vendió nada' if ut == 0 else 'ninguna venta tuvo la rebaja' if ur == 0 else f'solo {mil(ur)} de {mil(ut)} u se vendieron con rebaja'}: no se sabe si se aplica."
                ind += [I("Unidades con rebaja desde que empezó la campaña", f"{mil(ur)} de {mil(ut)}", "la campaña no se ve en caja: 0 con rebaja",
                          (ur == 0) if ut else None), lento]
            else:
                sg = sug_r.loc[[s]].iloc[-1]
                problema = {1: f"El local aceptó un {sg.descuento_pct} % el {sg.fecha_sugerencia:%d/%m}, pero sin fechas: no llegó a caja.",
                            2: f"Se le sugirió un {sg.descuento_pct} % el {sg.fecha_sugerencia:%d/%m} y el local lo rechazó: falta saber por qué."
                            }.get(sg.aceptacion, f"Se le sugirió un {sg.descuento_pct} % el {sg.fecha_sugerencia:%d/%m} y el local no respondió: falta la decisión.")
                ur, ut = con_rebaja(s, sg.fecha_sugerencia)
                ind += [I("Unidades con rebaja desde la sugerencia", f"{mil(ur)} de {mil(ut)}", "no se aplicó: 0 con rebaja", (ur == 0) if ut else None), lento]
        elif G == 4:
            vecinos = lotes[(lotes.index.get_level_values("sku").map(prod.tipo) == f.tipo) & lotes.index.get_level_values("sucursal_id").isin(L.index)
                            & (lotes.index.get_level_values("sku") != s)].vendidas.groupby(level="sku").sum()
            problema = f"No vendió ni una unidad en 90 días ({mil(f.stock)} u), aunque su tipo se vende en esos locales: o no se ve o no está."
            ind += [I("Unidades vendidas en la ventana", "0", "nunca vendió: 0", True),
                    I(f"Vendidas de su tipo en {', '.join(L.index)}", mil(vecinos.sum()), "hay demanda: más de 0", bool(vecinos.sum() > 0)),
                    I("Precio dentro de su tipo", f"{f.rank_tipo}.º de {f.n_tipo}", "ya es el más barato: el precio no lo explica", True if f.rank_tipo == 1 else None)]
        elif G == 5:
            ur, ut = con_rebaja(s)
            problema = f"Vendía {mil(f.v_antes_mes)} u por mes a precio de lista y se cortó: el último mes vendió {mil(f.v30)}."
            ind += [I("Venta por mes antes del último", mil(f.v_antes_mes), f"vendía: {dec(REGLAS['corte_u_dia'] * 30, 0)} u o más", True),
                    I("Venta el último mes", f"{mil(f.v30)} ({pct(f.v30 / f.v_antes_mes)} de antes)", f"se cortó: menos de {pct(REGLAS['corte_ratio'])} de antes", True),
                    I("Unidades vendidas con rebaja", f"{mil(ur)} de {mil(ut)}", "el precio no cambió: 0", ur == 0),
                    I("Última venta", ", ".join(f"{k}: {d:%d/%m}" for k, d in L.ultima_venta.dropna().items()), "")]
        elif G == 6:
            vende = L[L.vendidas > 0]
            problema = f"Vende en {', '.join(vende.index)} y nada en {', '.join(L[L.vendidas == 0].index)}, donde está el {pct(f.share_sin_venta)} del stock: es la ubicación, no el precio."
            ind += [I("Stock en locales sin ninguna venta", pct(f.share_sin_venta), f"mal ubicado: más de {pct(REGLAS['mal_ubicado'])}", True),
                    I(f"Vendidas en {', '.join(vende.index)}", mil(vende.vendidas.sum()), "el mismo producto, al mismo precio, se vende en otro local", True)]
        elif G == 7:
            ur, ut = con_rebaja(s)
            problema = (f"Tiene {f.aceptados_antes} descuentos aceptados y " + ("ninguno se cobró en caja: el precio nunca se probó." if ur == 0
                        else f"solo {mil(ur)} de {mil(ut)} u se vendieron con rebaja."))
            ind += [I("Descuentos aceptados antes", mil(f.aceptados_antes), f"{REGLAS['aceptados_repetidos']} o más", True),
                    I("Unidades vendidas con rebaja", f"{mil(ur)} de {mil(ut)}", "ninguno se cobró: 0 con rebaja", ur == 0), lento]
        elif G == 8:
            pares = P[(P.tipo == f.tipo) & (P.proveedor != f.proveedor)].margen       # lo mismo que P_margen_pares
            costo_par = f.precio * (1 - pares.median())
            m10 = (f.margen - 0.10) / 0.90
            problema = f"Se compró caro: deja {pct(f.margen)} de margen contra {pct(pares.median())} de su tipo con otros proveedores, y no hay margen para descontar."
            ind += [I("Margen a precio de lista", pct(f.margen), ""),
                    I("Margen con 10 % de descuento", pct(m10), f"no se puede descontar: menos de {pct(REGLAS['margen_minimo'])}", bool(m10 < REGLAS["margen_minimo"])),
                    I("Margen de su tipo con otros proveedores (mediana)", pct(pares.median()), ""),
                    I("Costo para dejar ese margen", f"$ {mil(costo_par)} ({signo(costo_par / f.costo - 1)} contra $ {mil(f.costo)})", "lo que se negocia con el proveedor")]
        else:
            problema = "Vende poco pero parejo y ninguna otra causa lo explica: puede ser el precio." + (
                " Su tipo respondió al descuento: se prueba." if R["descuento"] != "" else " Pero el descuento no pasa los criterios: no se baja.")
            ind += [lento, I("Venta el último mes contra los anteriores", f"{mil(f.v30)} u ({pct(f.v30 / f.v_antes_mes) if f.v_antes_mes else '—'} de antes)",
                                "parejo: no se cortó", bool(not f.v_antes_mes or f.v30 >= REGLAS["corte_ratio"] * f.v_antes_mes)),
                    I("Criterios del descuento", {"bajar": f"bajar {round(det['descuento'] * 100)} %", "probar": f"probar {round(det['descuento'] * 100)} %"}.get(det.get("veredicto"), "no pasa") if det else "sin evidencia de su tipo",
                      "su tipo responde y le queda margen (detalle abajo)", bool(det) and det.get("veredicto") in ("bajar", "probar"))]
        if f.u_vencidas:
            ind.append(I("Stock que ya pasó su fecha límite", f"{mil(f.u_vencidas)} u ({pct(f.share_vencido)})",
                         "si la primera acción no cumple, se liquida con fechas" + (f": salida el {pd.Timestamp(R['salida']):%d/%m}" if R.get("salida") else "")))
        return dict(problema=problema, indicadores=ind)

    filas = []
    for s, f in P.iterrows():
        L = lotes.xs(s, level="sku")
        vende, no_vende = L[L.vendidas > 0], L[L.vendidas == 0]
        u_sem = f.v30 / 30 * 7
        excedente = max(0, f.stock - f.v30 * REGLAS["meses_reponer"])
        ver, dpct, txt_crit, det_crit = criterios(s, f)
        R = dict(accion="", descuento="", condicion="", motivo="", ademas="", indicador="", linea_base="", meta="", revisar=FECHA(31), si_no="")
        G = f.grupo_n
        if G == 1:
            rep = L[L.dias_de_stock < 30]
            R.update(accion="Dejar el precio",
                     motivo=f"Vende el {pct(f.pct_esperado)} de lo esperado y el stock alcanza para {mil(f.meses * 30)} días: se vende solo. Un descuento cedería margen y aceleraría el quiebre.",
                     ademas="Reponer en " + ", ".join(f"{sid} (stock para {mil(x.dias_de_stock)} días)" for sid, x in rep.iterrows()) if len(rep) else "",
                     indicador="días de stock en el local más justo", linea_base=mil(L.dias_de_stock.min()), meta="no bajar de 15 días",
                     revisar=FECHA(7), si_no="adelantar la reposición")
        elif G == 2:
            # vende al ritmo de su objetivo, pero el objetivo puede no alcanzar para el stock: cuánto sobraría a la fecha límite
            faltan = (L.fecha_limite - FOTO).dt.days.clip(lower=0)
            sobra = float((L.unidades - L.ritmo_observado * faltan).clip(lower=0).sum())
            limite = L.fecha_limite.max()
            R.update(accion="Dejar el precio",
                     motivo=f"Ingresó el {L.fecha_ingreso.min():%d/%m/%Y} y vende el {pct(f.pct_esperado)} de lo esperado, pero el objetivo no alcanza para el stock: "
                            f"al ritmo de hoy sobrarían {mil(sobra)} u ({pct(sobra / f.stock)}) el {limite:%d/%m/%Y}. Lleva {(FOTO - L.fecha_ingreso.min()).days} días en el local: "
                            "es temprano para bajar el precio, no para planear qué hacer con el sobrante.",
                     ademas=(f"Mover {mil(no_vende.unidades.sum())} u de {', '.join(no_vende.index)} a {', '.join(vende.index)}" if len(no_vende) and len(vende) else ""),
                     condicion=(f"Si al {FECHA(31)} el sobrante no baja: probar {dpct} % ({txt_crit})" if ver in ("bajar", "probar") else ""),
                     indicador="sobrante proyectado a la fecha límite", linea_base=f"{mil(sobra)} u", meta="que baje",
                     si_no=(f"probar el descuento; si no alcanza, devolución u outlet del sobrante antes del {limite:%d/%m/%Y}" if ver in ("bajar", "probar")
                            else f"su tipo no responde al descuento: devolución u outlet del sobrante antes del {limite:%d/%m/%Y}"),
                     sobrante=sobra)
        elif G == 3:
            if s in cambio_r.index:
                c = cambio_r.loc[[s]].iloc[-1]
                R.update(accion="Esperar · revisar la suba de precio",
                         motivo=f"El {c.fecha:%d/%m} se le subió el precio {signo(c.precio_nuevo / c.precio_anterior - 1)} (de $ {mil(c.precio_anterior)} a $ {mil(c.precio_nuevo)}) "
                                f"vendiendo el {pct(f.pct_esperado)} de lo esperado. Pasaron pocos días para medirlo.",
                         ademas=(f"Mover {mil(no_vende.unidades.sum())} u de {', '.join(no_vende.index)} a {', '.join(vende.index)}"
                                 if len(no_vende) and len(vende) and (vende.unidades.sum() / max(vende.venta_ultimos_30.sum(), 1e-9)) < REGLAS["destino_max_meses"] else ""),
                         condicion=f"Si al {(c.fecha + pd.Timedelta(days=31)):%d/%m/%Y} no vende: volver a $ {mil(c.precio_anterior)}",
                         indicador="unidades por semana desde la suba", linea_base=dec(u_sem), meta="no caer", revisar=f"{(c.fecha + pd.Timedelta(days=31)):%d/%m/%Y}",
                         si_no=f"volver al precio anterior ($ {mil(c.precio_anterior)})")
            elif s in camp_v.index:
                c = camp_v.loc[s]
                R.update(accion="Esperar · confirmar la campaña",
                         motivo=f"Tiene una campaña cargada ({c.tipo_campana.lower()}) del {c.fecha_desde:%d/%m} al {c.fecha_hasta:%d/%m}, pero las ventas siguen a precio de lista: no se sabe si se aplica.",
                         ademas="Confirmar con Comercial si la campaña se está aplicando en caja",
                         condicion=(f"Si no se aplica: {'bajar' if ver == 'bajar' else 'probar'} {dpct} % ({txt_crit})" if ver in ("bajar", "probar")
                                    else f"Si no se aplica: no descontar ({txt_crit})"),
                         indicador="precio cobrado durante la campaña", linea_base="precio de lista", meta="ventas con la rebaja de la campaña",
                         revisar=FECHA(7), si_no="decidir con estas mismas reglas")
            else:
                sg = sug_r.loc[[s]].iloc[-1]
                if sg.aceptacion == 1:
                    e = ev.loc[f.tipo] if f.tipo in ev.index else None
                    R.update(accion=f"Aplicar el {sg.descuento_pct} % aceptado, con fechas", descuento=sg.descuento_pct,
                             motivo=f"El local aceptó un {sg.descuento_pct} % el {sg.fecha_sugerencia:%d/%m} pero no tiene fechas: hay que aplicarlo y medirlo. "
                                    f"No se espera mucho: {txt_crit}.",
                             indicador="unidades por semana con el descuento", linea_base=dec(u_sem),
                             meta=meta_esc(f, sg.descuento_pct, u_sem), revisar=FECHA(28),
                             si_no="cortar el descuento y sacar el excedente por outlet")
                else:
                    R.update(accion="Esperar · hablar con el local",
                             motivo=f"Se le sugirió un {sg.descuento_pct} % el {sg.fecha_sugerencia:%d/%m} y está {'rechazado' if sg.aceptacion == 2 else 'sin respuesta'}.",
                             ademas="Entender por qué lo rechazó el local" if sg.aceptacion == 2 else "Conseguir la respuesta del local",
                             condicion=(f"Candidato: {'bajar' if ver == 'bajar' else 'probar'} {dpct} % ({txt_crit})" if ver in ("bajar", "probar") else f"No descontar ({txt_crit})"),
                             indicador="respuesta del local", linea_base="pendiente", meta="decisión acordada", revisar=FECHA(7), si_no="decidir con estas mismas reglas")
        elif G == 4:
            vecinos = lotes[(lotes.index.get_level_values("sku").map(prod.tipo) == f.tipo) & lotes.index.get_level_values("sucursal_id").isin(L.index)
                            & (lotes.index.get_level_values("sku") != s)]
            mejor = vecinos.vendidas.groupby(level="sku").sum().sort_values(ascending=False)
            R.update(accion="No bajar · contar stock y exhibir",
                     motivo=f"Cero ventas en 90 días ({mil(f.stock)} u), mientras otros productos de su tipo se venden en esos locales "
                            f"({prod.nombre[mejor.index[0]]}: {mil(mejor.iloc[0])} vendidas). No es la demanda ni el precio: "
                            f"{'ya es el más barato de su tipo' if f.rank_tipo == 1 else f'es el {f.rank_tipo}.º de {f.n_tipo} en precio'}.",
                     ademas=f"Contar el stock físico y exhibirlo junto a los de su tipo que se venden; si no vende, devolución a {f.proveedor} u outlet",
                     indicador="primera venta", linea_base="0 u", meta="al menos 1 venta por local", revisar=FECHA(15), si_no=f"devolución a {f.proveedor} u outlet")
        elif G == 5:
            ult = ventas[ventas.sku == s].groupby("sucursal_id").fecha.max()
            agotado = L[(L.unidades <= 5) & (L.vendidas > 0)]
            sobra = L[L.unidades > 5]
            mover = f"Mover unidades de {', '.join(sobra.index)} ({mil(sobra.unidades.sum())} u sin ventas) a {', '.join(agotado.index)}, donde se agotó" if len(agotado) and len(sobra) else ""
            R.update(accion="No bajar · investigar",
                     motivo=f"Vendía {mil(f.v_antes_mes)} u por mes a precio de lista y se cortó ({', '.join(f'{k}: última venta el {d:%d/%m}' for k, d in ult.items())}), "
                            "sin cambio de precio y con otros productos de su tipo vendiendo: la causa no es el precio.",
                     ademas=mover or "Revisar en el local: stock físico, exhibición y talles o colores disponibles",
                     indicador="unidades por semana", linea_base=dec(u_sem), meta=f"volver a {dec(f.v_antes_mes / 30 * 7)}", revisar=FECHA(15),
                     si_no="outlet o devolución al proveedor")
        elif G == 6:
            meses_vende = vende.unidades.sum() / (vende.venta_ultimos_30.sum() or np.nan)
            if f.stock < REGLAS["stock_minimo"]:
                R.update(accion="No tocar", motivo=f"Quedan {mil(f.stock)} u repartidas en {len(L)} locales: es un resto.",
                         ademas=f"Juntar las unidades en {', '.join(vende.index)} o sumarlas al outlet")
            else:
                R.update(accion="No bajar · revisar exhibición",
                         motivo=f"Vende solo en {', '.join(vende.index)} y nada en {', '.join(no_vende.index)} ({mil(no_vende.unidades.sum())} u) desde que llegó, "
                                f"aunque su rubro se vende en esos locales. {', '.join(vende.index)} ya tiene stock para {mil(meses_vende)} meses: mandarle más no lo resuelve.",
                         ademas=f"Revisar la exhibición en {', '.join(no_vende.index)}; si no vende, devolución a {f.proveedor} u outlet. No mandar más a {', '.join(vende.index)}",
                         indicador=f"unidades vendidas en {', '.join(no_vende.index)}", linea_base="0", meta="primeras ventas", revisar=FECHA(15),
                         si_no=f"devolución a {f.proveedor} u outlet")
        elif G == 7:
            casi_nada = L[L.vendidas <= 1]
            R.update(accion="Confirmar si se aplicaron los descuentos",
                     motivo=f"Tiene {f.aceptados_antes} descuentos aceptados ({f.aceptados_sin_aplicar} sin fechas), pero todas sus ventas fueron a precio de lista: "
                            "no está claro que el cliente haya pagado menos alguna vez.",
                     condicion=(f"Si no se aplicaron: {'bajar' if ver == 'bajar' else 'probar'} {dpct} % con fechas, 4 semanas ({txt_crit})" if ver in ("bajar", "probar")
                                else f"Si no se aplicaron: no descontar igual ({txt_crit})"),
                     ademas=(f"Aun con descuento sobra stock: negociar devolución de las unidades de {', '.join(casi_nada.index)} con {f.proveedor}" if len(casi_nada) else ""),
                     indicador="precio cobrado en caja", linea_base="precio de lista", meta="ventas con la rebaja aprobada", revisar=FECHA(7),
                     si_no="outlet o devolución del excedente")
        elif G == 8:
            tope = f.margen
            R.update(accion=f"No bajar · negociar con {f.proveedor}",
                     motivo=f"Margen de {pct(f.margen)}: con 10 % le quedaría {pct((f.margen - 0.10) / 0.90)}, y desde {pct(tope)} de descuento se vendería a costo. "
                            f"El problema es el costo de compra: otros proveedores del mismo tipo dejan 40 % o más.",
                     ademas=f"Pedir a {f.proveedor} devolución o bonificación del excedente ({mil(excedente)} u). Si no hay acuerdo, outlet con piso en el costo",
                     indicador="unidades devueltas o bonificadas", linea_base="0", meta=mil(excedente), revisar=FECHA(31), si_no="outlet sin bajar del costo")
        else:  # G == 9
            e = ev.loc[f.tipo] if f.tipo in ev.index else None
            if ver == "bajar":
                R.update(accion=f"Bajar {dpct} %", descuento=dpct, motivo=f"Vende poco pero parejo y sin otra explicación. Cumple todo: {txt_crit}.",
                         ademas=f"Con fechas de vigencia, 4 semanas; medir también el mes siguiente. Aun así sobran {mil(max(0, f.stock - f.v30 * e.respuesta * 3))} u: outlet o devolución",
                         indicador="unidades por semana con el descuento", linea_base=dec(u_sem),
                         meta=meta_esc(f, dpct, u_sem), revisar=FECHA(28),
                         si_no="volver al precio de lista y sacar el excedente")
            elif ver == "probar":
                R.update(accion=f"Probar {dpct} % por 4 semanas", descuento=dpct,
                         motivo=f"Vende poco pero parejo y sin otra explicación. Cumple casi todo: {txt_crit}.",
                         ademas=f"Con fechas; medir durante y el mes siguiente. Si no mueve, se corta" + (f" y va a la negociación con {f.proveedor}" if f.proveedor == "Cumbre" else ""),
                         indicador="unidades por semana con el descuento y el mes siguiente", linea_base=dec(u_sem),
                         meta=meta_esc(f, dpct, u_sem) + f"; después, no menos de {dec(u_sem)}", revisar=FECHA(28),
                         si_no="cortar el descuento" + (f" y negociar con {f.proveedor}" if f.proveedor == "Cumbre" else ""))
            else:
                R.update(accion="No bajar", motivo=f"Vende poco pero parejo. El descuento no se justifica: {txt_crit}.",
                         ademas=f"Sacar el excedente: {mil(excedente)} u que no se venderían en 3 meses (outlet o devolución a {f.proveedor})"
                                + (f". Revisar la exhibición en {', '.join(no_vende.index)} (sin ventas)" if len(no_vende) else ""),
                         indicador="unidades fuera por outlet o devolución", linea_base="0", meta=mil(excedente), revisar=FECHA(31), si_no="escalar a Compras")
        R.update(escalera(s, f, R))
        R.update(sintesis(s, f, L, R, det_crit))
        filas.append(dict(sku=s, criterios=det_crit, **R))
    D = P.join(pd.DataFrame(filas).set_index("sku"))
    D["grupo"] = D.grupo_n.map(GRUPOS)
    D["consultora"] = cons.apply(lambda c: f"{c.decision.replace('_', ' ')} {c.descuento_pct} %" if c.descuento_pct else c.decision.replace("_", " "), axis=1)
    D["consultora_descuenta"] = cons.descuento_pct > 0
    D["nuestro_descuento"] = np.where(D.descuento.astype(str) != "", "ya",
                                      np.where(D.condicion.str.lower().str.contains(r"(?:bajar|probar) \d+ %"), "condicional", "no"))
    D["coincide"] = np.where(D.consultora_descuenta == (D.nuestro_descuento != "no"), "sí", "no")
    D["consultora_proyecta_mas_que_stock"] = cons.unidades_proyectadas_30d > D.stock
    D["consultora_bajo_costo"] = (D.precio * (1 - cons.descuento_pct / 100) < D.costo) & D.consultora_descuenta
    return D.sort_values(["grupo_n", "stock"], ascending=[True, False]), ev


COLOR_ACCION = lambda a: ("CDE8D6" if a.startswith(("Bajar", "Probar", "Aplicar")) else "DCEBF5" if a.startswith("Dejar")
                          else "F5E2A8" if a.startswith(("Esperar", "Confirmar")) else "EEEEEE" if a.startswith("No tocar") else "F2C4BC")


def texto_indicadores(ind):
    """Los indicadores de un producto en una celda: ✓ se cumple la regla, ✗ no se cumple, · dato de contexto."""
    marca = {True: "✓", False: "✗", None: "·"}
    return "\n".join(f"{marca[i['ok']]} {i['nombre']}: {i['valor']}" + (f" ({i['regla']})" if i["regla"] else "") for i in ind)


def hoja_propuesta(wb, D, ev):
    ws = wb.create_sheet("Propuesta", 0)
    ws.sheet_view.zoomScale = 90
    ws.cell(1, 1, "Propuesta de precio para los 48 productos").font = F_TIT
    nota(ws, 2, f"Datos al {FOTO:%d/%m/%Y}. Cada producto cae en el primer grupo que lo explica; el descuento se evalúa solo donde su grupo lo admite, "
                f"con los mismos criterios para todos (ver hoja 'Cómo se calcula' y la nota).")
    # resumen por causa: los 9 grupos contados en 5 causas, y qué herramienta resuelve cada una
    r = 4
    ws.cell(r, 1, "Por qué no se vende: 5 causas").font = F_SEC
    r += 1
    for j, t in enumerate(["causa", "grupos", "productos", "stock (u)", "% del stock", "ya vencido (u)", "el problema", "la solución", "¿toca el precio?"], start=1):
        c = ws.cell(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD; c.alignment = Alignment(wrap_text=True)
    for k, ca in CAUSAS.items():
        g = D[D.grupo_n.isin(ca["grupos"])]
        r += 1
        for j, x in enumerate([ca["nombre"], ", ".join(map(str, ca["grupos"])), len(g), int(g.stock.sum()), g.stock.sum() / D.stock.sum(), int(g.u_vencidas.sum()),
                               ca["problema"], ca["solucion"], ca["precio"]], start=1):
            c = ws.cell(r, j, x); c.number_format = "0%" if j == 5 else "#,##0"; c.alignment = Alignment(wrap_text=True, vertical="top")
    r += 3

    # resumen por grupo
    ws.cell(r, 1, "Resumen por grupo").font = F_SEC
    r += 1
    for j, t in enumerate(["grupo", "productos", "stock (u)", "stock a costo ($)", "descuento ya", "descuento condicional", "sin descuento", "consultora descuenta"], start=1):
        c = ws.cell(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD; c.alignment = Alignment(wrap_text=True)
    for n, nombre in GRUPOS.items():
        g = D[D.grupo_n == n]
        r += 1
        for j, x in enumerate([nombre, len(g), int(g.stock.sum()), float((g.stock * g.costo).sum()), int((g.nuestro_descuento == "ya").sum()),
                               int((g.nuestro_descuento == "condicional").sum()), int((g.nuestro_descuento == "no").sum()), int(g.consultora_descuenta.sum())], start=1):
            c = ws.cell(r, j, x); c.number_format = "$ #,##0" if j == 4 else "#,##0"
    r += 1
    for j, x in enumerate(["Total", len(D), int(D.stock.sum()), float((D.stock * D.costo).sum()), int((D.nuestro_descuento == "ya").sum()),
                           int((D.nuestro_descuento == "condicional").sum()), int((D.nuestro_descuento == "no").sum()), int(D.consultora_descuenta.sum())], start=1):
        c = ws.cell(r, j, x); c.font = Font(bold=True); c.fill = FILL_TOTAL; c.number_format = "$ #,##0" if j == 4 else "#,##0"
    r += 3

    # tabla de los 48
    ws.cell(r, 1, "Producto por producto").font = F_SEC
    r += 1
    cols = [("producto", 30), ("sku", 9), ("grupo", 24), ("causa", 18), ("el problema", 50), ("indicadores que lo deciden", 62), ("sucursales (stock)", 22), ("stock", 8), ("% de lo esperado", 10), ("vendidas último mes", 10),
            ("acción", 26), ("descuento", 9), ("condición", 40), ("motivo", 60), ("además", 48), ("indicador", 26), ("línea base", 12), ("meta", 30),
            ("revisar el", 11), ("si no se cumple", 26), ("consultora", 16), ("¿coincide con la consultora?", 12)]
    for j, (t, w) in enumerate(cols, start=1):
        c = ws.cell(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD; c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.column_dimensions[get_column_letter(j)].width = w
    head = r
    for s, f in D.iterrows():
        r += 1
        vals = [f.producto, s, f.grupo, CAUSAS[CAUSA_DE[f.grupo_n]]["nombre"], f.problema, texto_indicadores(f.indicadores), f.sucursales, int(f.stock), f.pct_esperado, int(f.v30), f.accion, f"{f.descuento} %" if f.descuento != "" else "",
                f.condicion, f.motivo, f.ademas, f.indicador, f.linea_base, f.meta, f.revisar, f.si_no, f.consultora, f.coincide]
        for j, x in enumerate(vals, start=1):
            c = ws.cell(r, j, x)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if j == 9:
                c.number_format = "0%"
        ws.cell(r, 11).fill = PatternFill("solid", fgColor=COLOR_ACCION(f.accion))
        ws.cell(r, 11).font = Font(bold=True)
        ws.cell(r, 22).fill = PatternFill("solid", fgColor="CDE8D6" if f.coincide == "sí" else "F2C4BC")
    for sku_, nombre in SIN_STOCK_SKU:                      # también se dice algo de los que no tienen stock
        r += 1
        vals = [nombre, sku_, "— · sin stock", "—", "No tiene stock: no hay mercadería quieta.", "", "ninguna", 0, None, None, "Sin stock: nada que mover", "", "",
                "No tiene stock en ninguna sucursal en esta foto: no hay mercadería quieta.", "Si se vendía bien, evaluar reponer.",
                "", "", "", "", "", "", ""]
        for j, x in enumerate(vals, start=1):
            ws.cell(r, j, x).alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(r, 11).font = Font(bold=True)
    ws.freeze_panes = ws.cell(head + 1, 2)
    ws.auto_filter.ref = f"A{head}:{get_column_letter(len(cols))}{r}"
    r += 3
    ws.cell(r, 1, "Evidencia de cada tipo (la cuenta de la consigna: venta por día con descuento ÷ resto de la ventana)").font = F_SEC
    r += 1
    for j, t in enumerate(["tipo", "medido en", "descuento", "respuesta", "rango bajo (5 %)", "¿firme?", "después (corregido por temporada)"], start=1):
        c = ws.cell(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD
    for t, e in ev.sort_values("respuesta", ascending=False).iterrows():
        r += 1
        for j, (x, fmt) in enumerate([(t, None), (e.referencia, None), (e.descuento, "0%"), (e.respuesta - 1, "+0%;-0%;0%"), (e.rango_bajo - 1, "+0%;-0%;0%"),
                                       ("sí" if e.firme else "no", None), (e.despues - 1, "+0%;-0%;0%")], start=1):
            c = ws.cell(r, j, x)
            if fmt:
                c.number_format = fmt

    # escenarios de los descuentos de ahora
    ESC = {s_: e for s_, e in escenarios_de(D).items() if e}
    if not ESC:
        return
    r += 3
    ws.cell(r, 1, "Qué esperar de los descuentos de ahora: escenarios con lo que pasó antes con el mismo descuento").font = F_SEC
    r += 1
    k = next(iter(ESC.values()))
    ws.cell(r, 1, f"Cada escenario es un caso medido en la hoja Descuentos (mismo tipo y mismo %), corregido por el control ({signo(k['ctrl_dur'])} durante, "
                  f"{signo(k['ctrl_desp'])} el mes siguiente). 4 semanas con descuento + el mes siguiente, contra 2 meses sin tocar el precio.").font = F_NOTA
    r += 1
    cab = ["producto", "descuento", "escenario", "medido en", "venta durante vs antes", "venta el mes siguiente", "u durante (4 sem)", "u mes siguiente",
           "margen 2 meses", "sin descuento", "diferencia", "para empatar tiene que vender"]
    for j, t in enumerate(cab, start=1):
        c = ws.cell(r, j, t); c.font = F_HEAD; c.fill = FILL_HEAD; c.alignment = Alignment(wrap_text=True, vertical="top")
    tot = [0.0, 0.0, 0.0]
    for s_, e in ESC.items():
        for i, x in enumerate(e["escenarios"]):
            r += 1
            tot[i] += x["dif"]
            vals = [(D.producto[s_] if i == 0 else "", None), (e["d"] if i == 0 else None, "0%"), (x["escenario"], None), (x["medido_en"], None),
                    (x["dur"], "+0%;-0%;0%"), (x["desp"], "+0%;-0%;0%"), (x["u_dur"], "0.0"), (x["u_desp"], "0.0"), (x["margen"], "$ #,##0"),
                    (e["sin"], "$ #,##0"), (x["dif"], "+$ #,##0;-$ #,##0;$ 0"), (e["equilibrio"] if i == 0 else None, "+0%;-0%;0%")]
            for j, (v, fmt) in enumerate(vals, start=1):
                c = ws.cell(r, j, v)
                if fmt:
                    c.number_format = fmt
            ws.cell(r, 11).fill = PatternFill("solid", fgColor="CDE8D6" if x["dif"] >= 0 else "F2C4BC")
            if i == 1:
                for j in range(3, 12):
                    ws.cell(r, j).font = Font(bold=True)
    for i, nombre in enumerate(["Peor sucursal", "Todas juntas", "Mejor sucursal"]):
        r += 1
        ws.cell(r, 1, "Total" if i == 0 else "").font = Font(bold=True)
        ws.cell(r, 3, nombre).font = Font(bold=True)
        c = ws.cell(r, 11, tot[i]); c.number_format = "+$ #,##0;-$ #,##0;$ 0"; c.font = Font(bold=True)
        for j in range(1, 13):
            ws.cell(r, j).fill = FILL_TOTAL


def regalo_g1(D):
    """Margen que cedería la consultora en 30 días descontando productos que venden al día (se iban a vender igual)."""
    cd = h["propuesta_consultora"].set_index("sku").descuento_pct / 100
    g1 = D[(D.grupo_n == 1) & D.consultora_descuenta]
    return float((g1.v30.clip(upper=g1.stock) * g1.precio * cd[g1.index]).sum())


def P_margen_pares(D, f):
    """Margen mediano de los productos del mismo tipo con otros proveedores."""
    return D[(D.tipo == f.tipo) & (D.proveedor != f.proveedor)].margen.median()


def historias(D, ev):
    """Cada causa contada en 4 pasos simples, con sus datos: qué pasa, la prueba, qué hacemos y por qué, y cómo lo medimos.
    Es lo mismo que muestran la nota y la primera pantalla del tablero. Entre ** va lo que se resalta."""
    rango = lambda a, b, f=mil: f(a) if f(a) == f(b) else f"{f(a)} a {f(b)}"
    tipo = lambda x: {"sabanas": "sábanas"}.get(x, x)
    y_ = lambda xs: " y ".join([", ".join(xs[:-1]), xs[-1]] if len(xs) > 1 else xs)
    fechas = lambda d: pd.to_datetime(d.revisar, format="%d/%m/%Y")
    revisa = lambda d: (f"Se revisa el {fechas(d).min():%d/%m}" if fechas(d).nunique() == 1
                        else f"Se revisa entre el {fechas(d).min():%d/%m} y el {fechas(d).max():%d/%m}") + ", producto por producto (cada ficha tiene su fecha)."
    cz = {k: D[D.grupo_n.isin(c["grupos"])] for k, c in CAUSAS.items()}
    H = {}

    g1, g2 = D[D.grupo_n == 1], D[D.grupo_n == 2]
    H["ok"] = dict(
        que_pasa="Venden bien, o llegaron hace poco y venden al ritmo previsto. Acá no hay nada que arreglar con el precio.",
        prueba=[f"Los {len(g1)} que andan bien venden el **{pct(g1.pct_esperado.min())} o más** de lo esperado y el stock les alcanza para **{rango(g1.meses.min() * 30, g1.meses.max() * 30)} días**."]
               + ([f"Los {len(g2)} recién llegados cumplen su objetivo, pero el objetivo es corto: al ritmo de hoy **sobraría {rango((g2.sobrante / g2.stock).min(), (g2.sobrante / g2.stock).max(), pct)}** "
                   "de su stock a la fecha límite."] if len(g2) else []),
        hacemos="Dejar el precio. Reponer donde se está por agotar y mover stock de los recién llegados al local donde sí venden.",
        por_que=f"Se venden solos: bajarles el precio es regalar margen. La consultora descuenta {int(g1.consultora_descuenta.sum())} de estos y cedería unos "
                f"**$ {dec(regalo_g1(D) / 1e6)} M en 30 días** por ventas que iban a ocurrir igual.",
        medimos="Que no se queden sin stock (meta: nunca menos de 15 días en ningún local)"
                + (f" y que baje lo que sobraría a la fecha límite en los recién llegados (hoy **{mil(g2.sobrante.sum())} u**)" if len(g2) else "") + ". " + revisa(cz["ok"]))

    acept = hist[hist.aceptacion == 1]
    verif = len(acept) - int((acept.fecha_vigencia_desde.isna() & (acept.fecha_sugerencia < INICIO)).sum())
    aplic = int(acept.fecha_vigencia_desde.notna().sum())
    camp_t = camp[camp.fecha_desde <= FOTO]
    camp_reb = sum(con_rebaja(x.sku, x.fecha_desde, min(x.fecha_hasta, FOTO))[0] for x in camp_t.itertuples())
    ej = cz["ejecucion"]
    H["ejecucion"] = dict(
        que_pasa="Se aprobaron descuentos y campañas que nunca se cobraron en caja: el cliente siguió pagando el precio de lista. En otros hay un cambio recién hecho que todavía no se puede medir.",
        prueba=[f"De los {verif} descuentos aprobados que se pueden comprobar en las ventas, **solo {aplic} se cobraron**.",
                f"Las {len(camp_t)} campañas cargadas: **{mil(camp_reb)} unidades** vendidas con rebaja."],
        hacemos="Cobrar en caja lo que ya se aprobó, con fecha de inicio y de fin, y esperar a medir los cambios en curso antes de sumar otro.",
        por_que="Si un descuento nunca se cobró, todavía no sabemos si el precio funciona: aprobar otro es repetir el error. Y si se superponen dos cambios, no se puede saber cuál sirvió.",
        medimos="Que desde el primer día las ventas muestren el precio rebajado (precio cobrado contra precio de lista; meta: el 100 % de lo aprobado en caja) y, después, "
                "las unidades por semana contra las de antes. " + revisa(ej))

    pr = cz["producto"]
    g4, g5, g6 = D[D.grupo_n == 4], D[D.grupo_n == 5], D[D.grupo_n == 6]
    vec = []
    for s, f in g4.iterrows():
        L_ = lotes.xs(s, level="sku")
        vec.append(lotes[(lotes.index.get_level_values("sku").map(prod.tipo) == f.tipo) & lotes.index.get_level_values("sucursal_id").isin(L_.index)
                         & (lotes.index.get_level_values("sku") != s)].vendidas.sum())
    H["producto"] = dict(
        que_pasa="Hay clientes para estos productos, pero no se venden: no están a la vista, se agotaron los talles que salían o están en el local equivocado.",
        prueba=([f"{len(g4)} **nunca vendieron** en 90 días, mientras otros de su mismo tipo vendieron **{rango(min(vec), max(vec))} u** en esos mismos locales."] if len(g4) else [])
               + ([f"{len(g5)} **se cortaron**: vendían {rango(g5.v_antes_mes.min(), g5.v_antes_mes.max())} u por mes y el último mes {rango(g5.v30.min(), g5.v30.max())}, "
                   "**sin que cambiara el precio**."] if len(g5) else [])
               + ([f"{len(g6)} **están mal ubicados**: el {rango(g6.share_sin_venta.min(), g6.share_sin_venta.max(), pct)} de su stock está en locales donde nunca vendieron, "
                   "y en otro local se venden al mismo precio."] if len(g6) else []),
        hacemos="Contar el stock físico y exhibirlo, mover unidades a donde se venden e investigar en el local qué cambió.",
        por_que="El mismo producto, al mismo precio, se vende en otro momento o en otro local: lo que falla no es el precio. Un descuento a algo que nadie ve no lo vende.",
        medimos="La primera venta en cada local en 15 días; en los que se cortaron, volver a vender lo de antes. Si no, devolución u outlet. " + revisa(pr))

    co = cz["compra"]
    if len(co):
        par = co.apply(lambda f: P_margen_pares(D, f), axis=1)
        costo_par = co.precio * (1 - par)
        m10 = (co.margen - 0.10) / 0.90
        prov = D.groupby("proveedor").vendidas.sum()
        provs = list(co.proveedor.unique())
        otros = prov.drop(provs)
        exced = (co.stock - co.v30 * REGLAS["meses_reponer"]).clip(lower=0).sum()
        H["compra"] = dict(
            que_pasa=f"Se compraron tan caro que no queda margen para bajarles el precio ({', '.join(provs)}).",
            prueba=[f"Dejan **{rango(co.margen.min(), co.margen.max(), pct)} de margen**; los mismos productos de otros proveedores, **{rango(par.min(), par.max(), pct)}**.",
                    f"Con un 10 % de descuento quedarían en {rango(m10.min(), m10.max(), pct)}: **debajo del mínimo de {pct(REGLAS['margen_minimo'])}**.",
                    f"Para igualar a sus pares tendrían que costar **{rango((1 - costo_par / co.costo).min(), (1 - costo_par / co.costo).max(), pct)} menos**: "
                    f"$ {dec(((co.costo - costo_par) * co.stock).sum() / 1e6)} M sobre el stock actual."],
            hacemos=f"Negociar con {', '.join(provs)} la devolución o una bonificación del excedente; si no hay acuerdo, outlet al costo. Renegociar el costo para la próxima compra.",
            por_que=f"Bajar el precio sería vender casi al costo o por debajo. Y hay con qué negociar: {', '.join(provs)} vendió **{mil(prov[provs].sum())} u**, "
                    f"contra {rango(otros.min(), otros.max())} de cada uno de los otros proveedores.",
            medimos=f"Unidades devueltas o bonificadas contra el excedente (**{mil(exced)} u**). " + revisa(co))

    p9 = cz["precio"]
    firmes = ev[ev.firme.astype(bool)].sort_values("respuesta", ascending=False)
    debil = ev[(~ev.firme.astype(bool)) & (ev.respuesta >= REGLAS["respuesta_debil"]) & (ev.despues >= REGLAS["despues_minimo"])]
    nada = ev[~ev.index.isin(firmes.index) & ~ev.index.isin(debil.index)].sort_values("descuento", ascending=False)
    ESC = escenarios_de(D)
    ya9 = [s for s in p9.index if s in ESC and ESC[s]]
    base = sum(D.v30[s] / 30 * 7 for s in ya9)
    meta = sum(D.v30[s] / 30 * 7 * (1 + ESC[s]["escenarios"][1]["dur"]) for s in ya9)
    n_si = int((p9.nuestro_descuento != "no").sum())
    H["precio"] = dict(
        que_pasa="Venden poco pero parejo, y no hay otra explicación: acá sí puede ser el precio.",
        prueba=[f"Con descuento, " + y_([f"{tipo(t)} vendieron **{signo(e.respuesta - 1)}**" for t, e in firmes.iterrows()])
                + (f"; {y_([f'{tipo(t)} {signo(e.respuesta - 1)}' for t, e in debil.iterrows()])}, una respuesta débil" if len(debil) else "") + ".",
                f"En {tipo(nada.index[0])}, un {pct(nada.descuento.iloc[0])} de descuento movió apenas **{signo(nada.respuesta.iloc[0] - 1)}**; "
                f"{y_([tipo(x) for x in nada.index[1:]])} tampoco respondieron.",
                f"Productos sin ningún cambio variaron {signo(RES_DESC['control'][-1]['dur'])} esas mismas semanas: la suba no fue por temporada."],
        hacemos=f"Probar un descuento por 4 semanas solo en los **{n_si} de {len(p9)}** cuyo tipo respondió y les queda margen. Los otros no se bajan: van a outlet o devolución del excedente.",
        por_que="Es el único lugar con evidencia de que el precio mueve la venta. Aun así el efecto es chico y se midió en productos que venden bien: por eso es una prueba y no una baja definitiva.",
        medimos=(f"Unidades por semana durante el descuento: hoy **{dec(base)}**, meta **{dec(meta)}** entre los {len(ya9)}. " if ya9 else "")
                + "Se compara contra una sucursal sin descuento y se mira el mes siguiente, para ver que no fue solo adelantar compras. " + revisa(p9))

    venc = D[D.u_vencidas > 0]
    lv = lotes[lotes.vencido == "sí"]
    anio = int((lv.unidades > lv.venta_ultimos_30 / 30 * 365).sum())
    H["vencido"] = dict(
        nombre="Además: el stock vencido", productos=len(venc), stock=int(venc.u_vencidas.sum()),
        que_pasa="Más de la mitad del stock ya pasó su fecha límite, cualquiera sea su causa. Hay urgencia.",
        prueba=[f"**{pct(venc.u_vencidas.sum() / D.stock.sum())} del stock** ({mil(venc.u_vencidas.sum())} u) en {len(venc)} productos.",
                f"Los {len(lv)} lotes vencidos vencieron {f'el mismo día ({lv.fecha_limite.min():%d/%m})' if lv.fecha_limite.nunique() == 1 else 'en fechas distintas'} "
                f"y **{anio} no se venderían ni en un año** al ritmo actual."],
        hacemos=f"Cada producto empieza por la solución de su causa. Si en su fecha de revisión no funcionó, se liquida con fechas: "
                + " y después ".join(f"{pct(d)} por {REGLAS['escalon_dias'] // 7} semanas" for d in REGLAS["escalera"]) + ", y después devolución u outlet. Nunca debajo del costo.",
        por_que="Liquidar todo ya borraría el diagnóstico: se liquidaría algo que solo había que exhibir. Pero esperar sin fecha deja el stock quieto. La escalera hace las dos cosas en orden.",
        medimos=f"Que el stock vencido baje semana a semana. Todo tiene fecha de salida; la última, el **{pd.Timestamp(venc.salida.dropna().max()):%d/%m/%Y}**.")
    return H


def texto_nota(D, ev):
    ya = D[D.nuestro_descuento == "ya"]
    cond = D[D.nuestro_descuento == "condicional"]
    cons_desc = D[D.consultora_descuenta]
    sobra = D[D.consultora_proyecta_mas_que_stock]
    bajo = D[D.consultora_bajo_costo]
    coinc = D[D.coincide == "sí"]
    acierta_grupo = D.groupby("grupo").apply(lambda g: (g.coincide == "sí").mean())
    ESC = escenarios_de(D)
    acciones = D.accion.str.split(" ·").str[0].str.replace(r"\d+ %.*", "X %", regex=True).value_counts()
    L = []
    acept = hist[hist.aceptacion == 1]
    acept_aplicadas = acept.fecha_vigencia_desde.notna().sum()
    acept_anteriores = int((acept.fecha_vigencia_desde.isna() & (acept.fecha_sugerencia < INICIO)).sum())   # sin ventas para verificarlas
    acept_verificables = len(acept) - acept_anteriores
    venc = D[D.u_vencidas > 0]
    con_salida = venc[venc.salida.notna()]
    sin_esc = venc[venc.margen < REGLAS["escalera"][0]]                      # ni el primer escalón deja margen
    g2 = D[D.grupo_n == 2]
    tipos_firmes = ", ".join(ev.index[ev.firme.astype(bool)])
    debiles = ev[(~ev.firme.astype(bool)) & (ev.respuesta >= REGLAS["respuesta_debil"]) & (ev.despues >= REGLAS["despues_minimo"])]
    sg = lambda x: f"{'+' if x >= 0 else '−'}$ {mil(abs(x))}"
    lentos = [t for t, e in ev.iterrows() if e.lento]
    L.append(f"# Viento Sur · Nota de la propuesta (datos al {FOTO:%d/%m/%Y})\n")
    # ---- las tres capas: el problema, sus causas y una solución por causa
    tot = D.stock.sum()
    cz = {k: D[D.grupo_n.isin(c["grupos"])] for k, c in CAUSAS.items()}
    n_u = lambda d: f"{len(d)} {'producto' if len(d) == 1 else 'productos'}, {mil(d.stock.sum())} u"
    L.append("## El problema, en una frase")
    L.append(f"Hay {mil(tot)} u en stock y {(D.pct_esperado < REGLAS['al_dia']).sum()} de {len(D)} productos venden menos del {pct(REGLAS['al_dia'])} de lo esperado; "
             f"el {pct(venc.u_vencidas.sum() / tot)} del stock ({mil(venc.u_vencidas.sum())} u) ya pasó su fecha límite. Pero no es un solo problema, "
             "y el precio explica una parte chica.\n")
    L.append("## Por qué no se vende: 5 causas")
    L.append("| causa | grupos | productos | stock | ya vencido | el problema | ¿toca el precio? |")
    L.append("|---|---|---|---|---|---|---|")
    for k, c in CAUSAS.items():
        d = cz[k]
        L.append(f"| **{c['nombre']}** | {', '.join(map(str, c['grupos']))} | {len(d)} | {mil(d.stock.sum())} u ({pct(d.stock.sum() / tot)}) | {mil(d.u_vencidas.sum())} u | {c['problema']} | {c['precio']} |")
    p9 = cz["precio"]
    L.append(f"\n**El mensaje central:** solo el {pct(p9.stock.sum() / tot)} del stock ({mil(p9.stock.sum())} u) está en productos donde el precio puede ser la causa, "
             f"y aun ahí el descuento pasa los criterios en {int((p9.nuestro_descuento != 'no').sum())} de {len(p9)}. El resto tiene otra causa, que un descuento no arregla. "
             f"Descontar {len(cons_desc)} de {len(D)}, como la consultora, cede margen sin atacar la causa.\n")

    L.append("## Cada causa: qué pasa, la prueba, qué hacemos y cómo lo medimos")
    L.append("Cada producto tiene además su ficha en el tablero (y su fila en la hoja **Propuesta**) con su causa, el problema en una frase y los indicadores que lo deciden.\n")
    H = historias(D, ev)
    for i, (k, hh) in enumerate(H.items(), start=1):
        if k in CAUSAS:
            d = cz[k]
            L.append(f"### {i} · {CAUSAS[k]['nombre']} ({n_u(d)})")
        else:
            L.append(f"### {hh['nombre']} ({mil(hh['stock'])} u en {hh['productos']} productos)")
        L.append(f"- **Qué pasa:** {hh['que_pasa']}")
        L.append("- **La prueba:** " + " ".join(hh["prueba"]))
        L.append(f"- **Qué hacemos:** {hh['hacemos']}")
        L.append(f"- **Por qué:** {hh['por_que']}")
        L.append(f"- **Cómo lo medimos:** {hh['medimos']}\n")

    L.append("## El detalle: 9 grupos y los criterios del descuento")
    L.append("Cada producto cae en uno de 9 grupos "
             "(reglas en orden, la primera que se cumple) y el grupo define la acción. El descuento se evalúa solo donde el grupo lo admite: su tipo tiene que haber "
             f"respondido a un descuento ({tipos_firmes} de forma firme; {', '.join(debiles.index) or 'ninguno'} débil, y entonces solo se prueba) y le tiene que quedar "
             f"al menos {pct(REGLAS['margen_minimo'])} de margen. Todo descuento va con fechas, dura 4 semanas y se mide también el mes siguiente.\n")
    L.append(f"- **Descuento ya, a prueba: {len(ya)}** — " + ", ".join(f"{p} ({a.lower()})" for p, a in zip(ya.producto, ya.accion)) + ".")
    L.append(f"- **Descuento si se cumple una condición: {len(cond)}** — " + ", ".join(cond.producto) + ".")
    L.append(f"- **Sin descuento: {(D.nuestro_descuento == 'no').sum()}**: reponer, mover stock entre sucursales, revisar exhibición y stock físico, o devolver y negociar con el proveedor.")
    L.append("\nAcción, motivo, meta, fecha de revisión y plan de salida de los 48: hoja **Propuesta**.\n")
    L.append("## Qué miré")
    L.append(f"- **Ritmo del lote** (la cuenta de la consigna): {(D.pct_esperado < REGLAS['al_dia']).sum()} de 48 productos venden menos del {pct(REGLAS['al_dia'])} de lo esperado.")
    L.append("- **Por qué no vende cada uno**: el mismo producto en otras sucursales, los de su tipo, la última venta, campañas, cambios de precio y sugerencias anteriores.")
    L.append(f"- **Los {len(ev)} descuentos aplicados**: cuánto cambió la venta durante, con un rango por azar, contra un control sin cambios, y qué pasó el mes siguiente.\n")
    L.append("## Qué interpreté")
    L.append("- La decisión de precio es una por producto; las sucursales sirven para entender por qué no vende.")
    L.append("- Una sugerencia aceptada sin fechas de vigencia no se aplicó: no se ve en el precio cobrado.")
    L.append("- Un producto lento responde al descuento como el de su tipo que se descontó (con los límites de abajo).")
    L.append("- La fecha límite marca la urgencia, no el diagnóstico: un producto vencido que nunca se exhibió, primero se exhibe.")
    L.append("- El stock de cada día se reconstruye desde la foto: supone que no hubo reposiciones ni transferencias.\n")
    L.append("## Qué dejé afuera y qué limita la evidencia")
    L.append(f"- Las {len(acept) - acept_aplicadas} sugerencias aceptadas sin fechas, y las diferencias por sucursal en la respuesta al precio (con 2 locales y pocas ventas no se distinguen del azar).")
    L.append(f"- **La respuesta al descuento se midió en productos que venden bien**" + (f" (salvo {', '.join(lentos)})" if lentos else "")
             + ": para los lentos, el efecto esperado es un techo. Es un producto por tipo, en 2 sucursales y en las mismas 4 semanas, y el control son 2 productos. "
             "Por eso todo descuento es una prueba con una sucursal de comparación; cuando haya uno medido en un producto lento, el proceso usa ese.")
    L.append("- Temporada y talles (no hay datos), el costo de tener el stock quieto y el efecto de reponer, mover u outlet (no se pueden medir).\n")
    L.append("## Cómo estimo el efecto en 30 días")
    L.append("Con lo que pasó antes con el mismo descuento (mismo tipo y mismo %), corregido por temporada, en tres escenarios: como la peor sucursal, como todas juntas "
             "y como la mejor. Donde no se toca el precio, el efecto de precio es cero.\n")
    if ESC:
        L.append("| producto | descuento | medido en | para empatar tiene que vender | margen en 30 días: peor / todas / mejor |")
        L.append("|---|---|---|---|---|")
        for sku_, e in ESC.items():
            x = e["escenarios"]
            L.append(f"| {D.producto[sku_]} | {pct(e['d'])} | {x[1]['medido_en'].split(' · ')[0]} | {signo(e['equilibrio'])} | " + " / ".join(sg(y["dif_30"]) for y in x) + " |")
        t30 = [sum(e["escenarios"][i]["dif_30"] for e in ESC.values()) for i in range(3)]
        u30 = [sum(e["escenarios"][i]["u_dur"] for e in ESC.values()) for i in range(3)]
        tot = [sum(e["escenarios"][i]["dif"] for e in ESC.values()) for i in range(3)]
        L.append(f"\n**En 30 días**: {mil(sum(e['v30'] for e in ESC.values()))} → {dec(u30[1])} u (entre {dec(u30[0])} y {dec(u30[2])}) y {sg(t30[1])} de margen "
                 f"(entre {sg(t30[0])} y {sg(t30[2])}); sumando el mes siguiente, entre {sg(tot[0])} y {sg(tot[2])}. El descuento mueve poco y cuesta margen: "
                 "el stock quieto sale sobre todo por las otras acciones. La escalera no tiene efecto estimado (por encima de 20 % no hay evidencia): cada escalón se mide.\n")
    L.append("## Juicio sobre la consultora")
    L.append(f"**Tomaría solo una parte.** Descuenta en {len(cons_desc)} de 48 productos; esta propuesta, en {len(ya)} ya y {len(cond)} con condición. Coinciden en {len(coinc)} de 48.")
    L.append(f"- **Tomo** su \"no descontar\" donde la venta acompaña al stock, y descontar productos lentos de los tipos que respondieron ({tipos_firmes}), con el porcentaje probado en cada tipo.")
    L.append("- **Reemplazo el resto**: usa el precio para problemas que no son de precio (productos que venden al día, que se cortaron, que nunca se exhibieron, "
             "con campañas o subas en curso, o con descuentos aceptados que nunca llegaron a caja).")
    L.append(f"- **Errores que se comprueban con las hojas**: en {len(sobra)} productos proyecta vender más de lo que hay en stock y en {len(bajo)} vende bajo costo.\n")
    L.append("## Dos hallazgos")
    L.append(f"- **Lo aprobado no llega a caja**: de las {acept_verificables} sugerencias aceptadas que se pueden verificar en las ventas, solo {acept_aplicadas} se ven en el precio cobrado "
             f"(otras {acept_anteriores} son anteriores a los datos). Antes que un mejor algoritmo, hace falta que lo aprobado se aplique.")
    if len(g2):
        s_ = g2.sobrante / g2.stock
        L.append(f"- **Los objetivos no buscan vender todo el stock**: los {len(g2)} productos recién llegados venden al ritmo de su objetivo y aun así les sobraría entre el "
                 f"{pct(s_.min())} y el {pct(s_.max())} a la fecha límite. Parte del stock quieto empieza en cuánto se compra o se manda a cada local.\n")
    L.append("## Herramientas de IA")
    L.append("Claude (Claude Code) como asistente de programación y análisis: leer los datos, escribir y revisar el código, armar el Excel y el tablero, y redactar. "
             "Los criterios los discutí y elegí yo. Las cifras salen del script y se verificaron contra un cálculo independiente hecho directo del Excel original.")
    return "\n".join(L)


def hoja_nota(wb, texto_md):
    ws = wb.create_sheet("Nota", 1)
    ws.column_dimensions["A"].width = 160
    for i, linea in enumerate(texto_md.split("\n"), start=1):
        t = linea.replace("**", "")
        c = ws.cell(i, 1, t.lstrip("# "))
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if linea.startswith("# "):
            c.font = F_TIT
        elif linea.startswith("## "):
            c.font = F_SEC
        if len(t) > 160:
            ws.row_dimensions[i].height = 15 * (len(t) // 150 + 1)



PALANCA = {1: "Se vende solo: reponer, no descontar", 2: "Mover stock a donde vende y medir cuánto sobraría a la fecha límite",
           3: "Resolver lo que está en marcha antes de tocar el precio", 4: "Contar el stock físico y exhibirlo; si no vende, devolver",
           5: "Investigar en el local; mover stock donde se agotó", 6: "Revisar la exhibición; si no vende, devolver",
           7: "Confirmar si el descuento llegó a caja; si no, probarlo", 8: "Negociar devolución o bonificación con el proveedor",
           9: "Acá se decide el precio, con los criterios"}
REGLA_TXT = {1: f"Vende el {pct(REGLAS['al_dia'])} o más de lo esperado y le quedan menos de {REGLAS['meses_reponer']} meses de stock",
             2: f"Vende al día pero tiene stock para {REGLAS['meses_reponer']} meses o más (ingresó hace poco)",
             3: f"Campaña vigente, cambio de precio o sugerencia de los últimos {REGLAS['dias_en_curso']} días",
             4: "Cero ventas en toda la ventana",
             5: f"Vendía {dec(REGLAS['corte_u_dia'])} u/día o más y el último mes cayó a menos de un cuarto",
             6: "Más de la mitad del stock está en sucursales donde no vendió nada",
             7: f"{REGLAS['aceptados_repetidos']} o más descuentos aceptados antes",
             8: f"Con 10 % de descuento le quedaría menos de {pct(REGLAS['margen_minimo'])} de margen",
             9: "Vende poco pero parejo, sin otra explicación"}


def datos_tablero(D, ev):
    """Todo lo que muestra el tablero para esta foto, en un diccionario que se guarda como JSON."""
    import json
    letra = lambda n: "ABCDEFGHI"[n - 1]
    cons = h["propuesta_consultora"].set_index("sku")
    ap = hist.dropna(subset=["fecha_vigencia_desde"])
    D0, D1 = ap.fecha_vigencia_desde.min(), ap.fecha_vigencia_hasta.max()
    # control: productos que venden bien y no tuvieron ningún cambio, en las fechas de los descuentos
    tocados = set(hist.sku) | set(camp.sku) | set(h["cambios_precio"].sku)
    ctrl = [i for i in lotes.index if i[0] not in tocados and lotes.pct_esperado[i] >= REGLAS["al_dia"] and lotes.fecha_ingreso[i] <= INICIO]
    uc = vd.loc[ctrl].sum().values
    con = np.asarray((DIAS >= D0) & (DIAS <= D1))
    rng = np.random.default_rng(0)
    sim = [rng.choice(uc[con], con.sum()).mean() / rng.choice(uc[~con], (~con).sum()).mean() for _ in range(4000)]
    ya = D[D.nuestro_descuento == "ya"]
    efecto = []
    ESC_YA = escenarios_de(D)
    for s, e in ESC_YA.items():          # los mismos escenarios que la nota y las metas de la Propuesta
        f = D.loc[s]
        if e is None:
            continue
        peor, todas, mejor = e["escenarios"]
        efecto.append(dict(producto=f.producto, sku=s, accion=f.accion, descuento=e["d"], medida=e["medida"], casos=e["casos"], equilibrio=e["equilibrio"],
                           m_lista=e["m_lista"], m_desc=e["m_desc"], ctrl_dur=e["ctrl_dur"], ctrl_desp=e["ctrl_desp"], escenarios=e["escenarios"],
                           u_base=f.v30, u_esp=todas["u_dur"], u_bajo=peor["u_dur"], u_alto=mejor["u_dur"],
                           m_base=e["sin"], m_esp=todas["margen"], m_bajo=peor["margen"], m_alto=mejor["margen"],
                           meses_antes=f.stock / f.v30 if f.v30 else None, meses_despues=f.stock / todas["u_dur"] if todas["u_dur"] else None))
    E = pd.DataFrame(efecto)
    cd = cons.descuento_pct / 100
    regalo = regalo_g1(D)
    HIST = historias(D, ev)
    debil = (~ev.firme.astype(bool)) & (ev.respuesta >= REGLAS["respuesta_debil"]) & (ev.despues >= REGLAS["despues_minimo"])
    tipo_sin = D.tipo.map(lambda t: not (ev.firme.get(t, False) or debil.get(t, False)))
    chequeos = [("descuenta productos que venden bien", ((D.grupo_n == 1) & D.consultora_descuenta).sum()),
                ("descuenta productos recién llegados", ((D.grupo_n == 2) & D.consultora_descuenta).sum()),
                ("descuenta encima de una campaña, una suba o una sugerencia reciente", ((D.grupo_n == 3) & D.consultora_descuenta).sum()),
                ("descuenta productos que nunca vendieron o se cortaron", (D.grupo_n.isin([4, 5]) & D.consultora_descuenta).sum()),
                ("usa el precio para un problema de ubicación", ((D.grupo_n == 6) & D.consultora_descuenta).sum()),
                ("sube el descuento donde los aceptados nunca llegaron a caja", ((D.grupo_n == 7) & D.consultora_descuenta).sum()),
                ("descuenta en tipos donde el descuento no movió la venta", ((D.grupo_n == 9) & D.consultora_descuenta & tipo_sin).sum()),
                ("su descuento vende bajo costo", D.consultora_bajo_costo.sum()),
                ("proyecta vender más unidades de las que hay en stock", D.consultora_proyecta_mas_que_stock.sum())]
    datos = dict(
        foto=f"{FOTO:%d/%m/%Y}", foto_iso=f"{FOTO:%Y-%m-%d}", inicio=f"{INICIO:%d/%m/%Y}", vigencia=f"del {D0:%d/%m} al {D1:%d/%m/%Y}",
        criterios=REGLAS,
        k=dict(productos=len(D), lotes=len(lotes), locales=lotes.index.get_level_values("sucursal_id").nunique(), stock=D.stock.sum(),
               capital=(D.stock * D.costo).sum(), vencidas=lotes.unidades[lotes.vencido == "sí"].sum(),
               atrasados=int((D.pct_esperado < REGLAS["al_dia"]).sum()), ya=len(ya), cond=int((D.nuestro_descuento == "condicional").sum()),
               sin=int((D.nuestro_descuento == "no").sum()), u_base=E.u_base.sum() if len(E) else 0, u_esp=E.u_esp.sum() if len(E) else 0,
               m_base=E.m_base.sum() if len(E) else 0, m_esp=E.m_esp.sum() if len(E) else 0,
               cons_desc=int(D.consultora_descuenta.sum()), coincide=int((D.coincide == "sí").sum())),
        grupos=[dict(id=letra(n), n=n, nombre=nom.split(" · ", 1)[1], regla=REGLA_TXT[n], palanca=PALANCA[n],
                     productos=int((D.grupo_n == n).sum()), stock=D.stock[D.grupo_n == n].sum(),
                     capital=(D.stock * D.costo)[D.grupo_n == n].sum(),
                     acciones=sorted(set(a.split(" ·")[0] if not a.startswith(("Bajar", "Probar", "Aplicar")) else a for a in D.accion[D.grupo_n == n])))
                for n, nom in GRUPOS.items()],
        causas=[dict(id=k, nombre=c["nombre"], grupos=c["grupos"], problema=c["problema"], solucion=c["solucion"], precio=c["precio"], **HIST.get(k, {}))
                for k, c in CAUSAS.items()],
        vencido=HIST["vencido"],
        evidencia=[dict(tipo=t, referencia=e.referencia, descuento=e.descuento, respuesta=e.respuesta, bajo=e.rango_bajo, alto=e.rango_alto,
                        firme=bool(e.firme), debil=bool(debil[t]), despues=e.despues) for t, e in ev.sort_values("respuesta", ascending=False).iterrows()],
        control=dict(resp=uc[con].mean() / uc[~con].mean(), bajo=np.percentile(sim, 5), alto=np.percentile(sim, 95)),
        efecto=efecto,
        consultora=dict(por_grupo=[dict(n=n, nombre=nom.split(" · ", 1)[1], si=int(((D.grupo_n == n) & (D.coincide == "sí")).sum()),
                                        no=int(((D.grupo_n == n) & (D.coincide == "no")).sum())) for n, nom in GRUPOS.items()],
                        chequeos=[dict(chequeo=c, productos=int(n)) for c, n in chequeos if n > 0], regalo=regalo,
                        aplicadas=int((hist.aceptacion == 1).sum() - hist[(hist.aceptacion == 1) & hist.fecha_vigencia_desde.isna()].shape[0]),
                        aceptadas=int((hist.aceptacion == 1).sum())),
        productos=[dict(sku=s, producto=f.producto, grupo=letra(f.grupo_n), n=int(f.grupo_n), grupo_nombre=f.grupo.split(" · ", 1)[1],
                        sucursales=f.sucursales, stock=int(f.stock), accion=f.accion, descuento=(float(f.descuento) if f.descuento != "" else None),
                        condicion=f.condicion, motivo=f.motivo, ademas=f.ademas, indicador=f.indicador, linea_base=f.linea_base, meta=f.meta,
                        revisar=f.revisar, si_no=f.si_no, consultora=f.consultora, coincide=f.coincide, nuestro=f.nuestro_descuento,
                        u_sem_base=f.v30 / 30 * 7, precio=float(f.precio), costo=float(f.costo),
                        meta_u_sem=(f.v30 / 30 * 7 * (1 + ESC_YA[s]["escenarios"][1]["dur"]) if f.nuestro_descuento == "ya" and ESC_YA.get(s) else None),
                        tipo=f.tipo, rubro=prod.rubro[s], proveedor=f.proveedor, margen=float(f.margen), pct_esperado=float(f.pct_esperado),
                        vendidas=int(f.vendidas), v30=int(f.v30), meses=(None if f.meses != f.meses else float(f.meses)),
                        pasos=f.pasos, criterios=f.criterios, evalua_descuento=bool(f.grupo_n in (2, 3, 7, 9)),
                        u_vencidas=int(f.u_vencidas), salida=(f.salida if isinstance(f.salida, str) else None),
                        sobrante=(None if f.sobrante != f.sobrante else float(f.sobrante)),
                        causa=CAUSA_DE[f.grupo_n], problema=f.problema, indicadores=f.indicadores)
                   for s, f in D.iterrows()],
        # tablas para explorar y auditar
        catalogo=[dict(sku=s, nombre=r.nombre, rubro=r.rubro, tipo=r.tipo, proveedor=r.proveedor, precio=float(r.precio_lista), costo=float(r.costo_unitario))
                  for s, r in prod.iterrows()],
        sucursales=[dict(id=s, nombre=r.nombre, ciudad=r.ciudad, tipo=r.tipo) for s, r in suc.iterrows()],
        lotes=[dict(sku=s, suc=sid, unidades=int(r.unidades), ingreso=f"{r.fecha_ingreso:%Y-%m-%d}", limite=f"{r.fecha_limite:%Y-%m-%d}",
                    objetivo=int(r.unidades_objetivo), vendidas=int(r.vendidas), v30=int(r.venta_ultimos_30), pct_esperado=float(r.pct_esperado),
                    dias_de_stock=(None if r.dias_de_stock != r.dias_de_stock else float(r.dias_de_stock)), vencido=r.vencido, rotacion=r.rotacion,
                    stock_inicial=int(r.stock_inicial), pct_vendido=float(r.pct_vendido), ritmo_objetivo=float(r.ritmo_objetivo),
                    ritmo_real=float(r.ritmo_observado), dias_observados=int(r.dias_observados), venta_pesos=float(r.venta_pesos),
                    ultima_venta=(f"{r.ultima_venta:%Y-%m-%d}" if pd.notna(r.ultima_venta) else None), dias_sin_vender=(None if pd.isna(r.dias_sin_vender) else int(r.dias_sin_vender)),
                    vendidas_otras=int(r.vendidas_otras_sucursales), descuento=r.descuento)
               for (s, sid), r in lotes.iterrows()],
        historial=[dict(sku=r.sku, fecha=f"{r.fecha_sugerencia:%Y-%m-%d}", descuento=int(r.descuento_pct), aceptacion=int(r.aceptacion), comentario=r.comentario,
                        desde=(f"{r.fecha_vigencia_desde:%Y-%m-%d}" if pd.notna(r.fecha_vigencia_desde) else None),
                        hasta=(f"{r.fecha_vigencia_hasta:%Y-%m-%d}" if pd.notna(r.fecha_vigencia_hasta) else None)) for r in hist.itertuples()],
        campanas=[dict(sku=r.sku, tipo=r.tipo_campana, desde=f"{r.fecha_desde:%Y-%m-%d}", hasta=f"{r.fecha_hasta:%Y-%m-%d}", observacion=r.observacion)
                  for r in camp.itertuples()],
        cambios=[dict(sku=r.sku, fecha=f"{pd.Timestamp(r.fecha):%Y-%m-%d}", anterior=float(r.precio_anterior), nuevo=float(r.precio_nuevo), origen=r.origen)
                 for r in h["cambios_precio"].itertuples()],
        descuentos=RES_DESC,
        consultora_cruda=[dict(sku=r.sku, decision=r.decision, descuento=int(r.descuento_pct), proyeccion=int(r.unidades_proyectadas_30d), comentario=r.comentario)
                          for r in h["propuesta_consultora"].itertuples()],
    )
    a_json = lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o))
    return json.loads(json.dumps(datos, default=a_json, ensure_ascii=False).replace("NaN", "null"))


if __name__ == "__main__":
    SALIDAS.mkdir(parents=True, exist_ok=True)
    pedidas = ARGS.sucursales or sorted(lotes.index.get_level_values("sucursal_id").unique(), key=lambda s: (s[0] != "S", s))
    wb = Workbook()
    wb.remove(wb.active)
    hoja_resumen(wb, [s for s in pedidas])
    hoja_descuentos(wb)
    for sid in pedidas:
        hoja_sucursal(wb, sid)
    hoja_lotes(wb)
    hoja_como_se_calcula(wb)
    D, ev = armar_propuesta()
    hoja_propuesta(wb, D, ev)
    nota_md = texto_nota(D, ev)
    hoja_nota(wb, nota_md)
    (SALIDAS / "nota.md").write_text(nota_md, encoding="utf-8")
    import json
    (SALIDAS / "tablero_datos.json").write_text(json.dumps(datos_tablero(D, ev), ensure_ascii=False, indent=1), encoding="utf-8")
    SALIDA.parent.mkdir(exist_ok=True)
    wb.save(SALIDA)
    print(f"Guardado {SALIDA} con las hojas: {', '.join(wb.sheetnames)}")
