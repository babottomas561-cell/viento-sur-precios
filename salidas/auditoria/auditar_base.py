"""Auditoría de la base: reconstruye las 8 hojas de cada Excel desde la base SQL y las compara, celda por celda, con el Excel original.

Si todo coincide, la base es fiel al archivo: calcular desde la base da lo mismo que calcular desde el Excel.
Compara cada hoja con sus mismas columnas y filas en el mismo orden;
las fechas como AAAA-MM-DD y los números por su valor (65100 y 65100.0 son lo mismo).

Uso:  python salidas/auditoria/auditar_base.py                               -> la base local (datos/viento_sur.db) contra datos/viento_sur.xlsx
      python salidas/auditoria/auditar_base.py --online                      -> la base online (POSTGRES_URL, Supabase)
      python salidas/auditoria/auditar_base.py --base X --excel Y --fecha AAAA-MM-DD
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import carga  # noqa: E402
from base_sql import HOJAS, Base, _valor  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="datos/viento_sur.db")
ap.add_argument("--online", action="store_true", help="auditar la base online (POSTGRES_URL)")
ap.add_argument("--excel", default="datos/viento_sur.xlsx")
ap.add_argument("--fecha", default=None, help="la fecha de ese Excel en la base (por defecto, la que da el propio Excel)")
args = ap.parse_args()

if args.online:
    import servidor
    b = servidor.base()
else:
    b = Base(args.base)
fecha = args.fecha or carga.fecha_datos(args.excel)
original = pd.read_excel(args.excel, sheet_name=None)
fallas, celdas = [], 0

print(f"Base {'online' if args.online else args.base} · Excel {args.excel} · datos al {fecha}")
for hoja, (tabla, cols) in HOJAS.items():
    x = original[hoja]
    y = b.hoja(fecha, hoja)
    nombres = [c for c, _ in cols]
    if list(x.columns) != nombres:
        fallas.append(f"{hoja}: columnas del Excel {list(x.columns)} ≠ tabla {nombres}")
        continue
    if len(x) != len(y):
        fallas.append(f"{hoja}: {len(x)} filas en el Excel, {len(y)} en la base")
        continue
    dif = 0
    for (_, fx), (_, fy) in zip(x.iterrows(), y.iterrows()):
        for c, k in cols:
            a, z = _valor(fx[c], k), _valor(fy[c], k)
            celdas += 1
            if a != z:
                dif += 1
                if dif <= 3:
                    fallas.append(f"{hoja}.{c}: Excel {a!r} ≠ base {z!r}")
    print(f"   {hoja:24s} → {tabla:22s} {len(x):5d} filas × {len(cols)} columnas  {'idéntica' if not dif else f'{dif} diferencias'}")

b.__exit__()
print(f"\nBase: 8 hojas · {celdas:,} celdas comparadas · {len(fallas) or 'sin'} diferencias".replace(",", "."))
for f in fallas[:30]:
    print("  ✗", f)
raise SystemExit(1 if fallas else 0)
