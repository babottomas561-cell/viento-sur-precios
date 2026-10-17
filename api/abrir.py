"""GET /api/abrir?fecha=<AAAA-MM-DD> · los datos del tablero de ese Excel en la base; sin fecha, los más nuevos."""
import urllib.parse
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent.parent)]

from _base import responder

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        fecha = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("fecha", [""])[0]
        try:
            datos = servidor.abrir(fecha or None)
        except Exception as e:
            return responder(self, 503, {"error": f"No se pudo leer la base: {e}"})
        if not datos:
            return responder(self, 404, {"error": "No hay un Excel con esa fecha en la base." if fecha else "La base está vacía."})
        return responder(self, 200, datos)
