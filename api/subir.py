"""POST /api/subir · cuerpo: el Excel (.xlsx) · encabezado x-nombre: el nombre del archivo.
Valida el Excel, corre el proceso y lo carga en la base (si ya había un Excel con esa fecha, lo reemplaza)."""
import traceback
import urllib.parse
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent.parent)]

from _base import responder

import servidor

MAXIMO = 4 * 1024 * 1024        # Vercel acepta hasta 4,5 MB por pedido


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        if not n:
            return responder(self, 400, {"error": "No llegó ningún archivo."})
        if n > MAXIMO:
            return responder(self, 413, {"error": f"El archivo pesa {n / 1e6:.1f} MB; el máximo es 4 MB."})
        contenido = self.rfile.read(n)
        if not contenido.startswith(b"PK"):
            return responder(self, 400, {"error": "El archivo no es un Excel (.xlsx)."})
        nombre = urllib.parse.unquote(self.headers.get("x-nombre") or "sin_nombre.xlsx")[:120]
        try:
            guardada, problemas = servidor.procesar_subida(contenido, nombre)
        except RuntimeError as e:
            return responder(self, 422, {"error": str(e)})
        except Exception:
            traceback.print_exc()
            return responder(self, 500, {"error": "Algo falló al procesar el Excel. Revisá que tenga la forma de la consigna."})
        if problemas:
            return responder(self, 422, {"error": "El Excel no tiene la forma esperada.", "problemas": problemas})
        return responder(self, 200, guardada)
