"""La base de datos de Viento Sur, en SQL: las mismas tablas y las mismas consultas en la computadora (SQLite, datos/viento_sur.db)
y en el sitio (Postgres en Supabase). La usan actualizar.py (local) y servidor.py (online).

Las 8 hojas del Excel son 8 tablas, con todas sus columnas (fecha_datos = el último día con ventas de cada Excel; un Excel por fecha):
  productos, sucursales, lotes (hoja stock_sucursal), sugerencias (historial_sugerencias), cambios_precio,
  campanas (campanas_activas), propuesta_consultora   una fila por fila de la hoja en cada Excel (fila = su orden en la hoja)
  ventas      todas las ventas (fecha, producto, sucursal), acumuladas entre Excel: si una venta vuelve a venir, se actualiza
Y además:
  cargas      cada Excel cargado: su fecha, desde cuándo trae ventas, el nombre del archivo, cuándo se subió, el original y el de análisis
  decisiones  la recomendación de cada producto en cada Excel: lo que después mide el seguimiento
  tablero     lo que lee el tablero de cada Excel (JSON), ya con sus ventas, su historia y su seguimiento
Borrar una carga borra todas sus filas (ON DELETE CASCADE), salvo las ventas. Cualquier hoja se reconstruye desde la base con
Base.hoja(fecha, hoja): salidas/auditoria/auditar_base.py lo compara con el Excel original, celda por celda.

Ejemplo de consulta (en Supabase: SQL Editor):
  SELECT d.fecha_datos, d.accion, count(*) FROM decisiones d GROUP BY 1, 2 ORDER BY 1, 3 DESC;
"""
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd

import carga

_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# Cada hoja del Excel: su tabla y sus columnas, con su tipo (D fecha, I entero, N número, T texto). Es la única definición:
# de acá salen el esquema, la carga y la reconstrucción de la hoja.
HOJAS = {
    "productos": ("productos", [("sku", "T"), ("nombre", "T"), ("rubro", "T"), ("tipo", "T"), ("proveedor", "T"), ("disciplina", "T"),
                                ("seccion", "T"), ("precio_lista", "N"), ("costo_unitario", "N"), ("fecha_ultimo_ingreso", "D")]),
    "sucursales": ("sucursales", [("sucursal_id", "T"), ("nombre", "T"), ("ciudad", "T"), ("tipo", "T")]),
    "stock_sucursal": ("lotes", [("sku", "T"), ("sucursal_id", "T"), ("unidades", "I"), ("fecha_ingreso", "D"), ("antiguedad_dias", "I"),
                                 ("fecha_limite", "D"), ("unidades_objetivo", "I")]),
    "ventas": ("ventas", [("fecha", "D"), ("sku", "T"), ("sucursal_id", "T"), ("unidades", "I"), ("precio_unitario", "N")]),
    "historial_sugerencias": ("sugerencias", [("sku", "T"), ("fecha_sugerencia", "D"), ("descuento_pct", "N"), ("aceptacion", "I"),
                                              ("comentario", "T"), ("fecha_vigencia_desde", "D"), ("fecha_vigencia_hasta", "D")]),
    "cambios_precio": ("cambios_precio", [("sku", "T"), ("fecha", "D"), ("precio_anterior", "N"), ("precio_nuevo", "N"), ("origen", "T")]),
    "campanas_activas": ("campanas", [("sku", "T"), ("tipo_campana", "T"), ("fecha_desde", "D"), ("fecha_hasta", "D"), ("observacion", "T")]),
    "propuesta_consultora": ("propuesta_consultora", [("sku", "T"), ("decision", "T"), ("descuento_pct", "N"),
                                                      ("unidades_proyectadas_30d", "I"), ("comentario", "T")]),
}


def esquema(pg):
    F, N, B, J, T = ("DATE", "DOUBLE PRECISION", "BYTEA", "JSONB", "TIMESTAMPTZ") if pg else ("TEXT", "REAL", "BLOB", "TEXT", "TEXT")
    tipo = dict(D=F, I="INTEGER", N=N, T="TEXT")
    ref = "REFERENCES cargas (fecha_datos) ON DELETE CASCADE"
    qs = [f"CREATE TABLE IF NOT EXISTS cargas (fecha_datos {F} PRIMARY KEY, ventas_desde {F}, nombre TEXT, subida {T}, original {B}, analisis {B})",
          f"""CREATE TABLE IF NOT EXISTS ventas (fecha {F}, sku TEXT, sucursal_id TEXT, unidades INTEGER, precio_unitario {N},
              PRIMARY KEY (fecha, sku, sucursal_id))""",
          "CREATE INDEX IF NOT EXISTS ventas_sku_fecha ON ventas (sku, fecha)"]
    for hoja, (tabla, cols) in HOJAS.items():
        if tabla != "ventas":
            qs.append(f"CREATE TABLE IF NOT EXISTS {tabla} (fecha_datos {F} {ref}, fila INTEGER, "
                      + ", ".join(f"{c} {tipo[k]}" for c, k in cols) + ", PRIMARY KEY (fecha_datos, fila))")
    return qs + [
        f"""CREATE TABLE IF NOT EXISTS decisiones (fecha_datos {F} {ref}, sku TEXT, producto TEXT, grupo INTEGER, accion TEXT, descuento {N},
            condicion TEXT, indicador TEXT, linea_base TEXT, meta TEXT, revisar TEXT, nuestro TEXT, u_sem_base {N}, meta_u_sem {N},
            stock INTEGER, precio {N}, PRIMARY KEY (fecha_datos, sku))""",
        f"CREATE TABLE IF NOT EXISTS tablero (fecha_datos {F} PRIMARY KEY {ref}, datos {J})",
    ]


def _url_pg(url):
    """La dirección de Postgres sin los parámetros que agrega Vercel y el driver no entiende (queda sslmode)."""
    p = urlsplit(url.replace("postgres://", "postgresql://", 1))
    q = [(k, v) for k, v in parse_qsl(p.query) if k in ("sslmode", "options", "application_name")]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), ""))


def _valor(x, k):
    """Una celda del Excel como va a la base: fechas en texto AAAA-MM-DD, enteros, números, texto; vacía = NULL."""
    if x is None or (not isinstance(x, str) and pd.isna(x)):
        return None
    if k == "D":
        return f"{pd.Timestamp(x):%Y-%m-%d}"
    if k == "I":
        return int(x)
    if k == "N":
        return int(x) if float(x).is_integer() else float(x)
    return str(x)


def _py(x):
    """Lo que devuelve la base, como lo usa el resto del proceso: fechas en texto AAAA-MM-DD y archivos en bytes."""
    if isinstance(x, (date, datetime)):
        return x.isoformat() if isinstance(x, datetime) else f"{x:%Y-%m-%d}"
    if isinstance(x, memoryview):
        return bytes(x)
    return x


class Base:
    """destino: una dirección postgresql://… (Supabase) o la ruta de un archivo SQLite."""

    def __init__(self, destino):
        self.pg = str(destino).startswith(("postgres://", "postgresql://"))
        if self.pg:
            import psycopg                                    # solo hace falta online
            # prepare_threshold=None: el pooler de Supabase (modo transacción) no admite consultas preparadas
            self.con = psycopg.connect(_url_pg(destino), prepare_threshold=None, connect_timeout=15)
        else:
            self.con = sqlite3.connect(destino)
            self.con.execute("PRAGMA foreign_keys = ON")
        for q in esquema(self.pg):
            self.con.execute(q)
        if self.pg:
            # Supabase publica una API sobre las tablas: con RLS y sin políticas, esa API no ve nada; el servidor entra con el
            # usuario dueño de la base, que no pasa por RLS
            for (tabla,) in self.con.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").fetchall():
                self.con.execute(f'ALTER TABLE public."{tabla}" ENABLE ROW LEVEL SECURITY')
        self.con.commit()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.con.close()

    # ------------------------------------------------------------------ consultas (escritas con ?, sirven en las dos bases)
    def _param(self, x):
        if self.pg and isinstance(x, str) and _FECHA.match(x):
            return date.fromisoformat(x)
        return x

    def sql(self, q, params=()):
        if self.pg:
            q = q.replace("?", "%s")
        cur = self.con.execute(q, tuple(self._param(x) for x in params))
        return [tuple(_py(x) for x in r) for r in cur.fetchall()] if cur.description else []

    def _muchas(self, q, filas):
        if self.pg:
            with self.con.cursor() as cur:
                cur.executemany(q.replace("?", "%s"), [tuple(self._param(x) for x in f) for f in filas])
        else:
            self.con.executemany(q, filas)

    # ------------------------------------------------------------------ escribir
    def guardar_hojas(self, xlsx, fecha, nombre, original=None):
        """Paso 1: guarda las 8 hojas del Excel en la base. Si esa fecha ya estaba, la reemplaza (se puede volver a cargar sin duplicar)."""
        h = pd.read_excel(xlsx, sheet_name=None)
        filas = lambda hoja: [tuple(_valor(r.get(c), k) for c, k in HOJAS[hoja][1]) for r in h[hoja].to_dict("records")]
        ventas = filas("ventas")
        self.sql("DELETE FROM cargas WHERE fecha_datos = ?", (fecha,))           # y en cascada, lo de esa fecha
        self.sql("INSERT INTO cargas VALUES (?, ?, ?, ?, ?, ?)",
                 (fecha, min(v[0] for v in ventas), nombre, datetime.now(timezone.utc).isoformat(timespec="seconds"), original, None))
        self._muchas("""INSERT INTO ventas VALUES (?, ?, ?, ?, ?) ON CONFLICT (fecha, sku, sucursal_id)
                        DO UPDATE SET unidades = excluded.unidades, precio_unitario = excluded.precio_unitario""", ventas)
        for hoja, (tabla, cols) in HOJAS.items():
            if tabla != "ventas" and hoja in h:
                self._muchas(f"INSERT INTO {tabla} (fecha_datos, fila, {', '.join(c for c, _ in cols)}) VALUES ({', '.join('?' * (len(cols) + 2))})",
                             [(fecha, i, *f) for i, f in enumerate(filas(hoja), start=1)])
        self.con.commit()

    def exportar_excel(self, fecha, destino):
        """El Excel de esa fecha armado desde la base (las 8 hojas): es lo que corre el proceso, así la base es la fuente única."""
        with pd.ExcelWriter(destino) as w:
            for hoja in HOJAS:
                self.hoja(fecha, hoja).to_excel(w, sheet_name=hoja, index=False)
        return destino

    def guardar_resultado(self, fecha, tablero, analisis=None):
        """Paso 2: guarda lo que calculó el proceso: la recomendación de cada producto, los datos del tablero y el Excel de análisis."""
        self.sql("DELETE FROM decisiones WHERE fecha_datos = ?", (fecha,))
        self.sql("DELETE FROM tablero WHERE fecha_datos = ?", (fecha,))
        self._muchas("INSERT INTO decisiones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     [(fecha, d["sku"], d["producto"], d["n"], d["accion"], d["descuento"], d["condicion"], d["indicador"], d["linea_base"],
                       d["meta"], d["revisar"], d["nuestro"], d["u_sem_base"], d["meta_u_sem"], d["stock"], d["precio"]) for d in tablero["productos"]])
        self.sql("INSERT INTO tablero VALUES (?, ?)", (fecha, json.dumps(tablero, ensure_ascii=False)))
        if analisis is not None:
            self.sql("UPDATE cargas SET analisis = ? WHERE fecha_datos = ?", (analisis, fecha))
        self.con.commit()

    def borrar(self, fecha):
        """Saca un Excel de la base. Devuelve si estaba."""
        estaba = bool(self.sql("SELECT 1 FROM cargas WHERE fecha_datos = ?", (fecha,)))
        self.sql("DELETE FROM cargas WHERE fecha_datos = ?", (fecha,))
        self.con.commit()
        return estaba

    def completar(self, fecha, archivo_excel=None, meta=None):
        """Arma lo que lee el tablero para esa fecha (sus ventas, la historia y el seguimiento contra los Excel anteriores) y lo guarda."""
        tablero = self.tablero(fecha)
        ventas = [list(r) for r in self.sql("SELECT fecha, sku, sucursal_id, unidades, precio_unitario FROM ventas WHERE fecha <= ? "
                                            "ORDER BY fecha, sku, sucursal_id", (fecha,))]
        fechas = self.fechas(hasta=fecha)
        historia = [carga.resumen(self.tablero(f), f) for f in fechas]
        anterior, seg = self.seguimiento(fecha)
        paq = carga.paquete(tablero, ventas, historia, anterior, seg, archivo_excel, meta or tablero.get("foto_meta"))
        self.sql("UPDATE tablero SET datos = ? WHERE fecha_datos = ?", (json.dumps(paq, ensure_ascii=False), fecha))
        self.con.commit()
        return paq

    # ------------------------------------------------------------------ leer
    def hoja(self, fecha, hoja):
        """Una hoja del Excel de esa fecha, reconstruida desde la base (mismas columnas y filas, en su orden)."""
        tabla, cols = HOJAS[hoja]
        nombres = [c for c, _ in cols]
        if tabla == "ventas":                               # las ventas del período que trajo ese Excel
            desde = self.sql("SELECT ventas_desde FROM cargas WHERE fecha_datos = ?", (fecha,))[0][0]
            filas = self.sql(f"SELECT {', '.join(nombres)} FROM ventas WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sku, sucursal_id", (desde, fecha))
        else:
            filas = self.sql(f"SELECT {', '.join(nombres)} FROM {tabla} WHERE fecha_datos = ? ORDER BY fila", (fecha,))
        d = pd.DataFrame(filas, columns=nombres)
        for c, k in cols:                                   # enteros como enteros (la base puede guardarlos como número real)
            v = d[c].dropna()
            if k in ("I", "N") and len(v) and all(float(x).is_integer() for x in v):
                d[c] = d[c].astype("Int64" if d[c].isna().any() else "int64")
        return d

    def fechas(self, hasta=None):
        """Las fechas cargadas, de la más vieja a la más nueva (hasta una fecha, si se pide)."""
        if hasta:
            return [r[0] for r in self.sql("SELECT fecha_datos FROM cargas WHERE fecha_datos <= ? ORDER BY fecha_datos", (hasta,))]
        return [r[0] for r in self.sql("SELECT fecha_datos FROM cargas ORDER BY fecha_datos")]

    def cargas(self):
        """Los Excel cargados, del más nuevo al más viejo: [{fecha, subida, nombre}]."""
        return [dict(fecha=f, subida=s, nombre=n) for f, s, n in self.sql("SELECT fecha_datos, subida, nombre FROM cargas ORDER BY fecha_datos DESC")]

    def tablero(self, fecha):
        r = self.sql("SELECT datos FROM tablero WHERE fecha_datos = ?", (fecha,))
        if not r:
            return None
        return r[0][0] if isinstance(r[0][0], dict) else json.loads(r[0][0])       # Postgres devuelve el JSONB ya leído

    def excel(self, fecha, tipo):
        """El Excel original o el de análisis de esa fecha (bytes), o None."""
        col = {"original": "original", "analisis": "analisis"}[tipo]
        r = self.sql(f"SELECT {col} FROM cargas WHERE fecha_datos = ?", (fecha,))
        return r[0][0] if r and r[0][0] else None

    def seguimiento(self, actual):
        """Qué pasó con cada recomendación de los Excel anteriores hasta este (la cuenta está en carga.py). Devuelve (anterior, filas)."""
        previas = [f for f in self.fechas() if f < actual]
        if not previas:
            return None, []
        cols = ["fecha_datos", "sku", "producto", "n", "accion", "descuento", "condicion", "indicador", "linea_base", "meta", "revisar",
                "nuestro", "u_sem_base", "meta_u_sem", "stock", "precio"]
        dec = pd.DataFrame(self.sql("SELECT * FROM decisiones WHERE fecha_datos < ?", (actual,)), columns=cols)
        por_excel = [(f, dec[dec.fecha_datos == f].to_dict("records")) for f in previas]
        v = pd.DataFrame(self.sql("SELECT fecha, sku, sucursal_id, unidades, precio_unitario FROM ventas WHERE fecha <= ?", (actual,)),
                         columns=["fecha", "sku", "sucursal_id", "unidades", "precio_unitario"])
        stock = dict(self.sql("SELECT sku, SUM(unidades) FROM lotes WHERE fecha_datos = ? GROUP BY sku", (actual,)))
        nuevas = dict(self.sql("SELECT sku, accion FROM decisiones WHERE fecha_datos = ?", (actual,)))
        return previas[-1], carga.seguimiento(por_excel, v, stock, actual, nuevas)
